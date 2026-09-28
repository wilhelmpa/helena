'use client';

import { useSyncExternalStore, type ComponentType } from 'react';
import {
  Registry,
  type DashboardAudience,
  type DashboardWidgetKind,
  type LocalizedText,
} from '@helena/sdk/web';

// The widgets of Start, as a registry (@helena/sdk UI slot `dashboard-widget`, surface
// `home`; docs/helena-decisions/dashboard.md). Start reads this list instead of a hard-wired
// page, so a feature's card or a plugin's sits beside the built-ins, and the reader can hide
// and reorder every one of them ("Anpassen"). Built-ins register in extensions/homeWidgets
// as the internal plugin `helena.home`; plugins' frame widgets arrive from the API
// (usePluginDashboardWidgets).
//
// Two kinds:
//   figure   a tile in the row at the top. Its component renders <FigureTile> (or several,
//            one per account) and returns null while it has nothing to show (no updates,
//            nothing installed): the row closes the gap.
//   section  a framed list below. Its component renders <DashboardSection>; while it loads
//            it shows `rows` placeholder rows, so nothing moves.

export type DashboardWidgetView =
  | { kind: 'component'; component: ComponentType }
  // A plugin's page, shown sandboxed in the tile or section.
  | { kind: 'frame'; url: string };

export interface DashboardWidget {
  id: string;
  label: LocalizedText;
  kind: DashboardWidgetKind;
  // What "Anpassen" groups it under ('work', 'agents', 'system', a plugin's own word).
  group: string;
  // Lower comes first; built-ins leave gaps of 10.
  order: number;
  audience: DashboardAudience;
  // A section: half the width or the whole width. Ignored for a figure.
  width: 'half' | 'full';
  // A section's placeholder rows while it loads.
  rows: number;
  hiddenByDefault: boolean;
  view: DashboardWidgetView;
  pluginId: string;
  size?: { w: number; h: number; minH?: number };
}

export const HOME_PLUGIN_ID = 'helena.home';
const MAX_ROWS = 16;

export const dashboardWidgets = new Registry<DashboardWidget>(
  'dashboard widget',
  (widget) => widget.id,
);

// Why a widget cannot be shown, or null. Checked at registration, so a broken plugin
// widget fails loudly instead of breaking the page.
export function widgetProblem(widget: Pick<DashboardWidget, 'kind' | 'width' | 'rows'>) {
  if (widget.kind !== 'figure' && widget.kind !== 'section') return `unknown kind "${widget.kind}"`;
  if (widget.width !== 'half' && widget.width !== 'full') return `unknown width "${widget.width}"`;
  if (!Number.isInteger(widget.rows) || widget.rows < 1 || widget.rows > MAX_ROWS)
    return `rows must be 1–${MAX_ROWS}`;
  return null;
}

export function registerDashboardWidget(widget: DashboardWidget, pluginId: string): () => void {
  const problem = widgetProblem(widget);
  if (problem) throw new Error(`Dashboard widget "${widget.id}" from ${pluginId}: ${problem}`);
  return dashboardWidgets.register({ ...widget, pluginId }, pluginId);
}

// A built-in widget with the defaults filled in.
export function homeWidget(
  widget: Pick<DashboardWidget, 'id' | 'kind' | 'group' | 'order'> & {
    component: ComponentType;
  } & Partial<Pick<DashboardWidget, 'audience' | 'width' | 'rows' | 'hiddenByDefault' | 'label'>>,
): DashboardWidget {
  return {
    id: widget.id,
    label: widget.label ?? { i18n: `home.widgets.${widget.id}` },
    kind: widget.kind,
    group: widget.group,
    order: widget.order,
    audience: widget.audience ?? 'everyone',
    width: widget.width ?? 'half',
    rows: widget.rows ?? 3,
    hiddenByDefault: widget.hiddenByDefault ?? false,
    view: { kind: 'component', component: widget.component },
    pluginId: HOME_PLUGIN_ID,
  };
}

function sorted(): DashboardWidget[] {
  return dashboardWidgets.list().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

let cache: { version: number; widgets: DashboardWidget[] } = { version: -1, widgets: [] };

function snapshot(): DashboardWidget[] {
  const version = dashboardWidgets.version();
  if (cache.version !== version) cache = { version, widgets: sorted() };
  return cache.widgets;
}

// Every registered widget in its default order; re-renders when a plugin's arrives or leaves.
export function useDashboardWidgets(): DashboardWidget[] {
  return useSyncExternalStore(
    (listener) => dashboardWidgets.subscribe(listener),
    snapshot,
    snapshot,
  );
}
