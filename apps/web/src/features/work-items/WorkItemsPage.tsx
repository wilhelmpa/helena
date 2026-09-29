'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useGroupLabels } from '@/hooks/useGroupLabels';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { revScope } from '@/utils/revScopes';
import { qk } from '@/services/queryKeys';
import { buildGroups, groupIssues } from '@/utils/project';
import { countIssuesByColumn } from './utils/wipLimit';
import {
  customFieldKey,
  defaultViewSettings,
  restoreHiddenSections,
  withoutHiddenSections,
  type ViewSettings,
} from '@/utils/viewSettings';
import { Pencil, Plus } from 'lucide-react';
import ViewIconPicker from '@/components/layout/ViewIconPicker';
import FilterPills from '@/components/layout/FilterPills';
import { useFilterFields } from '@/hooks/useFilterFields';
import { PageActions, PageToolbar } from '@/components/layout/PageToolbar';
import {
  Button,
  Overlay,
  Segmented,
  SettingsGroup,
  SettingsRow,
  TextField,
  Page,
} from '@/design-system';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { byKey } from '@/utils/messageKey';
import { VIEWS, type WorkItemsView } from '@/utils/viewTypes';
import { useViewsQuery } from '@/services/views.service';
import BoardDisplayControl from './components/BoardDisplayControl';
import FieldsControl from './components/FieldsControl';
import { IssueLinksProvider } from './context/useIssueLinks';
import { SubtasksProvider } from './context/useSubtasks';
import KanbanBoard from './components/kanban/KanbanBoard';
import TableView from './components/table/TableView';
import TimelineView from './components/timeline/TimelineView';
import CalendarView from './components/calendar/CalendarView';
import ListView from './components/list/ListView';

interface TimelineCollapseState {
  scope: string;
  groups: Set<string>;
}

// The work items page (the index and /view/:viewId child routes of the Shell).
// Its toolbar holds the view editor, area, filter and display controls. Saved views
// are selected and created in the project tree. The project data and view editor
// come from the Shell through React context.
export default function WorkItemsPage() {
  const t = useTranslations('workItems');
  const tCommon = useTranslations('common');
  const tViews = useTranslations('views');
  const tLayouts = byKey(useTranslations('display.layouts'));
  const { project, filteredProject, editor, customFields, onOpenIssue, onAddIssue } = useShell();
  const { describeConditions } = useFilterFields(project?.project.key);
  const { can } = usePermissions();
  const groupLabels = useGroupLabels();
  const features = useProjectFeatures();
  const [deleting, setDeleting] = useState(false);
  const [timelineCollapseState, setTimelineCollapseState] = useState<TimelineCollapseState>({
    scope: '',
    groups: new Set(),
  });

  // Live board: refetch the issues when anything on the board changes, so another
  // user's create/move/edit shows without a manual reload.
  const projectKey = project?.project.key ?? '';
  useLiveRefresh({
    scope: project ? revScope.board(project.project.id) : null,
    targets: [qk.boardIssues(projectKey)],
  });

  // The address names a view that no longer exists (deleted, or a stale link): say so
  // and show the whole board under its own address, instead of the board under a dead
  // view's address.
  const viewsLoaded = useViewsQuery(projectKey || null).isSuccess;
  const missingView = viewsLoaded && editor.activeViewId != null && !editor.activeView;
  const reportedMissing = useRef<number | null>(null);
  useEffect(() => {
    if (!missingView || reportedMissing.current === editor.activeViewId) return;
    reportedMissing.current = editor.activeViewId;
    if (!editor.wasDeleted(editor.activeViewId!)) toast.info(t('viewNotFound'));
    editor.selectView(null);
  }, [missingView, editor, t]);

  if (!project || !filteredProject) return null;

  // Saving persists the view: editing an existing one is a views edit, a brand-new
  // one is a views create. Filtering/display stay available to everyone (transient,
  // client-side); only persisting is gated.
  const canSaveView = can('views', editor.activeView ? 'edit' : 'create');
  const canSaveDraft = !!editor.activeView || !!editor.draftName.trim();

  // With an optional section off, its property and grouping are left out of what
  // the layouts and the Display panel work with, and put back on the way out so the
  // stored display keeps them for when the section is on again.
  const baseSettings = withoutHiddenSections(editor.settings, features);
  const watchlistFields = ['Preis', 'RSI', 'MACD']
    .map((name) =>
      customFields.find(
        (field) => field.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'),
      ),
    )
    .filter((field) => field != null);
  const oldDefaultProperties = defaultViewSettings('kanban').properties;
  const watchlistDefault =
    project.project.key.toUpperCase() === 'TRADE' &&
    editor.activeView?.name.toLocaleLowerCase('de') === 'watchlist' &&
    editor.view === 'kanban' &&
    watchlistFields.length > 0 &&
    baseSettings.properties.length === oldDefaultProperties.length &&
    baseSettings.properties.every((property, index) => property === oldDefaultProperties[index]);
  const settings = watchlistDefault
    ? {
        ...baseSettings,
        properties: [
          'id',
          'labels',
          ...watchlistFields.map((field) => customFieldKey(field.id)),
        ] as ViewSettings['properties'],
      }
    : baseSettings;
  const changeSettings = (next: ViewSettings) =>
    editor.changeSettings(restoreHiddenSections(next, editor.settings, features));

  // From the unfiltered project, so a column's WIP limit is measured against every
  // issue in it rather than the ones the active filters leave on screen.
  const columnCounts = countIssuesByColumn(project.issues);

  const timelineGroups = buildGroups(
    filteredProject,
    settings.group,
    groupLabels,
    editor.effectiveFilters,
  );
  const timelineIssuesByGroup = groupIssues(timelineGroups, filteredProject.issues, settings.group);
  const visibleTimelineGroupKeys = timelineGroups
    .filter(
      (group) =>
        settings.showEmptyGroups || (timelineIssuesByGroup.get(group.key)?.length ?? 0) > 0,
    )
    .map((group) => group.key);
  const timelineCollapseScope = [
    projectKey,
    editor.activeViewId ?? 'all',
    settings.group,
    settings.subgroup,
    settings.showEmptyGroups,
    settings.timelineCollapseAll,
  ].join(':');
  const initialTimelineCollapsedGroups = settings.timelineCollapseAll
    ? new Set(visibleTimelineGroupKeys)
    : new Set<string>();
  const collapsedTimelineGroups =
    timelineCollapseState.scope === timelineCollapseScope
      ? timelineCollapseState.groups
      : initialTimelineCollapsedGroups;

  const toggleTimelineGroup = (groupKey: string) => {
    setTimelineCollapseState((current) => {
      const groups = new Set(
        current.scope === timelineCollapseScope ? current.groups : initialTimelineCollapsedGroups,
      );
      if (groups.has(groupKey)) groups.delete(groupKey);
      else groups.add(groupKey);
      return { scope: timelineCollapseScope, groups };
    });
  };

  const viewProps = {
    project: filteredProject,
    filters: editor.effectiveFilters,
    columnCounts,
    customFields,
    settings,
    onSettingsChange: changeSettings,
    onOpenIssue,
    onAddIssue,
  };

  function renderView() {
    switch (editor.view) {
      case 'table':
        return (
          <TableView
            {...viewProps}
            widthScope={editor.activeViewId ? `view:${editor.activeViewId}` : 'all'}
          />
        );
      case 'timeline':
        return (
          <TimelineView
            {...viewProps}
            collapsedGroups={collapsedTimelineGroups}
            onToggleGroup={toggleTimelineGroup}
            viewId={editor.activeViewId}
          />
        );
      case 'calendar':
        return <CalendarView {...viewProps} />;
      case 'list':
        return <ListView {...viewProps} />;
      default:
        return <KanbanBoard {...viewProps} />;
    }
  }

  // The toolbar (docs/design-system.md §9, draft Aufgaben-*): the filters as pills, the
  // "changed" state of a saved view, then the display options and the layout switch.
  const layoutSwitch = (
    <Segmented<WorkItemsView>
      label={t('layout')}
      value={editor.view}
      onChange={editor.changeView}
      options={VIEWS.map(({ value, icon: Icon }) => ({
        value,
        label: tLayouts(value),
        icon: <Icon aria-hidden="true" />,
      }))}
    />
  );
  const display = (
    <BoardDisplayControl
      view={editor.view}
      onViewChange={editor.changeView}
      settings={settings}
      onSettingsChange={changeSettings}
      customFields={customFields}
      issueTypes={project.issueTypes}
    />
  );
  const fields = (
    <FieldsControl
      view={editor.view}
      project={project}
      settings={settings}
      onSettingsChange={changeSettings}
      customFields={customFields}
      issueTypes={project.issueTypes}
      savedView={editor.activeView != null}
    />
  );
  // A new view from the page's filters is named after them ("Priorität: Hoch"), never
  // "Alle" (owner, 28.09.); the name stays editable.
  const suggestedViewName = describeConditions(editor.filters, project, customFields)
    .join(', ')
    .slice(0, 80);
  const controls = (
    <FilterPills
      filters={editor.filters}
      saved={editor.activeView?.filters ?? null}
      onChange={editor.changeFilters}
      project={project}
      customFields={customFields}
    />
  );

  return (
    <Page variant="fill">
      <PageToolbar>
        {/* The toolbar stays while a view is being made or edited (owner, 28.09.): the
            page behind the overlay keeps its filters, display and layout, which edit the
            same draft. Only the "changed" state and the page actions step back. */}
        {controls}
        {!editor.editing && (
          <>
            {(editor.changed || (!editor.activeView && editor.filters.conditions.length > 0)) && (
              <span className="ds-changed">
                {editor.changed && (
                  <>
                    <span className="ds-changed-dot" aria-hidden="true" />
                    {tViews('changed')}
                    <button type="button" onClick={editor.resetChanges}>
                      {tViews('reset')}
                    </button>
                    {can('views', 'edit') && (
                      <button
                        type="button"
                        className="is-save"
                        onClick={() => void editor.saveEdits()}
                      >
                        {tCommon('save')}
                      </button>
                    )}
                  </>
                )}
                {can('views', 'create') && (
                  <button
                    type="button"
                    className="is-new"
                    onClick={() => editor.beginNewView('current', suggestedViewName)}
                  >
                    {tViews('saveAsNewShort')}
                  </button>
                )}
              </span>
            )}
          </>
        )}
        <span className="ds-toolbar-fill" />
        {fields}
        {display}
        {layoutSwitch}
        {!editor.editing && (
          <>
            <PageActions
              actions={
                editor.activeView && !editor.changed && can('views', 'edit')
                  ? [
                      {
                        id: 'edit-view',
                        label: t('editView'),
                        icon: Pencil,
                        onClick: () => editor.beginEditView(editor.activeView!),
                        menuOnly: true,
                      },
                    ]
                  : []
              }
              primary={
                can('work_items', 'create')
                  ? {
                      id: 'new-issue',
                      label: t('newIssue'),
                      icon: Plus,
                      onClick: () => onAddIssue({}),
                    }
                  : undefined
              }
            />
          </>
        )}
      </PageToolbar>
      {editor.editing && (
        // Edit view / New view (owner 28.09.): in the one overlay on the right — the name
        // and icon, the layout, the filters and the display it keeps, Cancel and Save. The
        // page behind shows the result live; Save is the one write.
        <Overlay
          label={editor.activeView ? t('editView') : tViews('newView')}
          tabs={[{ id: 'view', label: editor.activeView ? t('editView') : tViews('newView') }]}
          onClose={editor.cancelEdits}
          className="ds-view-overlay"
        >
          <div className="ds-overlay-form">
            <SettingsGroup>
              <SettingsRow label={tCommon('name')} htmlFor="view-name" stacked>
                <span className="ds-inline-unit ds-view-name">
                  <ViewIconPicker icon={editor.draftIcon} onChange={editor.setDraftIcon} />
                  <TextField
                    id="view-name"
                    value={editor.draftName}
                    placeholder={t('viewNamePlaceholder')}
                    autoFocus
                    onChange={(e) => editor.setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canSaveDraft) void editor.saveEdits();
                    }}
                  />
                </span>
              </SettingsRow>
              {project.areas.length > 0 && (
                <SettingsRow label={tViews('group')} description={tViews('groupHint')}>
                  <Select
                    value={editor.draftAreaId == null ? 'none' : String(editor.draftAreaId)}
                    onValueChange={(value) =>
                      editor.setDraftAreaId(value === 'none' ? null : Number(value))
                    }
                  >
                    <SelectTrigger className="w-48" aria-label={tViews('group')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tViews('noGroup')}</SelectItem>
                      {project.areas.map((area) => (
                        <SelectItem key={area.id} value={String(area.id)}>
                          {area.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>
              )}
              <SettingsRow label={t('layout')} stacked>
                {layoutSwitch}
              </SettingsRow>
              <SettingsRow label={tViews('filters')} stacked>
                <div className="ds-overlay-pills">{controls}</div>
              </SettingsRow>
              <SettingsRow label={tViews('display')} description={tViews('displayHint')}>
                <BoardDisplayControl
                  view={editor.view}
                  onViewChange={editor.changeView}
                  settings={settings}
                  onSettingsChange={changeSettings}
                  customFields={customFields}
                  issueTypes={project.issueTypes}
                  showLabel
                />
              </SettingsRow>
            </SettingsGroup>
            <div className="ds-overlay-footer">
              {editor.activeView && can('views', 'delete') && (
                <Button
                  variant="danger"
                  className="ds-overlay-footer-start"
                  onClick={() => setDeleting(true)}
                >
                  {tViews('deleteView')}
                </Button>
              )}
              <Button variant="quiet" onClick={editor.cancelEdits}>
                {tCommon('cancel')}
              </Button>
              {canSaveView && (
                <Button
                  variant="primary"
                  disabled={!canSaveDraft}
                  onClick={() => void editor.saveEdits()}
                >
                  {tCommon('save')}
                </Button>
              )}
            </div>
          </div>
        </Overlay>
      )}
      {deleting && editor.activeView && (
        <ConfirmDialog
          title={tViews('deleteViewTitle', { name: editor.activeView.name })}
          confirmLabel={tViews('deleteView')}
          onConfirm={async () => {
            const target = editor.activeView!;
            setDeleting(false);
            editor.cancelEdits();
            await editor.deleteView(target);
          }}
          onClose={() => setDeleting(false)}
        >
          {tViews('deleteViewHint')}
        </ConfirmDialog>
      )}

      <div className="ds-work-items-body">
        <IssueLinksProvider issues={project.issues} enabled={settings.showLinks}>
          <SubtasksProvider
            issues={project.issues}
            enabled={settings.showSubtasks}
            collapsed={settings.collapseSubtasks}
          >
            {renderView()}
          </SubtasksProvider>
        </IssueLinksProvider>
      </div>
    </Page>
  );
}
