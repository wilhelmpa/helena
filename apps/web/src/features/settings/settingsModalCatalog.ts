import { ACCOUNT_SECTIONS } from '@/utils/accountSections';
import { GOD_SECTIONS } from '@/utils/godSections';
import { SETTINGS_SECTIONS } from '@/utils/settingsSections';

export type SettingsArea = 'project' | 'home' | 'account' | 'admin';
export type ModalSection = {
  slug: string;
  label: string;
  description: string;
  href: string;
  keywords?: string;
};

const projectSearchTerms: Record<string, string> = {
  agents:
    'Standard-Ausführung Autopilot-Stufe Tagesbudget Lokale KI Jev-Vorstufe Gedächtnis Freigabe',
  autopilot: 'Autopilot-Stufe Budget Tagesbudget Monatsbudget Freigaben Entscheidungen',
  browser: 'Browser-Steuerung Home-Vorgabe zurücksetzen Entscheidung Standard',
  general: 'Projektname Beschreibung Funktionen',
  configuration: 'Unteraufgaben Schätzungen Archivierung',
  mail: 'E-Mail Zugang Konto Regeln',
  integrations: 'Git Webhooks MCP',
};

const projectLabels: Record<string, [string, string]> = {
  general: ['Allgemein', 'Name, Beschreibung und Funktionen des Projekts.'],
  agents: ['Agenten & Ausführung', 'Ausführung und Regeln für Agenten verwalten.'],
  budgets: ['Budgets', 'Grenzen für Kosten, Laufzeit und Tokens einstellen.'],
  tools: ['Werkzeuge', 'Browser, Netzwerk, Umgebung und Aktionen einstellen.'],
  knowledge: ['Wissen & Belege', 'Wissen und Belege des Projekts verwalten.'],
  mail: ['Mail', 'E-Mail-Zugänge und Regeln verwalten.'],
  integrations: ['Integrationen', 'Git, Webhooks und MCP verbinden.'],
  states: ['Status', 'Status und Spalten für Aufgaben verwalten.'],
  'issue-types': ['Aufgabentypen', 'Typen und ihre Eigenschaften verwalten.'],
  labels: ['Labels', 'Labels und Gruppen für Aufgaben verwalten.'],
  'custom-fields': ['Eigene Felder', 'Zusätzliche Angaben für Aufgaben festlegen.'],
  'issue-templates': ['Vorlagen', 'Vorlagen für neue Aufgaben verwalten.'],
  configuration: ['Abläufe', 'Automatische Abläufe und Schätzungen einstellen.'],
  actions: ['Aktionen', 'Projektaktionen und ihre Ausführung verwalten.'],
  webhooks: ['Webhooks', 'Ereignisse an externe Dienste senden.'],
  git: ['Git', 'Repositorys und Automatisierungen verbinden.'],
  network: ['Netzwerk', 'Netzwerkzugriff der Agenten steuern.'],
  environment: ['Umgebung', 'Umgebungsvariablen für Agenten verwalten.'],
  browser: ['Browser', 'Browserzugriff der Agenten steuern.'],
  autopilot: ['Autopilot & Freigaben', 'Stufe, Budgets und Entscheidungen verwalten.'],
  members: ['Mitglieder & Rechte', 'Zugriff und Einladungen für dieses Projekt verwalten.'],
  notifications: ['Benachrichtigungen', 'Benachrichtigungen dieses Projekts einstellen.'],
  mcp: ['MCP-Zugänge', 'MCP-Zugriff für dieses Projekt verwalten.'],
  'danger-zone': ['Gefahrenzone', 'Projekt archivieren, übertragen oder löschen.'],
};

const accountLabels: Record<string, [string, string]> = {
  profile: ['Profil', 'Name, Bild und persönliche Angaben ändern.'],
  preferences: ['Voreinstellungen', 'Sprache, Darstellung und Bedienung anpassen.'],
  notifications: ['Benachrichtigungen', 'Push-Nachrichten und Zustellung einstellen.'],
  accounts: ['Verbundene Konten', 'Externe Konten und Verbindungen verwalten.'],
  security: ['Sicherheit', 'Anmeldung und Passkeys verwalten.'],
  'api-keys': ['API-Schlüssel', 'Persönliche Zugangsschlüssel verwalten.'],
};

const adminLabels: Record<string, [string, string]> = {
  users: ['Benutzer', 'Konten und Zugänge verwalten.'],
  teams: ['Teams', 'Teams der Instanz verwalten.'],
  projects: ['Projekte', 'Alle Projekte der Instanz verwalten.'],
  general: ['Allgemein', 'Globale Vorgaben und Ausführung einstellen.'],
  'agent-runtime': ['Agenten & Ausführung', 'Agenten und Laufzeit steuern.'],
  server: ['Server', 'Serverzustand und Wartung verwalten.'],
  authentication: ['Authentifizierung', 'Anmeldeverfahren einstellen.'],
  hotkeys: ['Tastenkürzel', 'Globale Tastenkürzel anpassen.'],
  security: ['Sicherheit', 'Sicherheitsvorgaben verwalten.'],
  storage: ['Speicher', 'Dateispeicher und Grenzen verwalten.'],
  knowledge: ['Wissen', 'Instanzweites Wissen verwalten.'],
  plugins: ['Erweiterungen', 'Plugins verwalten.'],
  'model-prices': ['Modellpreise', 'Preise der KI-Modelle verwalten.'],
  'local-ai': ['Lokale KI', 'Lokale KI-Dienste einstellen.'],
  telegram: ['Telegram', 'Telegram-Anbindung verwalten.'],
  email: ['E-Mail', 'E-Mail-Versand einstellen.'],
  'auth-provider': ['Identitätsanbieter', 'Externe Anmeldung verbinden.'],
  scim: ['SCIM', 'Automatische Benutzerverwaltung einstellen.'],
  updates: ['Updates', 'Verfügbare Aktualisierungen verwalten.'],
};

const homeLabels: Record<string, [string, string]> = {
  defaults: ['Home-Vorgaben', 'Vorlagen für Projekte und geerbte Browser-Steuerung.'],
  teams: ['Teams', 'Teams und deren Einstellungen verwalten.'],
  info: ['Allgemein', 'Name und Angaben des Teams ändern.'],
  projects: ['Projekte', 'Projekte des Teams verwalten.'],
  roles: ['Mitglieder & Rechte', 'Rollen und Berechtigungen verwalten.'],
  members: ['Mitglieder', 'Mitglieder und Einladungen verwalten.'],
  mcp: ['MCP-Zugänge', 'Zugänge für MCP-Clients verwalten.'],
  notifications: ['Benachrichtigungen', 'Benachrichtigungskanäle des Teams verwalten.'],
  integrations: ['Integrationen', 'Zugangsdaten für Agenten verwalten.'],
  'ai-agents': ['Agenten & Ausführung', 'Agenten des Teams verwalten.'],
  'agent-skills': ['Fähigkeiten', 'Fähigkeiten der Agenten verwalten.'],
  'agent-tools': ['Werkzeuge', 'Werkzeuge der Agenten verwalten.'],
};

export function settingsModalSections(
  projectKey: string | null,
  teamId: number | null,
): Record<SettingsArea, ModalSection[]> {
  const projectBase = projectKey ? `/project/${encodeURIComponent(projectKey)}` : '';
  const projectPrimary = [
    'general',
    'members',
    'agents',
    'autopilot',
    'budgets',
    'tools',
    'knowledge',
    'mail',
    'notifications',
    'integrations',
    'danger-zone',
  ];
  const projectExtra = [
    ...SETTINGS_SECTIONS.map(({ slug }) => slug).filter((slug) => !projectPrimary.includes(slug)),
    'mcp',
  ];
  const projectSection = (slug: string): ModalSection => ({
    slug,
    label: projectLabels[slug]?.[0] ?? slug,
    description: projectLabels[slug]?.[1] ?? '',
    keywords: projectSearchTerms[slug],
    href:
      slug === 'members' || slug === 'notifications' || slug === 'mcp'
        ? `${projectBase}/${slug}`
        : `${projectBase}/settings/${slug}`,
  });
  return {
    project: projectKey
      ? [...projectPrimary.map(projectSection), ...projectExtra.map(projectSection)]
      : [],
    home: teamId
      ? Object.entries(homeLabels).map(([slug, [label, description]]) => ({
          slug,
          label,
          description,
          href:
            slug === 'teams'
              ? '/account/teams'
              : `/account/teams/${teamId}${slug === 'info' ? '' : `/${slug}`}`,
        }))
      : [],
    account: ACCOUNT_SECTIONS.map(({ slug }) => ({
      slug,
      label: accountLabels[slug]?.[0] ?? slug,
      description: accountLabels[slug]?.[1] ?? '',
      href: `/account/${slug}`,
    })),
    admin: [
      ...GOD_SECTIONS.map(({ slug }) => ({
        slug,
        label: adminLabels[slug]?.[0] ?? slug,
        description: adminLabels[slug]?.[1] ?? '',
        href: `/god/${slug}`,
      })),
      {
        slug: 'updates',
        label: adminLabels.updates[0],
        description: adminLabels.updates[1],
        href: '/god/updates',
      },
    ],
  };
}

export function settingsModalRoute(
  pathname: string | null,
): { area: SettingsArea; slug: string } | null {
  if (!pathname) return null;
  const project = pathname.match(/^\/project\/[^/]+\/settings\/([^/]+)$/);
  if (project) return { area: 'project', slug: project[1]! };
  const projectExtra = pathname.match(/^\/project\/[^/]+\/(members|notifications|mcp)$/);
  if (projectExtra) return { area: 'project', slug: projectExtra[1]! };
  if (pathname === '/account/teams') return { area: 'home', slug: 'teams' };
  const team = pathname.match(/^\/account\/teams\/\d+(?:\/([^/]+))?$/);
  if (team) return { area: 'home', slug: team[1] ?? 'info' };
  const account = pathname.match(
    /^\/account\/(profile|preferences|notifications|accounts|security|api-keys)$/,
  );
  if (account) return { area: 'account', slug: account[1]! };
  const admin = pathname.match(/^\/god\/([^/]+)(?:\/.*)?$/);
  if (admin) return { area: 'admin', slug: admin[1]! };
  return null;
}

export const SETTINGS_MODAL_OPEN = 'helena:settings-open';
export function openSettingsModal(area?: SettingsArea, slug?: string) {
  window.dispatchEvent(new CustomEvent(SETTINGS_MODAL_OPEN, { detail: { area, slug } }));
}
