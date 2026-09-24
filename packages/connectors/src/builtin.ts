import type { Connector } from './sdk';

// The credentials of the access center that other parts of Helena use rather than agent
// tools: the browser gateway fills web logins, the runner hands SSH keys to git, MCP
// servers read API keys and secrets from their environment or headers, the mail worker
// signs in to a mailbox. They are connectors without services or tools.
const credential = (
  id: string,
  label: Connector['label'],
  icon: string,
  credentialSchema: Connector['credentialSchema'],
): Connector => ({
  id,
  label,
  icon,
  kind: 'credential',
  credentialSchema,
  services: [],
  tools: [],
});

export const BUILTIN_CREDENTIALS: Connector[] = [
  credential('web_login', { en: 'Website login', de: 'Website-Login' }, 'globe', [
    {
      key: 'loginUrl',
      label: { en: 'Login page', de: 'Login-Seite' },
      type: 'url',
      required: true,
    },
    { key: 'username', label: { en: 'User', de: 'Benutzer' }, type: 'string', required: true },
    { key: 'password', label: { en: 'Password', de: 'Passwort' }, type: 'secret', required: true },
    {
      key: 'totpSecret',
      label: { en: 'Authenticator key', de: 'Authenticator-Schlüssel' },
      type: 'secret',
      required: false,
    },
  ]),
  credential('api_key', { en: 'API key', de: 'API-Schlüssel' }, 'key-round', [
    { key: 'value', label: { en: 'Key', de: 'Schlüssel' }, type: 'secret', required: true },
  ]),
  credential('ssh_key', { en: 'SSH key', de: 'SSH-Schlüssel' }, 'terminal', [
    {
      key: 'privateKey',
      label: { en: 'Private key', de: 'Privater Schlüssel' },
      type: 'secret',
      required: true,
    },
  ]),
  credential('secret', { en: 'Secret', de: 'Secret' }, 'lock', [
    { key: 'value', label: { en: 'Value', de: 'Wert' }, type: 'secret', required: true },
  ]),
];
