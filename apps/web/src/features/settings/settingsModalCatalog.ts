// The settings (docs/einstellungen-struktur.md, „Endgültig“ 28.09.): settings are a
// sidebar entry with pages everywhere — a project's own under the project, the settings
// for all projects and the system under Helena ("Admin", /settings/<slug>). Only
// "Mein Konto" opens as a small modal, from the avatar and name at the bottom left. An
// agent's settings open in the agent dialog (AgentDialog).

export type SettingsArea = 'account' | 'admin';

// A section of the modal: its slug, its label and one-line description (i18n, under
// `settings.modal.sections.<key>`), its group in the section list, whether only admins
// see it, and extra words the search finds it by.
export type ModalSectionDef = {
  slug: string;
  group: string;
  admin?: boolean;
  keywords?: string;
};

const s = (slug: string, group: string, extra: Partial<ModalSectionDef> = {}): ModalSectionDef => ({
  slug,
  group,
  ...extra,
});

// docs/einstellungen-struktur.md: every setting in exactly one place, by "who does it
// apply to" — me (Mein Konto), all projects (Helena), the server (Administrator). A
// project's own settings are pages in its sidebar.
const ACCOUNT: ModalSectionDef[] = [
  s('profile', 'you', { keywords: 'Name Avatar E-Mail Bild' }),
  s('preferences', 'you', {
    keywords: 'Hell Dunkel System Theme Sprache Zeitzone Tastenkürzel Darstellung',
  }),
  s('notifications', 'you', { keywords: 'Push Handy Mail' }),
  s('security', 'you', { keywords: 'Passwort 2FA Passkey Sitzungen Heimzugang' }),
  s('accounts', 'you', { keywords: 'Google GitHub verknüpft' }),
  s('api-keys', 'you', { keywords: 'Token Schlüssel' }),
];

// Administrator, part 1: everything that applies to all projects (the owner owns Home).
const ALL_PROJECTS: ModalSectionDef[] = [
  s('defaults', 'allProjects', {
    keywords: 'Autopilot Budget Ausführung Gedächtnis Vorgabe neue Projekte Browser-Steuerung',
  }),
  s('agents', 'allProjects', {
    keywords: 'Claude Code Codex Hermes Laufzeit Anmeldung Modell Fallback Not-Aus Preise',
  }),
  s('local-ai', 'allProjects', { keywords: 'Qwen GPU NPU Lemonade Vorladen Schutz Klassen' }),
  s('browser', 'allProjects', {
    keywords: 'Projekt-Browser Leerlauf immer an Chromium Speicher starten beenden',
  }),
  s('decisions', 'allProjects', { keywords: 'Entscheider Jev Schwelle Router Protokoll' }),
  s('skills', 'allProjects', { keywords: 'Skill Fähigkeit Bibliothek' }),
  s('tools', 'allProjects', { keywords: 'Werkzeug Tool MCP-Server Agent' }),
  s('mcps', 'allProjects', { keywords: 'MCP Server Bibliothek' }),
  s('plugins', 'allProjects', { keywords: 'Erweiterung Plugin' }),
  s('access', 'allProjects', {
    keywords:
      'Google E-Mail-Konten Web-Logins API-Schlüssel SSH OAuth Zugänge Verbindungen Protokoll',
  }),
  s('devices', 'allProjects', { keywords: 'Geräte Syncthing Sync Obsidian' }),
  s('structure', 'allProjects', { keywords: 'Abteilungen Struktur Projekte zuordnen' }),
  s('voice', 'allProjects', { keywords: 'Sprache Stimme Vokabular Diktat Whisper' }),
];

// Administrator, part 2: the system.
const SYSTEM: ModalSectionDef[] = [
  s('users', 'system'),
  s('teams', 'system'),
  s('team-members', 'system', { keywords: 'Mitglieder Einladung' }),
  s('team-roles', 'system', { keywords: 'Rollen Rechte' }),
  s('projects', 'system'),
  s('team-notifications', 'system', { keywords: 'E-Mail Telegram Zustellung' }),
  s('server', 'system', { keywords: 'Server Übersicht Dienste' }),
  s('server-disks', 'system', { keywords: 'Platten RAID SMART NVMe' }),
  s('server-backup', 'system', { keywords: 'Backup restic Sicherung Wiederherstellen' }),
  s('server-power', 'system', { keywords: 'Leistung Lüfter Profil Temperatur' }),
  s('updates', 'system', { keywords: 'Aktualisierung Version Update-Center' }),
  s('authentication', 'system', { keywords: 'Anmeldung Registrierung SSO' }),
  s('security', 'system', { keywords: 'Owner-Terminal Audit Härtung Cloudflare Heimnetz' }),
  s('auth-provider', 'system', { keywords: 'Identitätsanbieter OIDC' }),
  s('scim', 'system'),
  s('storage', 'system', { keywords: 'Upload Grenzen Kontingent' }),
  s('knowledge', 'system', { keywords: 'Index Suche Quellen' }),
  s('hotkeys', 'system', { keywords: 'Tastenkürzel' }),
  s('telegram', 'system'),
  s('email', 'system', { keywords: 'SMTP Versand' }),
];

export function settingsModalSections(admin: boolean): Record<SettingsArea, ModalSectionDef[]> {
  return { account: ACCOUNT, admin: admin ? HELENA_SETTINGS : [] };
}

// Helena's settings pages, in the order of its sidebar: "Alle Projekte", then "System".
export const HELENA_SETTINGS: ModalSectionDef[] = [...ALL_PROJECTS, ...SYSTEM];
export const HELENA_SETTINGS_GROUPS = ['allProjects', 'system'] as const;

// The page of one of Helena's settings; `extra` is a tab of it (Server → Backup) or a team.
export function helenaSettingsPath(slug: string, extra?: string) {
  return `/settings/${slug}${extra ? `?tab=${encodeURIComponent(extra)}` : ''}`;
}

export const DEFAULT_SECTION: Record<SettingsArea, string> = {
  account: 'profile',
  admin: 'defaults',
};

const TEAM_SLUGS: Record<string, SettingsLocation> = {
  info: { area: 'admin', slug: 'teams' },
  members: { area: 'admin', slug: 'team-members' },
  roles: { area: 'admin', slug: 'team-roles' },
  projects: { area: 'admin', slug: 'projects' },
  notifications: { area: 'admin', slug: 'team-notifications' },
  integrations: { area: 'admin', slug: 'access', extra: 'credentials' },
  mcp: { area: 'admin', slug: 'mcps' },
  'agent-skills': { area: 'admin', slug: 'skills' },
  'agent-tools': { area: 'admin', slug: 'tools' },
  'ai-agents': { area: 'admin', slug: 'agents' },
};
const GOD_SLUGS: Record<string, SettingsLocation> = {
  general: { area: 'admin', slug: 'defaults' },
  'agent-runtime': { area: 'admin', slug: 'agents' },
  'model-prices': { area: 'admin', slug: 'agents' },
  'local-ai': { area: 'admin', slug: 'local-ai' },
  plugins: { area: 'admin', slug: 'plugins' },
  updates: { area: 'admin', slug: 'updates' },
};

// Where the modal stands: the tab, its section and, where a section needs one, a detail
// (a team id in Helena, a tab of Administrator → Server).
export type SettingsLocation = { area: SettingsArea; slug: string; extra?: string };

// The old settings URLs (bookmarks, mail links, links inside the pages): an account page
// opens Mein Konto over the page the user was on, a team or administrator page is now a
// page of Helena's settings (helenaSettingsPath). Project settings are pages of their own
// and are not listed here.
export function settingsModalRoute(pathname: string | null): SettingsLocation | null {
  if (!pathname) return null;
  if (pathname === '/account/teams') return { area: 'admin', slug: 'teams' };
  const team = pathname.match(/^\/account\/teams\/(\d+)(?:\/([^/]+))?$/);
  if (team) return TEAM_SLUGS[team[2] ?? 'info'] ?? { area: 'admin', slug: 'teams' };
  if (pathname === '/account/voice') return { area: 'admin', slug: 'voice' };
  const account = pathname.match(
    /^\/account\/(profile|preferences|notifications|accounts|security|api-keys)$/,
  );
  if (account) return { area: 'account', slug: account[1]! };
  const access = pathname.match(/^\/access(?:\/([^/]+))?$/);
  if (access) return { area: 'admin', slug: 'access', ...(access[1] ? { extra: access[1] } : {}) };
  if (pathname === '/decisions') return { area: 'admin', slug: 'decisions' };
  if (pathname === '/devices') return { area: 'admin', slug: 'devices' };
  if (pathname === '/skills' || pathname === '/tools' || pathname === '/mcps')
    return { area: 'admin', slug: pathname.slice(1) };
  const server = pathname.match(/^\/god\/server(?:\/([^/]+))?$/);
  if (server) {
    if (server[1] === 'updates') return { area: 'admin', slug: 'updates' };
    if (server[1] === 'disks' || server[1] === 'backup' || server[1] === 'power')
      return { area: 'admin', slug: `server-${server[1]}` };
    return { area: 'admin', slug: 'server' };
  }
  const admin = pathname.match(/^\/god\/([^/]+)(?:\/.*)?$/);
  if (admin) return GOD_SLUGS[admin[1]!] ?? { area: 'admin', slug: admin[1]! };
  return null;
}

// The modal lives in the URL as `?settings=<area>.<slug>[.<extra>]` on top of the page
// that stays behind it, so a reload or a shared link reopens it there.
export const SETTINGS_PARAM = 'settings';
const AREAS: SettingsArea[] = ['account', 'admin'];

export function formatSettingsParam({ area, slug, extra }: SettingsLocation): string {
  return [area, slug, extra].filter(Boolean).join('.');
}

export function parseSettingsParam(value: string | null | undefined): SettingsLocation | null {
  if (!value) return null;
  const [rawArea, slug, ...rest] = value.split('.');
  // Links from before: "home", "helena" and "admin" are now Helena's settings pages.
  const area = rawArea === 'home' || rawArea === 'helena' ? 'admin' : rawArea;
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

// What to open. `scope: 'account'` opens Mein Konto (at `section`); the other scopes open
// a page of Helena's settings (`section`, its `tab` or `teamId`); `scope: 'agent'` with
// `agentId` opens the agent dialog.
export type OpenSettingsRequest = {
  scope?: SettingsArea | 'agent' | 'home' | 'helena' | 'project';
  section?: string;
  agentId?: number;
  teamId?: number;
  tab?: string;
};

// Opens Mein Konto over the current page, or goes to a page of Helena's settings.
//   openSettings({ scope: 'account', section: 'security' })
//   openSettings({ scope: 'agent', agentId: 12 })   → the agent dialog
export function openSettings(request: OpenSettingsRequest = {}) {
  if (request.scope === 'agent' && request.agentId != null) {
    openAgent(request.agentId, request.teamId);
    return;
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_MODAL_OPEN, { detail: request }));
}

export function openSettingsModal(
  area?: SettingsArea | 'home' | 'helena' | 'project',
  slug?: string,
) {
  openSettings({ scope: area, section: slug });
}

// An agent's settings in the large agent dialog over the current page (org chart, team
// list, chat): the page behind stays as it is.
// `tab` picks the tab it opens on (the org chart opens the overview).
export function openAgent(agentId: number, teamId?: number, tab?: string) {
  window.dispatchEvent(new CustomEvent(AGENT_DIALOG_OPEN, { detail: { agentId, teamId, tab } }));
}
