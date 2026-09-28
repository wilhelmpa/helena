import { ACCOUNT_SECTIONS } from '@/utils/accountSections';
import { GOD_SECTIONS } from '@/utils/godSections';

// The global settings modal (docs/design-system.md §3, §7): only settings that are not a
// project's — three tabs, "Mein Konto", "Helena" (the instance and its team: defaults for
// all projects, people, integrations, the agents' skills and tools, local AI, updates)
// and "Administrator" (admins). Project settings are pages in the sidebar; an agent's
// settings open in the agent dialog (AgentDialog).

export type SettingsArea = 'account' | 'helena' | 'admin';

// A section of the modal: its slug and where its label comes from.
export type ModalSectionDef = {
  slug: string;
  // i18n: [namespace, key] of the label, and optionally of a one-line description.
  label: [string, string];
  description?: [string, string];
  // Only for admins.
  admin?: boolean;
  // Extra words the search finds it by.
  keywords?: string;
  // A group heading inside the tab.
  group?: string;
};

const HELENA_SECTIONS: ModalSectionDef[] = [
  {
    slug: 'defaults',
    label: ['settings', 'modal.sections.defaults'],
    description: ['settings', 'modal.sections.defaultsHint'],
    group: 'instance',
    keywords: 'Autopilot Ausführung Browser-Steuerung Vorgabe Standard KI',
  },
  {
    slug: 'ai',
    label: ['sections', 'god.general.label'],
    description: ['sections', 'god.general.description'],
    admin: true,
    group: 'instance',
    keywords: 'Standardwerte neue Projekte Autopilot-Stufe',
  },
  {
    slug: 'local-ai',
    label: ['sections', 'god.local-ai.label'],
    description: ['sections', 'god.local-ai.description'],
    admin: true,
    group: 'instance',
    keywords: 'Qwen GPU NPU Lemonade Modelle Sprache Whisper',
  },
  {
    slug: 'updates',
    label: ['sections', 'god.updates.label'],
    description: ['sections', 'god.updates.description'],
    admin: true,
    group: 'instance',
    keywords: 'Aktualisierung Hermes Claude Codex Version',
  },
  {
    slug: 'info',
    label: ['teams', 'sections.info.title'],
    description: ['teams', 'sections.info.description'],
    group: 'team',
  },
  {
    slug: 'members',
    label: ['teams', 'sections.members.title'],
    description: ['teams', 'sections.members.description'],
    group: 'team',
    keywords: 'Einladung Personen',
  },
  {
    slug: 'roles',
    label: ['teams', 'sections.roles.title'],
    description: ['teams', 'sections.roles.description'],
    group: 'team',
  },
  {
    slug: 'projects',
    label: ['teams', 'sections.projects.title'],
    description: ['teams', 'sections.projects.description'],
    group: 'team',
  },
  {
    slug: 'notifications',
    label: ['teams', 'sections.notifications.title'],
    description: ['teams', 'sections.notifications.description'],
    group: 'team',
    keywords: 'E-Mail Telegram',
  },
  {
    slug: 'integrations',
    label: ['teams', 'sections.integrations.title'],
    description: ['teams', 'sections.integrations.description'],
    group: 'agents',
    keywords: 'Zugangsdaten Schlüssel',
  },
  {
    slug: 'agent-skills',
    label: ['teams', 'sections.agentSkills.title'],
    description: ['teams', 'sections.agentSkills.description'],
    group: 'agents',
  },
  {
    slug: 'agent-tools',
    label: ['teams', 'sections.agentTools.title'],
    description: ['teams', 'sections.agentTools.description'],
    group: 'agents',
  },
  {
    slug: 'mcp',
    label: ['teams', 'sections.mcp.title'],
    description: ['teams', 'sections.mcp.description'],
    group: 'agents',
  },
];

// Administrator: the instance pages (/god/*) that are not in the Helena tab.
const ADMIN_MOVED = new Set(['general', 'local-ai']);

export function settingsModalSections(admin: boolean): Record<SettingsArea, ModalSectionDef[]> {
  return {
    account: [
      ...ACCOUNT_SECTIONS.map(({ slug }): ModalSectionDef => ({
        slug,
        label: ['sections', `account.${slug}`],
      })),
      ...(admin
        ? [{ slug: 'voice', label: ['settings', 'modal.sections.voice'] as [string, string] }]
        : []),
    ],
    helena: HELENA_SECTIONS.filter((section) => admin || !section.admin),
    admin: admin
      ? GOD_SECTIONS.filter(({ slug }) => !ADMIN_MOVED.has(slug)).map(
          ({ slug, group }): ModalSectionDef => ({
            slug,
            label: ['sections', `god.${slug}.label`],
            description: ['sections', `god.${slug}.description`],
            group,
          }),
        )
      : [],
  };
}

export const DEFAULT_SECTION: Record<SettingsArea, string> = {
  account: 'profile',
  helena: 'defaults',
  admin: 'users',
};

// Where the modal stands: the tab, its section and, where a section needs one, a detail
// (a team id in Helena, a tab of Administrator → Server).
export type SettingsLocation = { area: SettingsArea; slug: string; extra?: string };

// The old settings URLs (bookmarks, mail links, links inside the pages): the account,
// team and administrator pages open the modal over the page the user was on. Project
// settings are pages of their own and are not listed here.
export function settingsModalRoute(pathname: string | null): SettingsLocation | null {
  if (!pathname) return null;
  if (pathname === '/account/teams') return { area: 'helena', slug: 'info' };
  const team = pathname.match(/^\/account\/teams\/(\d+)(?:\/([^/]+))?$/);
  if (team) {
    const slug = team[2] ?? 'info';
    // The team's agents moved to Automatisierung → Team; the modal shows the team there.
    return { area: 'helena', slug: slug === 'ai-agents' ? 'info' : slug, extra: team[1] };
  }
  const account = pathname.match(
    /^\/account\/(profile|preferences|notifications|accounts|security|api-keys|voice)$/,
  );
  if (account) return { area: 'account', slug: account[1]! };
  if (pathname === '/god/updates') return { area: 'helena', slug: 'updates' };
  if (pathname === '/god/general') return { area: 'helena', slug: 'ai' };
  if (pathname === '/god/local-ai') return { area: 'helena', slug: 'local-ai' };
  const server = pathname.match(/^\/god\/server(?:\/([^/]+))?$/);
  if (server) {
    if (server[1] === 'updates') return { area: 'helena', slug: 'updates' };
    return { area: 'admin', slug: 'server', extra: server[1] };
  }
  const admin = pathname.match(/^\/god\/([^/]+)(?:\/.*)?$/);
  if (admin) return { area: 'admin', slug: admin[1]! };
  return null;
}

// The modal lives in the URL as `?settings=<area>.<slug>[.<extra>]` on top of the page
// that stays behind it, so a reload or a shared link reopens it there.
export const SETTINGS_PARAM = 'settings';
const AREAS: SettingsArea[] = ['account', 'helena', 'admin'];

export function formatSettingsParam({ area, slug, extra }: SettingsLocation): string {
  return [area, slug, extra].filter(Boolean).join('.');
}

export function parseSettingsParam(value: string | null | undefined): SettingsLocation | null {
  if (!value) return null;
  const [rawArea, slug, ...rest] = value.split('.');
  // Links from before the tabs were named: "home" is now "helena".
  const area = rawArea === 'home' ? 'helena' : rawArea;
  if (!AREAS.includes(area as SettingsArea) || !slug) return null;
  const extra = rest.join('.');
  return { area: area as SettingsArea, slug, ...(extra ? { extra } : {}) };
}

// `href` (a path with its query) with the modal set to `location`, or without it.
export function withSettingsParam(href: string, location: SettingsLocation | null): string {
  const url = new URL(href, 'http://helena.invalid');
  if (location) url.searchParams.set(SETTINGS_PARAM, formatSettingsParam(location));
  else url.searchParams.delete(SETTINGS_PARAM);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}

export const SETTINGS_MODAL_OPEN = 'helena:settings-open';
export const AGENT_DIALOG_OPEN = 'helena:agent-open';
export const AGENT_PARAM = 'agent';

// What to open. `scope` is the modal's tab; `section` a section of it (the tab's default
// when left out); `teamId` a team's Helena settings; `tab` a tab of a section
// (Administrator → Server). `scope: 'agent'` with `agentId` opens the agent dialog.
export type OpenSettingsRequest = {
  scope?: SettingsArea | 'agent' | 'home' | 'project';
  section?: string;
  agentId?: number;
  teamId?: number;
  tab?: string;
};

// Opens the settings modal over the current page, from anywhere: the page behind never
// navigates or re-renders another route.
//   openSettings({ scope: 'account', section: 'security' })
//   openSettings({ scope: 'agent', agentId: 12 })   → the agent dialog
export function openSettings(request: OpenSettingsRequest = {}) {
  if (request.scope === 'agent' && request.agentId != null) {
    openAgent(request.agentId, request.teamId);
    return;
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_MODAL_OPEN, { detail: request }));
}

export function openSettingsModal(area?: SettingsArea | 'home' | 'project', slug?: string) {
  openSettings({ scope: area, section: slug });
}

// An agent's settings in the large agent dialog over the current page (org chart, team
// list, chat): the page behind stays as it is.
export function openAgent(agentId: number, teamId?: number) {
  window.dispatchEvent(new CustomEvent(AGENT_DIALOG_OPEN, { detail: { agentId, teamId } }));
}
