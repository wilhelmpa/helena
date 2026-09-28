import { useEffect, useRef, useState } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import { useTranslations } from 'next-intl';
import type { View } from '@/lib/api/endpoints/views';
import type { WorkItemsView } from '@/utils/viewTypes';
import {
  normalizeView,
  useCreateView,
  useDeleteView,
  useReorderViews,
  useUpdateView,
} from '@/services/views.service';
import { EMPTY_FILTER_SET, isActiveFilterSet, type FilterSet } from '@/utils/filters';
import {
  defaultViewSettings,
  getViewSettings,
  setViewSettings,
  type SavedViewDisplay,
  type ViewSettings,
} from '@/utils/viewSettings';
import {
  clearViewDraft,
  readViewDraft,
  viewDraftChanged,
  viewDraftKey,
  writeViewDraft,
} from '@/utils/viewDraft';

export type ViewTemplate = 'current' | 'mine' | 'open' | 'week' | 'status';

// Which layout (project/table/timeline/calendar) the All tab shows is a global
// preference. The settings of each layout are stored per project in
// lib/viewSettings.
const VIEW_KEY = 'planner_view';

function loadView(): WorkItemsView {
  // Runs in a useState initializer, which also executes during server render —
  // there is no localStorage there, so fall back to the default layout.
  if (typeof window === 'undefined') return 'kanban';
  const raw = localStorage.getItem(VIEW_KEY);
  return raw === 'kanban' || raw === 'table' || raw === 'timeline' || raw === 'calendar'
    ? raw
    : 'kanban';
}

// A view inside an area shows only that area's issues. The condition is added
// behind the view's own ones and is never stored with them, so moving the view to
// another area moves what it shows.
function withArea(filters: FilterSet, areaId: number | null): FilterSet {
  if (areaId == null) return filters;
  return {
    conditions: [
      ...filters.conditions,
      { id: 'area-scope', field: 'area', op: 'is', values: [areaId] },
    ],
  };
}

// A saved view's display snapshot is the current layout plus that layout's
// settings.
function toDisplay(view: WorkItemsView, settings: ViewSettings): SavedViewDisplay {
  return { layout: view, ...settings };
}

// The saved-views and display/filter editing for one project. The active view is
// controlled: it comes from the caller (the route param) and selecting a view
// calls onSelectView to navigate. This hook owns the live layout, its display
// settings, the live filter set and the inline edit-bar state, and loads the
// selection's display whenever the active view (or project) changes.
//
// Changes to a saved view stay in a per-user draft until Save writes the shared view.
export function useViewEditor(
  projectKey: string | null,
  views: View[],
  activeViewId: number | null,
  onSelectView: (id: number | null) => void,
  userId: string | null,
) {
  const t = useTranslations('views');
  const [view, setView] = useState<WorkItemsView>(loadView);
  const [settings, setSettings] = useState<ViewSettings>(() => defaultViewSettings(loadView()));
  const [filters, setFilters] = useState<FilterSet>(EMPTY_FILTER_SET);
  // editing is true while the name/Cancel/Save bar is shown. draftName/draftIcon
  // back the name input and icon picker in the bar.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  // The area a new view is drafted in: the one of the view New view was started
  // from, so the view is created there.
  const [draftAreaId, setDraftAreaId] = useState<number | null>(null);
  // Whether the filter row is shown.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const createView = useCreateView(projectKey);
  const updateView = useUpdateView(projectKey);
  const deleteViewMutation = useDeleteView(projectKey);
  const reorderViewsMutation = useReorderViews(projectKey);

  const activeView =
    activeViewId != null ? (views.find((v) => v.id === activeViewId) ?? null) : null;

  const areaId = activeView ? activeView.folderId : editing ? draftAreaId : null;

  // The filter row always holds the complete filter set of a saved view.
  const effectiveFilters = withArea(filters, areaId);

  const draftKey =
    userId && projectKey && activeView ? viewDraftKey(userId, projectKey, activeView.id) : null;
  const changed =
    !!activeView &&
    viewDraftChanged(
      { filters: activeView.filters, display: activeView.display },
      { filters, display: toDisplay(view, settings) },
    );

  function persistDraft(
    nextFilters: FilterSet,
    nextView: WorkItemsView,
    nextSettings: ViewSettings,
  ) {
    if (!userId || !projectKey) return;
    if (!activeView) {
      if (editing) return;
      const key = viewDraftKey(userId, projectKey, 0);
      if (nextFilters.conditions.length)
        writeViewDraft(key, { filters: nextFilters, display: toDisplay(nextView, nextSettings) });
      else clearViewDraft(key);
      return;
    }
    if (!draftKey) return;
    const draft = { filters: nextFilters, display: toDisplay(nextView, nextSettings) };
    if (viewDraftChanged({ filters: activeView.filters, display: activeView.display }, draft))
      writeViewDraft(draftKey, draft);
    else clearViewDraft(draftKey);
  }

  // All restores local layout settings and user filters; saved views restore drafts.
  function loadSelection(id: number | null) {
    if (id == null) {
      const allFilters =
        userId && projectKey ? readViewDraft(viewDraftKey(userId, projectKey, 0))?.filters : null;
      setFilters(allFilters ?? EMPTY_FILTER_SET);
      const allView = loadView();
      setView(allView);
      if (projectKey) setSettings(getViewSettings(projectKey, allView));
      return;
    }
    const v = views.find((x) => x.id === id);
    if (!v) return;
    const draft = userId && projectKey ? readViewDraft(viewDraftKey(userId, projectKey, id)) : null;
    const display = draft?.display ?? v.display;
    setFilters(draft?.filters ?? v.filters);
    setView(display.layout);
    const { layout: _layout, ...s } = display;
    setSettings(s);
  }

  // Apply the selection's display whenever the routed view or the project changes,
  // or once the selected view's data arrives. loadedRef keys on project+view so an
  // unrelated views refetch (e.g. after Save) does not clobber the live edit.
  // openEditNext lets beginNewView/beginEditView keep the edit bar open across the
  // navigation that changes the selection; keepLiveNext lets beginNewView carry the
  // live filters and display into the draft instead of reloading the selection.
  const loadedRef = useRef<string | null>(null);
  const openEditNext = useRef(false);
  const keepLiveNext = useRef(false);
  useEffect(() => {
    if (activeViewId != null && !views.some((v) => v.id === activeViewId)) return; // wait for views
    const key = `${userId}:${projectKey}:${activeViewId}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    if (keepLiveNext.current) keepLiveNext.current = false;
    else loadSelection(activeViewId);
    setEditing(openEditNext.current);
    openEditNext.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, projectKey, activeViewId, views]);

  // Enters edit mode, seeding the name and icon inputs from the given view (or
  // blank for a new/All-tab draft).
  function beginEdit(from: View | null) {
    setEditing(true);
    setDraftName(from?.name ?? '');
    setDraftIcon(from?.icon ?? null);
    if (from) setDraftAreaId(from.folderId);
  }

  // Enter edit mode for a new view, drafted from what is on screen: the active
  // view's conditions plus the ad-hoc ones, and the live display. Deselecting the
  // active view (navigating to the All tab) keeps that state, so saveEdits creates
  // (not updates).
  function beginNewView(template: ViewTemplate = 'current') {
    const name =
      template === 'current' ? (activeView?.name ?? t('all')) : t(`templates.${template}`);
    if (template !== 'current') {
      const templateSettings = defaultViewSettings(template === 'status' ? 'kanban' : view);
      if (template === 'status') {
        setView('kanban');
        setSettings({ ...templateSettings, group: 'status' });
      } else {
        setSettings(templateSettings);
      }
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      setFilters({
        conditions:
          template === 'mine' && userId
            ? [{ id: 'c0', field: 'assignee', op: 'is', values: [userId] }]
            : template === 'open'
              ? [
                  {
                    id: 'c0',
                    field: 'statusType',
                    op: 'is_not',
                    values: ['completed', 'canceled', 'closed'],
                  },
                ]
              : template === 'week'
                ? [
                    {
                      id: 'c0',
                      field: 'dueDate',
                      op: 'after',
                      values: [format(addDays(weekStart, -1), 'yyyy-MM-dd')],
                    },
                    {
                      id: 'c1',
                      field: 'dueDate',
                      op: 'before',
                      values: [format(addDays(weekStart, 7), 'yyyy-MM-dd')],
                    },
                  ]
                : [],
      });
    }
    setDraftAreaId(activeView?.folderId ?? null);
    if (activeViewId != null) {
      openEditNext.current = true;
      keepLiveNext.current = true;
      onSelectView(null);
    }
    beginEdit(null);
    setDraftName(name);
  }

  function changeView(next: WorkItemsView) {
    setView(next);
    if (activeViewId == null && !editing) {
      // On the All tab (not editing), layout + its settings are the ad-hoc
      // localStorage default.
      localStorage.setItem(VIEW_KEY, next);
      if (projectKey) setSettings(getViewSettings(projectKey, next));
    } else {
      // Start the new layout from its defaults; saved views keep it as a draft.
      setSettings(defaultViewSettings(next));
      persistDraft(filters, next, defaultViewSettings(next));
    }
  }

  function changeSettings(next: ViewSettings) {
    setSettings(next);
    persistDraft(filters, view, next);
    // The All tab keeps its local display settings as a default.
    if (activeViewId == null && !editing && projectKey) setViewSettings(projectKey, view, next);
  }

  function changeFilters(next: FilterSet) {
    setFilters(next);
    persistDraft(next, view, settings);
  }

  function toggleFilters() {
    setFiltersOpen((open) => !open);
  }

  // Reset the live filters/display back to the selected view and leave edit mode.
  function cancelEdits() {
    setEditing(false);
    loadSelection(activeViewId);
  }

  function resetChanges() {
    if (draftKey) clearViewDraft(draftKey);
    loadSelection(activeViewId);
  }

  // Update the shared view, or create one from the current draft and select it.
  async function saveEdits() {
    if (!projectKey) return;
    const name = draftName.trim();
    const display = toDisplay(view, settings);
    if (activeView) {
      await updateView.mutateAsync({
        id: activeView.id,
        input: {
          name: editing ? name || activeView.name : activeView.name,
          icon: editing ? draftIcon : activeView.icon,
          folderId: editing ? draftAreaId : activeView.folderId,
          filters,
          display,
        },
      });
      if (draftKey) clearViewDraft(draftKey);
      setEditing(false);
    } else {
      if (!name) return; // Save is disabled without a name for a new view.
      const created = normalizeView(
        await createView.mutateAsync({
          input: { name, icon: draftIcon, filters, display, folderId: draftAreaId },
        }),
      );
      setEditing(false);
      onSelectView(created.id);
    }
  }

  // Edit from a tab's menu, keeping the edit bar open across navigation.
  function beginEditView(target: View) {
    if (activeViewId !== target.id) {
      openEditNext.current = true;
      onSelectView(target.id); // the load effect fills the filter row for the edit
    }
    beginEdit(target);
  }

  // The views deleted here: their address going dead is expected, not a stale link.
  const deletedIds = useRef(new Set<number>());

  async function deleteView(target: View) {
    deletedIds.current.add(target.id);
    await deleteViewMutation.mutateAsync(target.id);
    if (activeViewId === target.id) onSelectView(null);
    if (userId && projectKey) clearViewDraft(viewDraftKey(userId, projectKey, target.id));
  }

  // Moves the dragged view to the dropped-on view's slot and persists the full
  // order; a null target means the front (the drop on the fixed All tab). The move
  // applies to the stored order, not to the tab row — favorites are pinned to the
  // front for the caller only, while position is shared by the project.
  function reorderView(draggedId: number, targetId: number | null) {
    if (draggedId === targetId) return;
    const dragged = views.find((view) => view.id === draggedId);
    if (!dragged) return;
    const target = targetId == null ? null : views.find((view) => view.id === targetId);
    if (target && target.folderId !== dragged.folderId) return;
    const next = views
      .filter((view) => view.folderId === dragged.folderId)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const from = next.findIndex((v) => v.id === draggedId);
    const to = targetId == null ? 0 : next.findIndex((v) => v.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    reorderViewsMutation.mutate({
      folderId: dragged.folderId,
      orderedIds: next.map((view) => view.id),
    });
  }

  return {
    view,
    settings,
    filters,
    effectiveFilters,
    // Applied filters keep the filter row visible.
    showFilters: filtersOpen || editing || isActiveFilterSet(filters),
    activeViewId,
    activeView,
    editing,
    changed,
    draftName,
    setDraftName,
    draftIcon,
    setDraftIcon,
    // The group (a folder of views in the sidebar) the view is kept in.
    draftAreaId,
    setDraftAreaId,
    beginNewView,
    changeView,
    changeSettings,
    changeFilters,
    toggleFilters,
    // Selecting a saved view (or the All tab when id is null) navigates; the load
    // effect then applies its display and leaves edit mode.
    selectView: onSelectView,
    cancelEdits,
    resetChanges,
    saveEdits,
    beginEditView,
    deleteView,
    wasDeleted: (id: number) => deletedIds.current.has(id),
    reorderView,
  };
}
