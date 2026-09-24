import type { Connector } from '../sdk';
import { GOOGLE_SERVICES } from './services';
import { GOOGLE_TOOLS } from './tools';

export * from './client-json';
export * from './gog';
export * from './oauth';
export * from './services';
export * from './tools';

// A Google account: Mail, Calendar, Drive, Docs, Sheets, Contacts and Tasks under one
// sign-in. Its credential is the refresh token Helena holds (engine 'helena') or nothing
// at all for an account kept in gog (engine 'gog').
export const googleConnector: Connector = {
  id: 'google',
  label: { en: 'Google account', de: 'Google-Konto' },
  icon: 'mail',
  kind: 'account',
  credentialSchema: [
    { key: 'email', label: { en: 'Address', de: 'Adresse' }, type: 'string', required: true },
    {
      key: 'refreshToken',
      label: { en: 'Refresh token', de: 'Refresh-Token' },
      type: 'secret',
      required: false,
    },
  ],
  services: GOOGLE_SERVICES.map(({ id, label, actions, scopes }) => ({
    id,
    label,
    actions: [...actions],
    scopes: [...scopes],
  })),
  tools: GOOGLE_TOOLS as unknown as Connector['tools'],
};
