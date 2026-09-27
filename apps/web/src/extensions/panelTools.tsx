'use client';

import { useMemo, useSyncExternalStore, type ComponentType } from 'react';
import {
  Code2,
  Globe2,
  Inbox,
  Mail,
  MessageSquare,
  NotebookPen,
  PlugZap,
  Puzzle,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { Registry, type LocalizedText } from '@helena/sdk/web';
import InboxWorkspace from '@/features/inbox/InboxWorkspace';
import ConnectionsWorkspace from '@/features/connections/ConnectionsWorkspace';
import MailComposeWorkspace from '@/features/mail/MailComposeWorkspace';
import NativeChatWorkspace from '@/features/ai-chat/components/panel/NativeChatWorkspace';
import TerminalWorkspace from '@/features/owner-terminal/TerminalWorkspace';

// The tools of the side panel, as a registry (@helena/sdk UI slot `panel-tool`). The
// panel, its header buttons, the split menu and the panel state read this list instead
// of a hard-wired one, so a plugin's tool sits beside chat and terminal. Built-ins
// register below as the internal plugin `helena.panel`; plugins' tools arrive from the
// API as frame slots (usePluginPanelTools) and show their page in a sandboxed frame.

export type WorkspaceContentProps = { projectKey: string | null };

export type PanelToolView =
  // A view of the web app itself.
  | { kind: 'component'; component: ComponentType<WorkspaceContentProps> }
  // A frame the deployment provides (code-server, the project browser): its address
  // comes from workspaceTools().
  | { kind: 'workspace' }
  // A plugin's page, shown sandboxed.
  | { kind: 'frame'; url: string };

export interface PanelTool {
  id: string;
  label: LocalizedText;
  Icon: ComponentType<{ className?: string }>;
  order: number;
  // In the header's tool bar.
  inHeader: boolean;
  // Kept in the header on a phone.
  phonePinned: boolean;
  // Closes when the project changes (a project's terminal); a Home-wide tool stays.
  projectScoped: boolean;
  view: PanelToolView;
  pluginId: string;
  // Whether this page's origin has the tool at all (the notes: only where the deployment
  // names an address for this origin). Asked in the browser only; without it, always.
  available?: () => boolean;
}

export const PANEL_PLUGIN_ID = 'helena.panel';

export const panelTools = new Registry<PanelTool>('panel tool', (tool) => tool.id);

function builtin(
  id: string,
  Icon: LucideIcon,
  order: number,
  view: PanelToolView,
  flags: Partial<Pick<PanelTool, 'inHeader' | 'phonePinned' | 'projectScoped' | 'available'>> = {},
): PanelTool {
  return {
    id,
    label: { i18n: `nav.workspace.${id}` },
    Icon,
    order,
    inHeader: flags.inHeader ?? false,
    phonePinned: flags.phonePinned ?? false,
    projectScoped: flags.projectScoped ?? false,
    view,
    pluginId: PANEL_PLUGIN_ID,
    ...(flags.available ? { available: flags.available } : {}),
  };
}

const component = (view: ComponentType<WorkspaceContentProps>): PanelToolView => ({
  kind: 'component',
  component: view,
});

for (const tool of [
  builtin('chat', MessageSquare, 10, component(NativeChatWorkspace), {
    inHeader: true,
    phonePinned: true,
  }),
  builtin('terminal', Terminal, 20, component(TerminalWorkspace), {
    inHeader: true,
    projectScoped: true,
  }),
  builtin('code', Code2, 30, { kind: 'workspace' }, { inHeader: true, projectScoped: true }),
  // The notes (SilverBullet on the vault), on an origin of their own; offered only where
  // this origin has an address for them (utils/runtimeEnv notesUrl).
  builtin(
    'notes',
    NotebookPen,
    35,
    { kind: 'workspace' },
    {
      inHeader: false,
      projectScoped: true,
      available: () => false,
    },
  ),
  builtin('browser', Globe2, 40, { kind: 'workspace' }, { inHeader: true }),
  builtin('mail', Mail, 50, component(MailComposeWorkspace), { inHeader: true }),
  builtin('inbox', Inbox, 60, component(InboxWorkspace)),
  builtin('connections', PlugZap, 70, component(ConnectionsWorkspace)),
]) {
  panelTools.register(tool, PANEL_PLUGIN_ID);
}

// A plugin names its icon; the dynamic lucide icon loads only that one.
export function pluginIcon(name: string | undefined): ComponentType<{ className?: string }> {
  if (!name) return Puzzle;
  function PluginIcon({ className }: { className?: string }) {
    return (
      <DynamicIcon
        name={name as IconName}
        className={className}
        fallback={() => <Puzzle className={className} />}
      />
    );
  }
  return PluginIcon;
}

function sorted(): PanelTool[] {
  return panelTools.list().sort((a, b) => a.order - b.order);
}

let cache: { version: number; tools: PanelTool[] } = { version: -1, tools: [] };

function snapshot(): PanelTool[] {
  const version = panelTools.version();
  if (cache.version !== version) cache = { version, tools: sorted() };
  return cache.tools;
}

// Every panel tool, in order; re-renders when a plugin's tool arrives or leaves.
export function usePanelTools(): PanelTool[] {
  return useSyncExternalStore((listener) => panelTools.subscribe(listener), snapshot, snapshot);
}

const noSubscription = () => () => {};

// The panel tools this page offers: every tool except one whose origin check (available)
// says no. The origin is known in the browser only, so such a tool is left out of the
// server's render and appears once the page is hydrated (no mismatch between the two).
export function useOfferedPanelTools(): PanelTool[] {
  const tools = usePanelTools();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return useMemo(
    () => tools.filter((tool) => !tool.available || (hydrated && tool.available())),
    [hydrated, tools],
  );
}

export function panelTool(id: string): PanelTool | undefined {
  return panelTools.get(id);
}
