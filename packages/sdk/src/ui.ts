import type { CaptureKind } from './knowledge';
import type { LocalizedText } from './text';

// UI slots are the places in Helena's web app an extension can add to. The web app reads
// each slot from a registry instead of a hard-wired list, so a built-in tool and a
// plugin's sit side by side.
//
// A slot renders one of two ways:
//   - `component`: a React component bundled with the web app. Built-ins use this.
//   - `frame`: a page the plugin serves, shown in a sandboxed iframe. External plugins
//     use this: their code never runs in Helena's own page, and the app's
//     Content-Security-Policy stays `script-src 'self'`.

export type UiSlotName =
  | 'panel-tool'
  | 'project-settings'
  | 'agent-section'
  | 'dashboard-widget'
  | 'header-action'
  | 'home-nav'
  | 'admin-section'
  | 'capture-action'
  | 'workspace-layout';

// Framework-neutral component type: a React function component is assignable to it, and
// the SDK stays free of React.
export type SlotComponent<Props> = (props: Props) => unknown;

export interface FrameRender {
  kind: 'frame';
  // Relative to the plugin's `ui/` folder, which the API serves at
  // /plugins/<pluginId>/ui/…; or an absolute http(s) URL for a tool that runs elsewhere.
  src: string;
  // Extra sandbox tokens beyond `allow-scripts allow-forms` (never allow-same-origin for
  // a plugin page served from Helena's own origin).
  sandbox?: string[];
}

export interface ComponentRender<Props> {
  kind: 'component';
  component: SlotComponent<Props>;
}

export type SlotRender<Props> = ComponentRender<Props> | FrameRender;

interface SlotBase {
  id: string;
  label: LocalizedText;
  // A lucide icon name.
  icon?: string;
  // Lower comes first; built-ins leave gaps of 10.
  order?: number;
}

// Props a panel tool gets: the project it shows, or null in Home.
export interface PanelToolProps {
  projectKey: string | null;
}

export interface PanelToolSlot extends SlotBase {
  slot: 'panel-tool';
  render: SlotRender<PanelToolProps>;
  // In the header's tool bar (otherwise only reachable from where it is opened).
  inHeader?: boolean;
  // Kept in the header on phones.
  phonePinned?: boolean;
  // Closes when the project changes (a project's terminal); a Home-wide tool stays.
  projectScoped?: boolean;
}

export interface ProjectSettingsProps {
  projectKey: string;
}

export interface ProjectSettingsSlot extends SlotBase {
  slot: 'project-settings';
  group: 'general' | 'configuration' | 'automation' | 'ai' | 'ai-team';
  render: SlotRender<ProjectSettingsProps>;
}

export interface AgentSectionProps {
  agentId: number;
  teamId: number;
}

export interface AgentSectionSlot extends SlotBase {
  slot: 'agent-section';
  // Which agents show the section.
  kinds: Array<'internal' | 'external'>;
  defaultOpen?: boolean;
  render: SlotRender<AgentSectionProps>;
}

// Where a dashboard widget can appear: Start (every reader's own dashboard, `home`) and a
// project's dashboards (`project`).
export type DashboardSurface = 'home' | 'project';

// Who sees a widget on Start: everyone signed in, or only the instance owner (the
// Administrator), for the machine, the plan limits and the like.
export type DashboardAudience = 'everyone' | 'owner';

// What a widget is on Start: a `figure` tile in the row at the top (a value, its label, a
// sub-line, optionally a progress bar or a status dot; a click opens the details), or a
// `section` below (a framed list with a label, like the sidebar's groups).
export type DashboardWidgetKind = 'figure' | 'section';

export interface DashboardWidgetProps {
  // The project a project dashboard shows; null on Start.
  projectKey: string | null;
  config: Record<string, unknown>;
}

export interface DashboardWidgetSlot extends SlotBase {
  slot: 'dashboard-widget';
  // What "Anpassen" groups it under: 'work', 'agents', 'system', or a plugin's own word.
  group: string;
  // Where it may appear. Default: ['project'].
  surfaces?: DashboardSurface[];
  // Start: a figure tile or a section. Default: 'section'.
  kind?: DashboardWidgetKind;
  // Start: who sees it. Default: 'everyone'.
  audience?: DashboardAudience;
  // Start, a section: half the width (the sections pair up in two columns on a wide
  // screen) or the whole width. Default: 'half'.
  width?: 'half' | 'full';
  // Start, a section: how many 32px rows its placeholder takes while it loads, so nothing
  // moves when it arrives. Default: 3.
  rows?: number;
  // Start: off until the reader turns it on in "Anpassen".
  hiddenByDefault?: boolean;
  // A project dashboard's grid (12 columns, 40px rows); required there.
  size?: { w: number; h: number; minH?: number };
  // A figure tile's frame is one tile high (80px); a section's is `rows` × 32px.
  render: SlotRender<DashboardWidgetProps>;
}

export interface HeaderActionSlot extends SlotBase {
  slot: 'header-action';
  // A route or URL; a frame action opens its page in the panel.
  href?: string;
  render?: FrameRender;
}

export interface HomeNavSlot extends SlotBase {
  slot: 'home-nav';
  group: 'work' | 'agents' | 'globalSettings';
  href: string;
}

export interface AdminSectionSlot extends SlotBase {
  slot: 'admin-section';
  group: 'management' | 'instance';
  render: SlotRender<Record<string, never>>;
}

// "Save to knowledge" offered by a surface: the capture target it sends to, for the
// kinds of content that surface has.
export interface CaptureActionSlot extends SlotBase {
  slot: 'capture-action';
  target: string;
  contexts: CaptureKind[];
}

// One place in a workspace layout and what it shows.
export interface WorkspaceLayoutArea {
  // Unique within the layout: `page`, `main`, `dock`, `second` …
  id: string;
  // `page`: the page the address names. `main`: the panel's own tool, the one the
  // header's tool buttons pick (every layout has exactly one). `tool`: a tool of its
  // own; `tool` names the one it starts with, and the area has a picker for any other.
  shows: 'page' | 'main' | 'tool';
  // A panel tool's id (`chat`, `browser`, a plugin's `plugin:<pluginId>:<id>`, or the
  // short id of the plugin's own tool). For `main`, the tool it falls back to when the
  // active one is already shown elsewhere.
  tool?: string;
  // `page`: on the page's side (the first screen of the dual kiosk); `panel`: in the
  // tool panel (the second screen). Areas of one side sit next to each other in the
  // order listed.
  side: 'page' | 'panel';
  // Left out while the window is narrower than this (px), so a layout can say what
  // gives way on a small screen (the page, for a chat that takes its place).
  minRoom?: number;
}

// An arrangement of the page and the panel tools side by side, offered in the header's
// layout menu. A layout is data: plugins declare theirs in the manifest like any slot.
export interface WorkspaceLayoutSlot extends SlotBase {
  slot: 'workspace-layout';
  areas: WorkspaceLayoutArea[];
  // The panel takes the whole window (both screens of the dual kiosk), over the sidebar
  // and the header, with a way back to the layout before.
  full?: boolean;
}

export type UiSlot =
  | PanelToolSlot
  | ProjectSettingsSlot
  | AgentSectionSlot
  | DashboardWidgetSlot
  | HeaderActionSlot
  | HomeNavSlot
  | AdminSectionSlot
  | CaptureActionSlot
  | WorkspaceLayoutSlot;

export type SlotOf<Name extends UiSlotName> = Extract<UiSlot, { slot: Name }>;

// The id a slot is registered under: the slot name and the extension's own id, so a
// panel tool and a settings section may share a short id.
export function uiSlotKey(slot: Pick<UiSlot, 'slot' | 'id'>): string {
  return `${slot.slot}:${slot.id}`;
}

export function sortSlots<T extends { order?: number }>(slots: T[]): T[] {
  return [...slots].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
}

// The serializable form of a plugin's slot, which the API hands the web app: everything
// but a component, which only a built-in (bundled) slot can have.
export interface UiSlotDescriptor {
  // `<slot>:<id>`.
  key: string;
  pluginId: string;
  slot: UiSlotName;
  id: string;
  label: LocalizedText;
  icon?: string;
  order?: number;
  render?: FrameRender;
  // The slot's own fields (inHeader, group, href, kinds …).
  options: Record<string, unknown>;
}

export function uiSlotDescriptor(slot: UiSlot, pluginId: string): UiSlotDescriptor | null {
  const { slot: name, id, label, icon, order, ...rest } = slot;
  const render = 'render' in rest ? (rest as { render?: SlotRender<unknown> }).render : undefined;
  if (render && render.kind !== 'frame') return null;
  const options = { ...rest } as Record<string, unknown>;
  delete options.render;
  return {
    key: uiSlotKey(slot),
    pluginId,
    slot: name,
    id,
    label,
    ...(icon ? { icon } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(render ? { render } : {}),
    options,
  };
}
