import {
  authorizedClient,
  gogBroker,
  googleAccessToken,
  GoogleAuthError,
  type GogBroker,
  type GoogleOAuthClient,
  type GoogleToolContext,
} from '@helena/connectors/google';
import { HttpError } from '#shared/lib';
import { getAccount, readAccountSecrets, setAccountStatus, type AccountRow } from '../store';

// How Helena reaches a Google account: with the refresh token it holds (engine 'helena',
// Google's own libraries) or through the gog broker (engine 'gog', tokens in gog's
// keyring). The broker is configured by HELENA_GOOGLE_BROKER, the command that runs it,
// e.g. `sudo -n -u volition-google /usr/local/libexec/helena-google-broker`; without it
// the gog engine is off.

export type GoogleEngine = 'helena' | 'gog';

let brokerOverride: GogBroker | null | undefined;

export function setGogBrokerForTests(broker: GogBroker | null | undefined): void {
  brokerOverride = broker;
}

export function googleBroker(): GogBroker | null {
  if (brokerOverride !== undefined) return brokerOverride;
  const command = process.env.HELENA_GOOGLE_BROKER?.trim();
  return command ? gogBroker(command) : null;
}

export function requireBroker(): GogBroker {
  const broker = googleBroker();
  if (!broker) throw new HttpError(409, 'gog is not set up on this server.');
  return broker;
}

export interface GoogleAccountReadable {
  email: string;
  engine: GoogleEngine;
  clientCredentialId: number | null;
  // The services the owner switched on.
  services: string[];
  // The scopes Google granted at the last sign-in or check (engine 'helena').
  grantedScopes: string[];
  // The services gog holds a token for (engine 'gog').
  gogServices: string[];
}

export function googleReadable(account: Pick<AccountRow, 'readable'>): GoogleAccountReadable {
  const value = account.readable;
  const list = (entry: unknown) =>
    Array.isArray(entry) ? entry.filter((item): item is string => typeof item === 'string') : [];
  return {
    email: typeof value.email === 'string' ? value.email : '',
    engine: value.engine === 'gog' ? 'gog' : 'helena',
    clientCredentialId:
      typeof value.clientCredentialId === 'number' ? value.clientCredentialId : null,
    services: list(value.services),
    grantedScopes: list(value.grantedScopes),
    gogServices: list(value.gogServices),
  };
}

// The OAuth client an account signed in with, secret included.
export async function oauthClientOf(
  teamId: number,
  clientCredentialId: number | null,
): Promise<GoogleOAuthClient> {
  if (clientCredentialId === null) throw new HttpError(409, 'The account has no OAuth client.');
  const client = await getAccount(clientCredentialId, teamId, ['google_oauth_client']);
  if (!client) throw new HttpError(409, 'The OAuth client of the account was deleted.');
  const secrets = await readAccountSecrets(client.id);
  const readable = client.readable;
  return {
    type: readable.type === 'web' ? 'web' : 'installed',
    clientId: String(readable.clientId ?? ''),
    clientSecret: secrets.clientSecret ?? '',
    projectId: typeof readable.projectId === 'string' ? readable.projectId : null,
    redirectUris: Array.isArray(readable.redirectUris) ? (readable.redirectUris as string[]) : [],
  };
}

// What a tool of the account runs with.
export async function googleToolContext(account: AccountRow): Promise<GoogleToolContext> {
  const readable = googleReadable(account);
  if (readable.engine === 'gog') {
    const broker = requireBroker();
    return {
      engine: 'gog',
      email: readable.email,
      gog: (command, args, stdin) =>
        broker.call({ op: 'run', email: readable.email, command, args, stdin }),
    };
  }
  const secrets = await readAccountSecrets(account.id);
  if (!secrets.refreshToken) throw new HttpError(409, 'The account is not signed in.');
  const client = await oauthClientOf(account.teamId, readable.clientCredentialId);
  return {
    engine: 'helena',
    email: readable.email,
    auth: authorizedClient(client, secrets.refreshToken),
  };
}

// A current access token of an account Helena holds the token of, for IMAP/SMTP. A grant
// Google no longer accepts marks the account 'needs_auth'.
export async function googleAccountAccessToken(account: AccountRow): Promise<string> {
  const readable = googleReadable(account);
  if (readable.engine !== 'helena') {
    throw new HttpError(409, 'An account kept in gog has no token Helena can use.');
  }
  const secrets = await readAccountSecrets(account.id);
  if (!secrets.refreshToken) throw new HttpError(409, 'The account is not signed in.');
  const client = await oauthClientOf(account.teamId, readable.clientCredentialId);
  try {
    return (await googleAccessToken(client, secrets.refreshToken, `google:${account.id}`)).token;
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await setAccountStatus(account.id, error.status, error.message);
    }
    throw error;
  }
}
