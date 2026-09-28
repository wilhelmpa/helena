'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, LayoutTemplate, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { dashboardPath, dashboardsPath } from '@/utils/paths';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PageActions,
  PageToolbar,
  PageToolbarSpacer,
  usePageToolbarRoom,
  type PageAction,
} from '@/components/layout/PageToolbar';
import type { Dashboard } from '@/lib/api/endpoints/dashboards';
import { useDashboardsQuery } from '@/services/dashboards.service';
import { useDashboardEditor } from './hooks/useDashboardEditor';
import DashboardTabs from './components/DashboardTabs';
import { cn } from '@/lib/utils';
import { PAGE_GUTTER_CLASS } from '@/components/common/page/SectionPageView';
import WidgetGrid from './components/WidgetGrid';
import AddWidgetDialog from './components/AddWidgetDialog';
import DashboardNameDialog from './components/DashboardNameDialog';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import TradingDashboard from './components/TradingDashboard';

// The dashboards section: a tab strip of named dashboards over a grid of analytics
// widgets. The active dashboard comes from the route; with none selected the first
// saved dashboard shows, or a built-in default when the project has none. Layout
// edits are local until saved (see useDashboardEditor). Everything the page offers is
// one header row (PageToolbar): the tabs, then editing the layout — while editing:
// add a widget, discard, and save or done as the primary action.
export default function DashboardsPage() {
  const t = useTranslations('dashboards');
  const tCommon = useTranslations('common');
  const { project } = useShell();
  const { can } = usePermissions();
  const params = useParams<{ projectKey: string; dashboardId?: string }>();
  const router = useRouter();
  const projectKey = params.projectKey;

  const { data: dashboards, isLoading } = useDashboardsQuery(projectKey);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  // Name dialog state: 'new' to create, a dashboard to rename, or null (closed).
  const [nameDialog, setNameDialog] = useState<'new' | Dashboard | null>(null);
  // The dashboard whose deletion waits for a yes, like every other delete.
  const [deleting, setDeleting] = useState<Dashboard | null>(null);
  const renaming = nameDialog && nameDialog !== 'new' ? nameDialog : null;

  const list = dashboards ?? [];
  const routeId = params.dashboardId ? Number(params.dashboardId) : null;
  // With no id in the URL, fall back to the first saved dashboard.
  const activeDashboardId = routeId ?? list[0]?.id ?? null;

  const editor = useDashboardEditor(projectKey, list, activeDashboardId, (id) =>
    router.push(id != null ? dashboardPath(projectKey, id) : dashboardsPath(projectKey)),
  );

  if (!project || isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4">
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!can('dashboards', 'read')) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {t('noAccess')}
      </div>
    );
  }

  // Layout editing (add/move/resize/remove widgets, save) is a dashboards edit.
  const canEditLayout = can('dashboards', 'edit');
  const active = editor.isVirtual ? null : (list.find((d) => d.id === activeDashboardId) ?? null);
  const isTradingDashboard = active?.layout.some((widget) =>
    widget.config?.pluginWidgetId?.startsWith('plugin:helena.trading:'),
  );
  if (active && isTradingDashboard && !editing) {
    return (
      <TradingDashboard
        dashboard={active}
        projectKey={projectKey}
        canEdit={canEditLayout}
        onAddWidget={() => {
          setEditing(true);
          setAdding(true);
        }}
      />
    );
  }

  function saveLabel() {
    if (editor.saving) return tCommon('saving');
    return editor.isVirtual ? t('saveDashboard') : t('saveChanges');
  }

  const layoutActions: PageAction[] = [];
  let primary: Omit<PageAction, 'menuOnly'> | undefined;
  if (canEditLayout && !editing) {
    layoutActions.push({
      id: 'edit-layout',
      label: t('editLayout'),
      icon: LayoutTemplate,
      onClick: () => setEditing(true),
    });
  } else if (canEditLayout) {
    layoutActions.push({
      id: 'add-widget',
      label: t('addWidget'),
      icon: Plus,
      onClick: () => setAdding(true),
    });
    if (editor.dirty) {
      layoutActions.push({
        id: 'discard',
        label: t('discard'),
        icon: Undo2,
        disabled: editor.saving,
        onClick: () => editor.discard(),
      });
      primary = {
        id: 'save',
        label: saveLabel(),
        icon: Check,
        disabled: editor.saving,
        onClick: () => void editor.save(),
      };
    } else {
      primary = {
        id: 'done',
        label: tCommon('done'),
        icon: Check,
        onClick: () => setEditing(false),
      };
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageToolbar>
        <DashboardTabs
          dashboards={list}
          activeDashboardId={activeDashboardId}
          isVirtual={editor.isVirtual}
          onSelect={(id) => router.push(dashboardPath(projectKey, id))}
          onNew={() => setNameDialog('new')}
          onRename={(d) => setNameDialog(d)}
          onDelete={setDeleting}
          onReorder={(dragged, target) => editor.reorderDashboards(dragged, target)}
        />
        <PageToolbarSpacer />
        <DashboardRowActions
          actions={layoutActions}
          primary={primary}
          active={active}
          onNew={() => setNameDialog('new')}
          onRename={(d) => setNameDialog(d)}
          onDelete={setDeleting}
        />
      </PageToolbar>

      <div className="flex-1 overflow-y-auto">
        <div className={cn('w-full', PAGE_GUTTER_CLASS)}>
          <WidgetGrid projectKey={projectKey} project={project} editor={editor} editing={editing} />
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title={t('deleteDashboard')}
          confirmLabel={tCommon('delete')}
          onConfirm={async () => {
            await editor.deleteDashboard(deleting);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        >
          {t('deleteDashboardConfirm', { name: deleting.name })}
        </ConfirmDialog>
      )}

      <AddWidgetDialog
        open={adding}
        onOpenChange={setAdding}
        onAdd={(type) => editor.addWidget(type)}
        onAddPlugin={(widget, label) => editor.addPluginWidget(widget, label)}
      />
      <DashboardNameDialog
        key={renaming?.id ?? (nameDialog === 'new' ? 'new' : 'closed')}
        open={nameDialog != null}
        title={renaming ? t('renameDashboard') : t('newDashboard')}
        initial={renaming?.name ?? ''}
        onClose={() => setNameDialog(null)}
        onSubmit={(name) => {
          if (renaming) void editor.renameDashboard(renaming, name);
          else if (nameDialog === 'new') void editor.createDashboard(name);
          setNameDialog(null);
        }}
      />
    </div>
  );
}

// The row's actions. While the tabs have room, New, Rename and Delete are on the tab
// strip; once the tabs fold into their dropdown, they move into the "…" menu here.
function DashboardRowActions({
  actions,
  primary,
  active,
  onNew,
  onRename,
  onDelete,
}: {
  actions: PageAction[];
  primary: Omit<PageAction, 'menuOnly'> | undefined;
  active: Dashboard | null;
  onNew: () => void;
  onRename: (d: Dashboard) => void;
  onDelete: (d: Dashboard) => void;
}) {
  const t = useTranslations('dashboards');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const room = usePageToolbarRoom();
  const all = [...actions];
  if (!room.tabs) {
    if (can('dashboards', 'create'))
      all.push({ id: 'new', label: t('newDashboard'), icon: Plus, onClick: onNew, menuOnly: true });
    if (active && can('dashboards', 'edit'))
      all.push({
        id: 'rename',
        label: t('rename'),
        icon: Pencil,
        onClick: () => onRename(active),
        menuOnly: true,
      });
    if (active && can('dashboards', 'delete'))
      all.push({
        id: 'delete',
        label: tCommon('delete'),
        icon: Trash2,
        onClick: () => onDelete(active),
        menuOnly: true,
      });
  }
  return <PageActions actions={all} primary={primary} />;
}
