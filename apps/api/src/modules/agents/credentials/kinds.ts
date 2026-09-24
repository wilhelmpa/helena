import { parseTotpSecret, TotpSecretError } from '@repo/crypto';
import { HttpError } from '#shared/lib';

// The kinds of the Credentials page. Each is stored as an integration_credential row
// whose integration key is the kind.
export const CREDENTIAL_KINDS = ['web_login', 'api_key', 'ssh_key', 'secret'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export function isCredentialKind(key: string): key is CredentialKind {
  return (CREDENTIAL_KINDS as readonly string[]).includes(key);
}

// Encrypted and never returned. Every other field is stored readable.
export const SECRET_FIELDS = {
  web_login: ['password', 'totpSecret'],
  api_key: ['value'],
  ssh_key: ['privateKey'],
  secret: ['value'],
} as const satisfies Record<CredentialKind, readonly string[]>;

// The fields a request may set for each kind. An ssh_key's keys are generated.
const INPUT_FIELDS: Record<CredentialKind, readonly string[]> = {
  web_login: ['loginUrl', 'allowedDomains', 'username', 'password', 'totpSecret', 'notes'],
  api_key: ['value', 'notes'],
  ssh_key: ['notes'],
  secret: ['value', 'notes'],
};

export interface CredentialFields {
  loginUrl?: string;
  allowedDomains?: string[];
  username?: string;
  password?: string;
  totpSecret?: string | null;
  value?: string;
  notes?: string;
}

export function assertFieldsOfKind(kind: CredentialKind, fields: CredentialFields): void {
  const allowed = INPUT_FIELDS[kind];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && !allowed.includes(key)) {
      throw new HttpError(400, `A ${kind} credential has no ${key}.`);
    }
  }
}

function httpUrl(value: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, `${what} is not a URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, `${what} must start with https:// or http://.`);
  }
  if (url.username || url.password) throw new HttpError(400, `${what} cannot contain a login.`);
  return url;
}

export function loginUrlOf(value: string): string {
  return httpUrl(value, 'The login URL').toString();
}

// Hermes fills a login only on a page whose origin equals one it was saved for, so an
// allowed domain is stored as that origin. A domain without a scheme is https.
export function allowedOrigin(value: string): string {
  const entry = value.trim().toLowerCase();
  if (entry.includes('*')) {
    throw new HttpError(400, `${value} has a wildcard. List every domain on its own.`);
  }
  const withScheme = entry.includes('://') ? entry : `https://${entry}`;
  const url = httpUrl(withScheme, `The domain ${value}`);
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new HttpError(400, `The domain ${value} cannot have a path.`);
  }
  return url.origin;
}

// Every origin a login may be filled on: the login URL's, then the allowed domains.
export function loginOrigins(loginUrl: string, allowedDomains: string[]): string[] {
  return [...new Set([new URL(loginUrl).origin, ...allowedDomains])];
}

// The rules Hermes' vault applies to an authenticator key, checked here so that a key it
// would refuse is refused on save rather than when the runner delivers it. The one parser
// is @repo/crypto's (otpauth), which also computes the codes.
export function assertTotpSecret(value: string): void {
  try {
    parseTotpSecret(value);
  } catch (error) {
    if (error instanceof TotpSecretError) throw new HttpError(400, error.message);
    throw error;
  }
}
