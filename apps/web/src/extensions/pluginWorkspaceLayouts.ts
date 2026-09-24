'use client';

import { useEffect } from 'react';
import type { WorkspaceLayoutArea } from '@helena/sdk/web';
import { usePluginUiSlotsQuery } from '@/services/plugins.service';
import { panelTool } from './panelTools';
import { pluginPanelToolId } from './pluginPanelTools';
import {
  registerWorkspaceLayout,
  workspaceLayouts,
  type WorkspaceLayout,
} from './workspaceLayouts';

// Adds the workspace layouts of loaded plugins (`workspace-layout` slots the API lists) to
// the layout registry, and removes them again when they are gone. Their id is
// `plugin:<pluginId>:<id>`, so no plugin can take a built-in's place. A plugin names its
// own panel tools by their short id; a built-in's id (`chat`, `browser`) or a full
// `plugin:…` id stays as it is.

export function pluginToolRef(pluginId: string, tool: string | undefined): string | undefined {
  if (!tool || tool.includes(':') || panelTool(tool)) return tool;
  return pluginPanelToolId(pluginId, tool);
}

export function pluginLayout(
  pluginId: string,
  slot: { id: string; label: WorkspaceLayout['label']; order?: number },
  options: { areas?: unknown; full?: unknown },
): WorkspaceLayout | null {
  if (!Array.isArray(options.areas)) return null;
  const areas = (options.areas as WorkspaceLayoutArea[]).map((area) => ({
    ...area,
    tool: pluginToolRef(pluginId, area.tool),
  }));
  return {
    id: `plugin:${pluginId}:${slot.id}`,
    label: slot.label,
    order: slot.order ?? 1000,
    areas,
    full: options.full === true,
    optionalPanel: false,
    pluginId,
  };
}

export function usePluginWorkspaceLayouts(): void {
  const slots = usePluginUiSlotsQuery();
  useEffect(() => {
    const offs: Array<() => void> = [];
    for (const slot of slots.data ?? []) {
      if (slot.slot !== 'workspace-layout') continue;
      const layout = pluginLayout(slot.pluginId, slot, slot.options);
      if (!layout || workspaceLayouts.has(layout.id)) continue;
      try {
        offs.push(registerWorkspaceLayout(layout, slot.pluginId));
      } catch (error) {
        // A broken layout of one plugin must not take the app down; the Administrator
        // shows the plugin, the console says why its layout is missing.
        console.warn(error);
      }
    }
    return () => {
      for (const off of offs) off();
    };
  }, [slots.data]);
}
