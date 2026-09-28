'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
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
  restoreHiddenSections,
  withoutHiddenSections,
  type ViewSettings,
} from '@/utils/viewSettings';
import { CalendarDays, Check, Pencil, Plus, X } from 'lucide-react';
import { cyclesPath } from '@/utils/paths';
import ViewIconPicker from '@/components/layout/ViewIconPicker';
import ViewFolderManager from '@/components/layout/ViewFolderManager';
import { FilterControl } from '@/components/layout/FilterBar';
import {
  PageActions,
  PageToolbar,
  PageToolbarSpacer,
  PAGE_CONTROL_CLASS,
  PAGE_PRIMARY_CLASS,
  type PageAction,
} from '@/components/layout/PageToolbar';
import { cn } from '@/lib/utils';
import { useViewFoldersQuery, useViewsQuery } from '@/services/views.service';
import BoardDisplayControl from './components/BoardDisplayControl';
import { IssueLinksProvider } from './context/useIssueLinks';
import { SubtasksProvider } from './context/useSubtasks';
import KanbanBoard from './components/kanban/KanbanBoard';
import TableView from './components/table/TableView';
import TimelineView from './components/timeline/TimelineView';
import CalendarView from './components/calendar/CalendarView';

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
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tViews = useTranslations('views');
  const { project, filteredProject, editor, customFields, onOpenIssue, onAddIssue } = useShell();
  const { can } = usePermissions();
  const groupLabels = useGroupLabels();
  const features = useProjectFeatures();
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

  const { data: folders = [] } = useViewFoldersQuery(projectKey || null);

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
  const settings = withoutHiddenSections(editor.settings, features);
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
      default:
        return <KanbanBoard {...viewProps} />;
    }
  }

  const controls = (
    <>
      <FilterControl
        filters={editor.filters}
        onChange={editor.changeFilters}
        project={project}
        customFields={customFields}
      />
      <BoardDisplayControl
        view={editor.view}
        onViewChange={editor.changeView}
        settings={settings}
        onSettingsChange={changeSettings}
        customFields={customFields}
        issueTypes={project.issueTypes}
      />
      {features.cycles && can('cycles', 'read') && (
        <Link href={cyclesPath(projectKey)} className={PAGE_CONTROL_CLASS}>
          <CalendarDays size={16} aria-hidden="true" />
          {tNav('cycles')}
        </Link>
      )}
    </>
  );

  // The edit bar's two actions: Save is the row's one filled button.
  const editActions: PageAction[] = [
    { id: 'cancel', label: tCommon('cancel'), icon: X, onClick: editor.cancelEdits },
  ];

  return (
    <>
      <PageToolbar>
        {editor.editing ? (
          // The view edit bar (Edit view / New view): the name and icon of the view,
          // the filter and display it will keep, and Cancel/Save. Save is the one
          // write; it updates the active view or creates one from the live state.
          <>
            <ViewIconPicker icon={editor.draftIcon} onChange={editor.setDraftIcon} />
            <input
              value={editor.draftName}
              placeholder={t('viewNamePlaceholder')}
              aria-label={t('viewNamePlaceholder')}
              autoFocus
              onChange={(e) => editor.setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSaveDraft) void editor.saveEdits();
                if (e.key === 'Escape') editor.cancelEdits();
              }}
              className="h-7 min-w-24 flex-1 rounded-md bg-transparent px-1.5 text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:bg-sidebar-accent/40"
            />
            {controls}
            <PageActions
              actions={editActions}
              primary={
                canSaveView
                  ? {
                      id: 'save',
                      label: tCommon('save'),
                      icon: Check,
                      disabled: !canSaveDraft,
                      onClick: () => void editor.saveEdits(),
                    }
                  : undefined
              }
            />
          </>
        ) : (
          <>
            <PageToolbarSpacer />
            {can('views', 'edit') && (
              <ViewFolderManager projectKey={project.project.key} folders={folders} />
            )}
            {controls}
            {editor.changed && (
              <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <span>{tViews('changed')}</span>
                {can('views', 'edit') && (
                  <button
                    type="button"
                    onClick={() => void editor.saveEdits()}
                    className={cn(PAGE_CONTROL_CLASS, PAGE_PRIMARY_CLASS, 'max-sm:px-1')}
                  >
                    {tCommon('save')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={editor.resetChanges}
                  className={cn(PAGE_CONTROL_CLASS, 'max-sm:px-1')}
                >
                  {tViews('reset')}
                </button>
              </div>
            )}
            {can('views', 'create') && (
              <button
                type="button"
                onClick={() => editor.beginNewView('current')}
                aria-label={tViews('saveAsNew')}
                title={tViews('saveAsNew')}
                className={cn(PAGE_CONTROL_CLASS, 'max-sm:w-8 max-sm:justify-center max-sm:px-0')}
              >
                <Plus aria-hidden="true" />
                <span className="hidden lg:inline">{tViews('saveAsNew')}</span>
              </button>
            )}
            <PageActions
              actions={
                editor.activeView && !editor.changed && can('views', 'edit')
                  ? [
                      {
                        id: 'edit-view',
                        label: t('editView'),
                        icon: Pencil,
                        onClick: () => editor.beginEditView(editor.activeView!),
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

      <div className="relative flex-1 overflow-hidden">
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
    </>
  );
}
