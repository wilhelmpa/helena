import type { ConnectorService } from '../sdk';

// The services of a Google account and the OAuth scope each needs. Mail asks for the full
// Gmail scope because IMAP and SMTP accept an OAuth token only with it (SASL XOAUTH2), and
// the inbox imports over IMAP. `gog` names the service as gog's --services flag does.
export const GOOGLE_SERVICES = [
  {
    id: 'mail',
    label: { en: 'Mail', de: 'Mail' },
    actions: ['read', 'write', 'send', 'delete'],
    scopes: ['https://mail.google.com/'],
    gog: 'gmail',
  },
  {
    id: 'calendar',
    label: { en: 'Calendar', de: 'Kalender' },
    actions: ['read', 'write', 'send', 'delete'],
    scopes: ['https://www.googleapis.com/auth/calendar'],
    gog: 'calendar',
  },
  {
    id: 'drive',
    label: { en: 'Drive', de: 'Drive' },
    actions: ['read', 'write', 'publish', 'delete'],
    scopes: ['https://www.googleapis.com/auth/drive'],
    gog: 'drive',
  },
  {
    id: 'docs',
    label: { en: 'Docs', de: 'Docs' },
    actions: ['read', 'write'],
    scopes: ['https://www.googleapis.com/auth/documents'],
    gog: 'docs',
  },
  {
    id: 'sheets',
    label: { en: 'Sheets', de: 'Tabellen' },
    actions: ['read', 'write'],
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    gog: 'sheets',
  },
  {
    id: 'contacts',
    label: { en: 'Contacts', de: 'Kontakte' },
    actions: ['read', 'write'],
    scopes: ['https://www.googleapis.com/auth/contacts'],
    gog: 'contacts',
  },
  {
    id: 'tasks',
    label: { en: 'Tasks', de: 'Aufgaben' },
    actions: ['read', 'write', 'delete'],
    scopes: ['https://www.googleapis.com/auth/tasks'],
    gog: 'tasks',
  },
] as const satisfies readonly (ConnectorService & { gog: string })[];

export type GoogleServiceId = (typeof GOOGLE_SERVICES)[number]['id'];

export const GOOGLE_SERVICE_IDS = GOOGLE_SERVICES.map((service) => service.id);

export function isGoogleService(value: string): value is GoogleServiceId {
  return (GOOGLE_SERVICE_IDS as readonly string[]).includes(value);
}

// Asked for on every sign-in, so Helena learns which address it signed in.
export const IDENTITY_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];

export function scopesFor(services: readonly string[]): string[] {
  const scopes = new Set(IDENTITY_SCOPES);
  for (const service of GOOGLE_SERVICES) {
    if (services.includes(service.id)) for (const scope of service.scopes) scopes.add(scope);
  }
  return [...scopes];
}

// The services whose scopes the granted scopes cover.
export function servicesCovered(granted: readonly string[]): GoogleServiceId[] {
  const have = new Set(granted);
  return GOOGLE_SERVICES.filter((service) => service.scopes.every((scope) => have.has(scope))).map(
    (service) => service.id,
  );
}

export function gogServiceNames(services: readonly string[]): string[] {
  return GOOGLE_SERVICES.filter((service) => services.includes(service.id)).map(
    (service) => service.gog,
  );
}
