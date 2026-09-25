'use client';

import { useSyncExternalStore, type ComponentType } from 'react';
import { Registry, type LocalizedText } from '@helena/sdk/web';
import LocalAiServerSection from '@/features/local-ai/components/LocalAiServerSection';

// Sections of Administrator → Server as a registry (@helena/sdk UI slot `server-section`):
// a status or a control of the machine a feature adds to one of the Server tabs, below the
// tab's own sections. Built-ins register at the end of this file, one entry each (local AI's
// units, VRAM and models on the overview tab is the first).
//
// A plugin's frame section (a `server-section` slot with a frame render) is not shown yet.

export interface ServerSection {
  id: string;
  // The tab: overview, disks, backup, power or updates.
  area: string;
  label: LocalizedText;
  order: number;
  Component: ComponentType;
}

export const serverSections = new Registry<ServerSection>(
  'server section',
  (section) => section.id,
);

const subscribe = (listener: () => void) => serverSections.subscribe(listener);
const version = () => serverSections.version();

export function useServerSections(area: string): ServerSection[] {
  useSyncExternalStore(subscribe, version, version);
  return serverSections
    .list()
    .filter((section) => section.area === area)
    .sort((a, b) => a.order - b.order);
}

// Built-in sections, registered when the Server page loads this module.
const BUILTIN_SECTIONS: { section: ServerSection; pluginId: string }[] = [
  {
    section: {
      id: 'local-ai',
      area: 'overview',
      order: 50,
      label: { i18n: 'localAi.title' },
      Component: LocalAiServerSection,
    },
    pluginId: 'helena.local-ai',
  },
];

for (const { section, pluginId } of BUILTIN_SECTIONS)
  if (!serverSections.has(section.id)) serverSections.register(section, pluginId);
