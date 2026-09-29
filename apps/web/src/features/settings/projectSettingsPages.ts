import { mcpServerPath, membersPath, notificationsPath, settingsPath } from '@/utils/paths';

// A project's settings pages in the order of the sidebar (docs/einstellungen-struktur.md):
// Allgemein · Mitglieder · Benachrichtigungen, Arbeit ▸, Agenten ▸, Wissen & Belege, Mail, Erweiterungen,
// Integrationen ▸. `group` and `labelKey` are keys under `nav`; without a labelKey the
// label is the section's own (sections.settings).
export type ProjectSettingsPage = {
  slug: string;
  href: string;
  group?: string;
  labelKey?: string;
  keywords: string;
};

export function projectSettingsPages(projectKey: string): ProjectSettingsPage[] {
  const page = (
    slug: string,
    group: string | undefined,
    keywords: string,
    labelKey?: string,
    href?: string,
  ) => ({
    slug,
    group,
    labelKey,
    keywords,
    href: href ?? settingsPath(projectKey, slug),
  });
  return [
    page(
      'general',
      undefined,
      'Name Farbe Beschreibung Bereiche Gefahrenzone löschen archivieren kopieren',
    ),
    page('members', undefined, 'Personen Rollen Einladung', 'members', membersPath(projectKey)),
    page(
      'notifications',
      undefined,
      'Benachrichtigung melden',
      'notifications',
      notificationsPath(projectKey),
    ),
    page('states', 'settingsWork', 'Status Spalten'),
    page('issue-types', 'settingsWork', 'Typen Aufgabentypen'),
    page('labels', 'settingsWork', 'Labels'),
    page('custom-fields', 'settingsWork', 'Felder eigene'),
    page('issue-templates', 'settingsWork', 'Vorlagen'),
    page('configuration', 'settingsWork', 'Unteraufgaben Archiv'),
    page('actions', 'settingsWork', 'Aktionen Knöpfe'),
    page(
      'autopilot',
      'settingsAgents',
      'Autopilot Stufe Budget Freigaben Standard-Ausführung Modell Tagesbudget Vorgabe',
      'settingsAutopilotExecution',
    ),
    page('network', 'settingsAgents', 'Netzwerk erlaubte Ziele'),
    page(
      'environment',
      'settingsAgents',
      'Zugänge Umgebung Variablen Schlüssel Logins Freigaben',
      'settingsProjectAccess',
    ),
    page('browser', 'settingsAgents', 'Browser Domains Takt Sperren'),
    page(
      'knowledge',
      undefined,
      'Belege zusammenführen Eingang Export',
      'sidebarKnowledgeReceipts',
    ),
    page('mail', undefined, 'Postfach Triage Zeiten', 'mail'),
    page(
      'extensions',
      undefined,
      'Erweiterung Plugin Verbindung Grenzen Limits Handel',
      'settingsExtensions',
    ),
    page('mcp', 'settingsIntegrations', 'MCP', 'mcpServer', mcpServerPath(projectKey)),
    page('webhooks', 'settingsIntegrations', 'Webhooks'),
    page('git', 'settingsIntegrations', 'Repositorys Git GitHub'),
  ];
}
