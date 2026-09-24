// The OAuth client a Google Cloud project issues, as the JSON file its console downloads
// ("client_secret_<id>.apps.googleusercontent.com.json"). A Desktop client ("installed")
// signs in over a loopback redirect whose final address the owner pastes back; a Web
// client ("web") can use Helena's own callback once Helena runs on https.

export type GoogleClientType = 'installed' | 'web';

export interface GoogleOAuthClient {
  type: GoogleClientType;
  clientId: string;
  clientSecret: string;
  projectId: string | null;
  redirectUris: string[];
}

export class ClientJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientJsonError';
  }
}

const CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseClientJson(input: unknown): GoogleOAuthClient {
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new ClientJsonError('The file is not JSON.');
    }
  }
  if (!value || typeof value !== 'object') throw new ClientJsonError('The file is not JSON.');
  const record = value as Record<string, unknown>;
  const type: GoogleClientType | null =
    'installed' in record ? 'installed' : 'web' in record ? 'web' : null;
  if (!type) {
    throw new ClientJsonError(
      'This is not an OAuth client file: it has neither "installed" nor "web". A service account key does not work here.',
    );
  }
  const body = record[type];
  if (!body || typeof body !== 'object') throw new ClientJsonError(`"${type}" is empty.`);
  const fields = body as Record<string, unknown>;
  const clientId = text(fields.client_id);
  const clientSecret = text(fields.client_secret);
  if (!clientId || !CLIENT_ID.test(clientId)) {
    throw new ClientJsonError('The file has no valid client_id.');
  }
  if (!clientSecret) throw new ClientJsonError('The file has no client_secret.');
  const redirectUris = Array.isArray(fields.redirect_uris)
    ? fields.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
    : [];
  return { type, clientId, clientSecret, projectId: text(fields.project_id), redirectUris };
}
