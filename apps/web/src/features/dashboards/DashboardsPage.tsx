'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowDown,
  ArrowUp,
  Check,
  LayoutTemplate,
  Pencil,
  Plus,
  Target,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { dashboardPath, dashboardsPath, initiativesPath } from '@/utils/paths';
import { projectColor } from '@/utils/projectColor';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PageActions,
  PageToolbar,
  PageToolbarSpacer,
  type PageAction,
} from '@/components/layout/PageToolbar';
import type { Dashboard } from '@/lib/api/endpoints/dashboards';
import { useDashboardsQuery } from '@/services/dashboards.service';
import { useDashboardEditor } from './hooks/useDashboardEditor';
import WidgetGrid from './components/WidgetGrid';
import DashboardOverview from './components/DashboardOverview';
import { DashboardTitle, MonoLabel } from '@/components/helena/DashboardPrimitives';
import AddWidgetDialog from './components/AddWidgetDialog';
import DashboardNameDialog from './components/DashboardNameDialog';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import TradingDashboard from './components/TradingDashboard';

// The dashboards section: one named dashboard over a grid of analytics widgets. The
// dashboards are listed and chosen in the project tree only (no tab strip here, the
// tree is the one navigation). The active dashboard comes from the route; with none
// selected the first saved dashboard shows, or a built-in default when the project has
// none. Layout edits are local until saved (see useDashboardEditor). The header row
// (PageToolbar) holds editing the layout and the "…" menu with New, Rename, Move and
// Delete; while editing: add a widget, discard, and save or done as the primary action.
export default function DashboardsPage() {
  const t = useTranslations('dashboards');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const { project } = useShell();
  const { can } = usePermissions();
  const features = useProjectFeatures();
  const params = useParams<{ projectKey: string; dashboardId?: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectKey = params.projectKey;

  const { data: dashboards, isLoading } = useDashboardsQuery(projectKey);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  // Name dialog state: 'new' to create, a dashboard to rename, or null (closed).
  const [nameDialog, setNameDialog] = useState<'new' | Dashboard | null>(null);
  // The dashboard whose deletion waits for a yes, like every other delete.
  const [deleting, setDeleting] = useState<Dashboard | null>(null);
  const renaming = nameDialog && nameDialog !== 'new' ? nameDialog : null;

  useEffect(() => {
    if (searchParams.get('create') !== 'dashboard' || !can('dashboards', 'create')) return;
    queueMicrotask(() => setNameDialog('new'));
    const next = new URLSearchParams(searchParams.toString());
    next.delete('create');
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`);
  }, [searchParams, can, router, pathname]);

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
  if (features.initiatives && can('initiatives', 'read')) {
    layoutActions.push({
      id: 'initiatives',
      label: tNav('initiatives'),
      icon: Target,
      href: initiativesPath(projectKey),
      menuOnly: true,
    });
  }
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
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{ '--dashboard-project': projectColor(projectKey) } as CSSProperties}
    >
      <PageToolbar>
        <PageToolbarSpacer />
        <DashboardRowActions
          actions={layoutActions}
          primary={primary}
          dashboards={list}
          active={active}
          onNew={() => setNameDialog('new')}
          onRename={(d) => setNameDialog(d)}
          onReorder={(dragged, target) => editor.reorderDashboards(dragged, target)}
          onDelete={setDeleting}
        />
      </PageToolbar>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full space-y-5 px-4 py-6 md:px-9">
          <header className="pt-2">
            <MonoLabel className="text-[var(--dashboard-project)]">
              {project.project.name} {'· Dashboard'}
            </MonoLabel>
            <DashboardTitle>{project.project.name}</DashboardTitle>
          </header>
          <DashboardOverview projectKey={projectKey} project={project} />
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

// The row's "…" menu: New, and for the dashboard on screen Rename, Move up/down (the
// order of the dashboards in the tree) and Delete. The one visible button is editing the
// layout; while editing, save or done is the primary action.
function DashboardRowActions({
  actions,
  primary,
  dashboards,
  active,
  onNew,
  onRename,
  onReorder,
  onDelete,
}: {
  actions: PageAction[];
  primary: Omit<PageAction, 'menuOnly'> | undefined;
  dashboards: Dashboard[];
  active: Dashboard | null;
  onNew: () => void;
  onRename: (d: Dashboard) => void;
  onReorder: (draggedId: number, targetId: number) => void;
  onDelete: (d: Dashboard) => void;
}) {
  const t = useTranslations('dashboards');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const all = [...actions];
  if (can('dashboards', 'create'))
    all.push({ id: 'new', label: t('newDashboard'), icon: Plus, onClick: onNew, menuOnly: true });
  if (active && can('dashboards', 'edit')) {
    const index = dashboards.findIndex((d) => d.id === active.id);
    const before = index > 0 ? dashboards[index - 1] : undefined;
    const after = index >= 0 ? dashboards[index + 1] : undefined;
    all.push({
      id: 'rename',
      label: t('rename'),
      icon: Pencil,
      onClick: () => onRename(active),
      menuOnly: true,
    });
    if (dashboards.length > 1) {
      all.push({
        id: 'move-up',
        label: t('moveUp'),
        icon: ArrowUp,
        disabled: !before,
        onClick: () => before && onReorder(active.id, before.id),
        menuOnly: true,
      });
      all.push({
        id: 'move-down',
        label: t('moveDown'),
        icon: ArrowDown,
        disabled: !after,
        onClick: () => after && onReorder(active.id, after.id),
        menuOnly: true,
      });
    }
  }
  if (active && can('dashboards', 'delete'))
    all.push({
      id: 'delete',
      label: tCommon('delete'),
      icon: Trash2,
      onClick: () => onDelete(active),
      menuOnly: true,
    });
  return <PageActions actions={all} primary={primary} />;
}
