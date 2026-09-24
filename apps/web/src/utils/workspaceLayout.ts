import type { WorkspaceLayout } from '@/extensions/workspaceLayouts';

// The arithmetic of a workspace layout (extensions/workspaceLayouts.ts), free of React so
// it can be tested on its own: which areas a layout shows right now and with which tool
// (resolveWorkspaceLayout), where they sit in the layout host's grid (layoutGeometry), and
// what picking a tool in an area changes (pickAreaTool).

export type AreaSide = 'page' | 'panel';

export interface ResolvedArea {
  id: string;
  kind: 'page' | 'tool';
  // The tool the area shows; null for the page.
  tool: string | null;
  side: AreaSide;
  // The panel's own tool, the one the header's tool buttons pick.
  main: boolean;
  // Takes the room the other areas leave.
  fill: boolean;
}

export interface ResolvedLayout {
  id: string;
  areas: ResolvedArea[];
  full: boolean;
  // The panel opens, closes and may float over the page: the standard layout, except on
  // the dual kiosk, where the panel always fills the second screen.
  closable: boolean;
  pageVisible: boolean;
  // Every tool some area shows.
  shownTools: string[];
  // The main area's tool, or null when the main area is not showing.
  mainTool: string | null;
}

export interface ResolveInput {
  layout: WorkspaceLayout;
  // The panel's active tool (useWorkspacePanel).
  activeTool: string;
  // The tools the owner picked for this layout's own-tool areas, by area id.
  areaTools: Record<string, string>;
  // Whether the panel is open; only the standard layout lets it close.
  open: boolean;
  // The dual kiosk: the panel is pinned to the second screen.
  pinned: boolean;
  // The window's width in px.
  room: number;
  // The tool the page itself is (a chat page is the chat), or null.
  routedTool: string | null;
  // The panel tools, in order: what an area falls back to when its tool is shown elsewhere.
  tools: string[];
}

function isKnown(tool: string | undefined, tools: string[]): tool is string {
  // A plugin's tool arrives with the API's list after the page loaded; its id stays.
  return !!tool && (tools.includes(tool) || tool.startsWith('plugin:'));
}

export function resolveWorkspaceLayout(input: ResolveInput): ResolvedLayout {
  const { layout, activeTool, areaTools, open, pinned, room, routedTool, tools } = input;
  const closable = layout.optionalPanel && !pinned;
  const panelOpen = !closable || open;
  const present = layout.areas.filter(
    (area) =>
      !(area.minRoom !== undefined && room < area.minRoom) && (panelOpen || area.side !== 'panel'),
  );
  const pageVisible = present.some((area) => area.shows === 'page');
  // A tool is shown once: the page that is a tool (the chat page) first, then the areas
  // with a tool of their own, then the main area.
  const taken = new Set<string>();
  if (pageVisible && routedTool) taken.add(routedTool);
  const firstFree = (preferred: (string | undefined)[]) =>
    [...preferred, ...tools].find((tool) => isKnown(tool, tools) && !taken.has(tool)) ?? null;

  const toolOf = new Map<string, string | null>();
  for (const area of present) {
    if (area.shows !== 'tool') continue;
    const picked = areaTools[area.id];
    let tool: string | null = isKnown(picked, tools) ? picked : (area.tool ?? null);
    // Beside the chat page, a docked chat steps aside instead of showing a second chat.
    if (tool && pageVisible && tool === routedTool) tool = null;
    else if (tool && taken.has(tool)) tool = firstFree([area.tool]);
    if (tool) taken.add(tool);
    toolOf.set(area.id, tool);
  }
  const main = present.find((area) => area.shows === 'main');
  if (main) {
    let tool: string | null = activeTool;
    if (taken.has(tool)) {
      // On the standard layout the page already is that tool: the panel closes (Shell).
      tool = closable ? null : firstFree([main.tool]);
    }
    toolOf.set(main.id, tool);
  }

  const shown = present.filter((area) => area.shows === 'page' || !!toolOf.get(area.id));
  const fillId =
    shown.find((area) => area.shows === 'page')?.id ??
    shown.find((area) => area.side === 'page')?.id ??
    null;
  const areas: ResolvedArea[] = shown.map((area) => ({
    id: area.id,
    kind: area.shows === 'page' ? 'page' : 'tool',
    tool: area.shows === 'page' ? null : (toolOf.get(area.id) ?? null),
    side: area.side,
    main: area.shows === 'main',
    fill: area.id === fillId,
  }));
  const shownTools = areas.flatMap((area) => (area.tool ? [area.tool] : []));
  return {
    id: layout.id,
    areas,
    full: layout.full,
    closable,
    pageVisible: areas.some((area) => area.kind === 'page'),
    shownTools,
    mainTool: areas.find((area) => area.main)?.tool ?? null,
  };
}

export interface GeometryInput {
  resolved: ResolvedLayout;
  // The standard layout's panel floating over the page (and a phone's full-width panel).
  overlay: boolean;
  phone: boolean;
  // The dual kiosk: the panel side is the second screen, half the window.
  dual: boolean;
  // The panel's width on one screen (all its areas together), px.
  panelWidth: number;
  // The width of each area docked beside the page, px.
  dockWidth: (areaId: string) => number;
}

export interface LayoutGeometry {
  // grid-template-columns of the host.
  columns: string;
  // Area id → its 1-based grid column.
  column: Record<string, number>;
  // grid-column of the page (it spans under a floating panel).
  pageColumn: string;
  // The panel side takes all the room (a layout without a page side, or a full one).
  panelFills: boolean;
}

// The host is a grid: one column per area, the page side first and the panel after it,
// in the order the layout lists them.
export function layoutGeometry(input: GeometryInput): LayoutGeometry {
  const { resolved, overlay, phone, dual, panelWidth, dockWidth } = input;
  const pageSide = resolved.areas.filter((area) => area.side === 'page');
  const panelSide = resolved.areas.filter((area) => area.side === 'panel');
  const panelFills = pageSide.length === 0;
  const tracks: string[] = [];
  const column: Record<string, number> = {};
  for (const area of pageSide) {
    column[area.id] = tracks.length + 1;
    tracks.push(area.fill ? 'minmax(0,1fr)' : `${Math.round(dockWidth(area.id))}px`);
  }
  const count = Math.max(1, panelSide.length);
  const panelTrack = panelFills
    ? 'minmax(0,1fr)'
    : phone
      ? '100%'
      : dual
        ? count === 1
          ? '50vw'
          : `calc(50vw / ${count})`
        : `${Math.round(panelWidth / count)}px`;
  for (const area of panelSide) {
    column[area.id] = tracks.length + 1;
    tracks.push(panelTrack);
  }
  const page = resolved.areas.find((area) => area.kind === 'page');
  const pageColumn =
    page && overlay && panelSide.length > 0 ? '1 / -1' : page ? String(column[page.id]) : '1';
  return {
    columns: tracks.length > 0 ? tracks.join(' ') : 'minmax(0,1fr)',
    column,
    pageColumn,
    panelFills,
  };
}

// What picking `tool` in the area `areaId` changes: the main area's tool is the panel's
// active tool, the others' are stored per layout. A tool shown in another area swaps
// places with the one it replaces, so no tool is ever shown twice.
export function pickAreaTool(
  resolved: ResolvedLayout,
  areaId: string,
  tool: string,
): { activeTool?: string; areaTools: Record<string, string> } {
  const target = resolved.areas.find((area) => area.id === areaId);
  const changes: { activeTool?: string; areaTools: Record<string, string> } = { areaTools: {} };
  if (!target || target.kind !== 'tool' || target.tool === tool) return changes;
  const assign = (area: ResolvedArea, value: string) => {
    if (area.main) changes.activeTool = value;
    else changes.areaTools[area.id] = value;
  };
  assign(target, tool);
  const other = resolved.areas.find(
    (area) => area.id !== areaId && area.kind === 'tool' && area.tool === tool,
  );
  if (other && target.tool) assign(other, target.tool);
  return changes;
}

// The layout after `current` in the menu's order, wrapping around.
export function nextLayoutId(order: string[], current: string): string {
  if (order.length === 0) return current;
  const at = order.indexOf(current);
  return order[(at + 1) % order.length] ?? current;
}
