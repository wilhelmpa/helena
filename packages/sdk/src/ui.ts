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
  | 'capture-action';

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

export interface DashboardWidgetProps {
  projectKey: string | null;
  config: Record<string, unknown>;
}

export interface DashboardWidgetSlot extends SlotBase {
  slot: 'dashboard-widget';
  group: string;
  size: { w: number; h: number; minH?: number };
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

export type UiSlot =
  | PanelToolSlot
  | ProjectSettingsSlot
  | AgentSectionSlot
  | DashboardWidgetSlot
  | HeaderActionSlot
  | HomeNavSlot
  | AdminSectionSlot
  | CaptureActionSlot;

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
