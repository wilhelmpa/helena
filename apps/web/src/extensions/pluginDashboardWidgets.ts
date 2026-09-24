'use client';

import { useEffect } from 'react';
import type { DashboardAudience, UiSlotDescriptor } from '@helena/sdk/web';
import { usePluginUiSlotsQuery } from '@/services/plugins.service';
import {
  dashboardWidgets,
  registerDashboardWidget,
  type DashboardWidget,
} from './dashboardWidgets';
import { pluginFrameUrl } from './pluginPanelTools';

// Adds the Start widgets of loaded plugins (frame slots `dashboard-widget` with the surface
// `home`, as the API lists them) to the widget registry, and removes them again when they
// are gone. Their id is `plugin:<pluginId>:<id>`, so no plugin can take a built-in's place.

export function pluginWidgetId(pluginId: string, id: string): string {
  return `plugin:${pluginId}:${id}`;
}

// A plugin's slot as a Start widget, or null when it is not one (another surface, no
// frame, options Helena does not know).
export function pluginDashboardWidget(slot: UiSlotDescriptor): DashboardWidget | null {
  if (slot.slot !== 'dashboard-widget' || slot.render?.kind !== 'frame') return null;
  const options = slot.options as {
    group?: unknown;
    surfaces?: unknown;
    kind?: unknown;
    audience?: unknown;
    width?: unknown;
    rows?: unknown;
    hiddenByDefault?: unknown;
  };
  if (!Array.isArray(options.surfaces) || !options.surfaces.includes('home')) return null;
  return {
    id: pluginWidgetId(slot.pluginId, slot.id),
    label: slot.label,
    kind: options.kind === 'figure' ? 'figure' : 'section',
    group: typeof options.group === 'string' ? options.group : slot.pluginId,
    order: slot.order ?? 1000,
    audience: (options.audience === 'owner' ? 'owner' : 'everyone') as DashboardAudience,
    width: options.width === 'full' ? 'full' : 'half',
    rows:
      typeof options.rows === 'number' && Number.isInteger(options.rows)
        ? Math.min(16, Math.max(1, options.rows))
        : 3,
    hiddenByDefault: options.hiddenByDefault === true,
    view: { kind: 'frame', url: pluginFrameUrl(slot.pluginId, slot.render.src) },
    pluginId: slot.pluginId,
  };
}

export function usePluginDashboardWidgets(): void {
  const slots = usePluginUiSlotsQuery();
  useEffect(() => {
    const offs: Array<() => void> = [];
    for (const slot of slots.data ?? []) {
      const widget = pluginDashboardWidget(slot);
      if (!widget || dashboardWidgets.has(widget.id)) continue;
      try {
        offs.push(registerDashboardWidget(widget, slot.pluginId));
      } catch (error) {
        console.warn(error instanceof Error ? error.message : error);
      }
    }
    return () => {
      for (const off of offs) off();
    };
  }, [slots.data]);
}
