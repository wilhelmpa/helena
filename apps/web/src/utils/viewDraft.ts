import type { FilterSet } from '@/utils/filters';
import { normalizeSavedDisplay, type SavedViewDisplay } from '@/utils/viewSettings';

export interface ViewDraft {
  filters: FilterSet;
  display: SavedViewDisplay;
}

export function viewDraftKey(userId: string, projectKey: string, viewId: number): string {
  return `planner_view_draft:${userId}:${projectKey}:${viewId}`;
}

export function readViewDraft(key: string): ViewDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!value || !Array.isArray(value.filters?.conditions) || !value.display) return null;
    return {
      filters: value.filters as FilterSet,
      display: normalizeSavedDisplay(value.display),
    };
  } catch {
    return null;
  }
}

export function writeViewDraft(key: string, draft: ViewDraft): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Browsers can deny storage; the live edit still works for this session.
  }
}

export function clearViewDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // See writeViewDraft.
  }
}

export function viewDraftChanged(saved: ViewDraft, draft: ViewDraft): boolean {
  const filterShape = (filters: FilterSet) =>
    filters.conditions.map((condition) => [
      condition.id,
      condition.field,
      condition.op,
      condition.values,
    ]);
  return (
    JSON.stringify(filterShape(saved.filters)) !== JSON.stringify(filterShape(draft.filters)) ||
    JSON.stringify(normalizeSavedDisplay(saved.display)) !==
      JSON.stringify(normalizeSavedDisplay(draft.display))
  );
}
