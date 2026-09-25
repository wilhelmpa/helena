import type { HomeDashboardPreference } from '@/lib/api/endpoints/userPreferences';

// How Start lays out its widgets from the registry and the reader's arrangement
// (user_preference.home_dashboard): which ones show, in which order, and how the sections
// pair up in two columns. Free of React, so it is tested on its own.

export interface ArrangeableWidget {
  id: string;
  hiddenByDefault: boolean;
}

export interface Arranged<W> {
  widget: W;
  visible: boolean;
}

export const EMPTY_ARRANGEMENT: HomeDashboardPreference = {
  order: [],
  hidden: [],
  shown: [],
  dismissed: [],
};

// Whether the reader sees a widget: turned on by hand, or on by default and not turned off.
export function isVisible(widget: ArrangeableWidget, prefs: HomeDashboardPreference): boolean {
  if (prefs.shown.includes(widget.id)) return true;
  return !widget.hiddenByDefault && !prefs.hidden.includes(widget.id);
}

// The widgets in the reader's order. `widgets` comes in the default order (the registry's);
// the ones the reader placed keep their places, and one they never saw (new, or from a
// plugin) goes right after the widget it follows by default, or first.
export function arrange<W extends ArrangeableWidget>(
  widgets: W[],
  prefs: HomeDashboardPreference,
): Arranged<W>[] {
  const rank = new Map(prefs.order.map((id, index) => [id, index]));
  const result = widgets
    .filter((widget) => rank.has(widget.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  widgets.forEach((widget, index) => {
    if (rank.has(widget.id)) return;
    const before = widgets
      .slice(0, index)
      .reverse()
      .find((other) => result.includes(other));
    result.splice(before ? result.indexOf(before) + 1 : 0, 0, widget);
  });
  return result.map((widget) => ({ widget, visible: isVisible(widget, prefs) }));
}

// The arrangement after moving `id` to `to` (an index in `ids`, the order as shown).
export function moveTo(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || to < 0 || to >= ids.length || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

// The reader's arrangement after turning a widget on or off.
export function withVisibility(
  prefs: HomeDashboardPreference,
  widget: ArrangeableWidget,
  visible: boolean,
): HomeDashboardPreference {
  const hidden = prefs.hidden.filter((id) => id !== widget.id);
  const shown = prefs.shown.filter((id) => id !== widget.id);
  if (visible && widget.hiddenByDefault) shown.push(widget.id);
  if (!visible && !widget.hiddenByDefault) hidden.push(widget.id);
  return { ...prefs, hidden, shown };
}

// The hidden failures after hiding `key`: only keys still reported are kept (`present`),
// and never more than the preference holds.
export const MAX_DISMISSED = 200;
export function withDismissed(
  prefs: HomeDashboardPreference,
  key: string,
  present: readonly string[],
): HomeDashboardPreference {
  const live = new Set(present);
  const kept = prefs.dismissed.filter((id) => id !== key && live.has(id));
  return { ...prefs, dismissed: [...kept, key].slice(-MAX_DISMISSED) };
}

export type SectionBlock<W> = { kind: 'pair'; items: W[] } | { kind: 'full'; item: W };

// The sections in blocks: half-width ones pair up in two columns (on a wide screen), a
// full-width one stands on its own and starts the next block.
export function sectionBlocks<W extends { width: 'half' | 'full' }>(
  sections: W[],
): SectionBlock<W>[] {
  const blocks: SectionBlock<W>[] = [];
  for (const section of sections) {
    const last = blocks.at(-1);
    if (section.width === 'full') blocks.push({ kind: 'full', item: section });
    else if (last?.kind === 'pair') last.items.push(section);
    else blocks.push({ kind: 'pair', items: [section] });
  }
  return blocks;
}

// A pair block as two columns: the first, third, … section left, the others right, so the
// reading order (left, right, left, right) stays the reader's order.
export function columnsOf<W>(items: W[]): [W[], W[]] {
  return [items.filter((_, index) => index % 2 === 0), items.filter((_, index) => index % 2 === 1)];
}
