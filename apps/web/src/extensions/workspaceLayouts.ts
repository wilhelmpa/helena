'use client';

import { useSyncExternalStore } from 'react';
import { Registry, type LocalizedText, type WorkspaceLayoutArea } from '@helena/sdk/web';

// The workspace layouts of the header's layout menu, as a registry (@helena/sdk UI slot
// `workspace-layout`). A layout is data: which areas sit side by side and what each shows
// (the page, the panel's own tool, or a tool of its own). The layout host
// (components/layout/WorkspaceLayoutHost) and the panel read the chosen layout from here,
// so a plugin's layout sits in the menu beside the built-ins below, and a plugin's panel
// tool can be put into any area. Built-ins register as the internal plugin
// `helena.layout`; plugins' layouts arrive from the API (usePluginWorkspaceLayouts).

export type { WorkspaceLayoutArea };

export interface WorkspaceLayout {
  id: string;
  label: LocalizedText;
  order: number;
  areas: WorkspaceLayoutArea[];
  full: boolean;
  // Only the standard layout: the panel opens and closes, and may float over the page.
  // In every other layout the panel stays, as on the dual kiosk's second screen.
  optionalPanel: boolean;
  pluginId: string;
}

export const LAYOUT_PLUGIN_ID = 'helena.layout';
export const STANDARD_LAYOUT_ID = 'standard';
export const FULL_LAYOUT_ID = 'tool-full';

// Room (px of window width) for the page beside a docked chat and a tool.
const ROOM_FOR_PAGE_BESIDE_CHAT = 1600;

export const workspaceLayouts = new Registry<WorkspaceLayout>(
  'workspace layout',
  (layout) => layout.id,
);

// Why a layout cannot be used, or null. Checked at registration, so a broken plugin
// layout fails loudly instead of rendering half a screen.
export function layoutProblem(layout: Pick<WorkspaceLayout, 'areas' | 'full'>): string | null {
  const ids = new Set<string>();
  for (const area of layout.areas) {
    if (!area.id || ids.has(area.id)) return `area id "${area.id}" is empty or used twice`;
    ids.add(area.id);
    if (area.shows === 'tool' && !area.tool) return `area "${area.id}" shows a tool but names none`;
  }
  if (layout.areas.filter((area) => area.shows === 'main').length !== 1) {
    return 'a layout has exactly one main area';
  }
  const pages = layout.areas.filter((area) => area.shows === 'page');
  if (pages.length > 1) return 'a layout shows the page at most once';
  if (pages.some((area) => area.side !== 'page')) return 'the page sits on the page side';
  if (layout.full && layout.areas.length !== 1) return 'a full layout has only its main area';
  return null;
}

export function registerWorkspaceLayout(layout: WorkspaceLayout, pluginId: string): () => void {
  const problem = layoutProblem(layout);
  if (problem) throw new Error(`Workspace layout "${layout.id}" from ${pluginId}: ${problem}`);
  return workspaceLayouts.register(layout, pluginId);
}

function builtin(
  id: string,
  order: number,
  areas: WorkspaceLayoutArea[],
  flags: Partial<Pick<WorkspaceLayout, 'full' | 'optionalPanel'>> = {},
): WorkspaceLayout {
  return {
    id,
    label:
      id === 'page-tool-half'
        ? { de: 'Geteilt 50/50', en: 'Split 50/50' }
        : { i18n: `nav.layout.layouts.${id}` },
    order,
    areas,
    full: flags.full ?? false,
    optionalPanel: flags.optionalPanel ?? false,
    pluginId: LAYOUT_PLUGIN_ID,
  };
}

const page: WorkspaceLayoutArea = { id: 'page', shows: 'page', side: 'page' };

for (const layout of [
  // Page | tool: the panel opens beside the page, as always.
  builtin(STANDARD_LAYOUT_ID, 10, [page, { id: 'main', shows: 'main', side: 'panel' }], {
    optionalPanel: true,
  }),
  builtin('page-tool-half', 15, [page, { id: 'main', shows: 'main', side: 'panel' }], {
    optionalPanel: true,
  }),
  // The chat docked beside the page on the first screen, a tool (the browser) on the
  // second. On one screen the page gives way to the chat below 1600px.
  builtin('chat-left', 20, [
    { ...page, minRoom: ROOM_FOR_PAGE_BESIDE_CHAT },
    { id: 'dock', shows: 'tool', tool: 'chat', side: 'page' },
    { id: 'main', shows: 'main', tool: 'browser', side: 'panel' },
  ]),
  // The chat instead of the page, a tool beside it.
  builtin('chat-tool', 30, [
    { id: 'chat', shows: 'tool', tool: 'chat', side: 'page' },
    { id: 'main', shows: 'main', tool: 'browser', side: 'panel' },
  ]),
  // The page, and two tools side by side in the panel.
  builtin('two-tools', 40, [
    page,
    { id: 'main', shows: 'main', side: 'panel' },
    { id: 'second', shows: 'tool', tool: 'terminal', side: 'panel' },
  ]),
  // One tool over everything (both screens of the dual kiosk).
  builtin(FULL_LAYOUT_ID, 50, [{ id: 'main', shows: 'main', side: 'panel' }], { full: true }),
]) {
  registerWorkspaceLayout(layout, LAYOUT_PLUGIN_ID);
}

let cache: { version: number; layouts: WorkspaceLayout[] } = { version: -1, layouts: [] };

function snapshot(): WorkspaceLayout[] {
  const version = workspaceLayouts.version();
  if (cache.version !== version) {
    cache = { version, layouts: workspaceLayouts.list().sort((a, b) => a.order - b.order) };
  }
  return cache.layouts;
}

// Every layout, in menu order; re-renders when a plugin's layout arrives or leaves.
export function useWorkspaceLayouts(): WorkspaceLayout[] {
  return useSyncExternalStore(
    (listener) => workspaceLayouts.subscribe(listener),
    snapshot,
    snapshot,
  );
}

export function workspaceLayout(id: string): WorkspaceLayout | undefined {
  return workspaceLayouts.get(id);
}

export function standardLayout(): WorkspaceLayout {
  return workspaceLayouts.require(STANDARD_LAYOUT_ID);
}
