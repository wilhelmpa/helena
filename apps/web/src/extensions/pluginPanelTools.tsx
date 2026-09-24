'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { resolveText } from '@helena/sdk/web';
import { API_URL } from '@/lib/api/core/client';
import { usePluginUiSlotsQuery } from '@/services/plugins.service';
import { byKey } from '@/utils/messageKey';
import { panelTools, pluginIcon, type PanelTool } from './panelTools';

// Adds the panel tools of loaded plugins (frame slots the API lists) to the panel tool
// registry, and removes them again when they are gone. Their id is
// `plugin:<pluginId>:<id>`, so no plugin can take a built-in's place.

export function pluginPanelToolId(pluginId: string, id: string): string {
  return `plugin:${pluginId}:${id}`;
}

// The address of a plugin page: its own ui/ folder on the API, or an absolute URL.
export function pluginFrameUrl(pluginId: string, src: string): string {
  if (/^https?:\/\//.test(src)) return src;
  const base = API_URL.replace(/\/+$/, '');
  return `${base}/plugins/${encodeURIComponent(pluginId)}/ui/${src.replace(/^\/+/, '')}`;
}

export function usePluginPanelTools(): void {
  const slots = usePluginUiSlotsQuery();
  useEffect(() => {
    const offs: Array<() => void> = [];
    for (const slot of slots.data ?? []) {
      if (slot.slot !== 'panel-tool' || slot.render?.kind !== 'frame') continue;
      const options = slot.options as {
        inHeader?: boolean;
        phonePinned?: boolean;
        projectScoped?: boolean;
      };
      const tool: PanelTool = {
        id: pluginPanelToolId(slot.pluginId, slot.id),
        label: slot.label,
        Icon: pluginIcon(slot.icon),
        order: slot.order ?? 1000,
        inHeader: options.inHeader === true,
        phonePinned: false,
        projectScoped: options.projectScoped === true,
        view: { kind: 'frame', url: pluginFrameUrl(slot.pluginId, slot.render.src) },
        pluginId: slot.pluginId,
      };
      if (!panelTools.has(tool.id)) offs.push(panelTools.register(tool, slot.pluginId));
    }
    return () => {
      for (const off of offs) off();
    };
  }, [slots.data]);
}

// A panel tool's label in the reader's language: a built-in's from the translation
// files, a plugin's from the texts it brings.
export function usePanelToolLabel(): (tool: Pick<PanelTool, 'label'> | undefined) => string {
  const t = byKey(useTranslations());
  const locale = useLocale();
  return (tool) => (tool ? resolveText(tool.label, locale, (key) => t(key)) : '');
}
