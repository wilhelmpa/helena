import { randomBytes } from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { assertPublicHttpUrl, UrlNotAllowedError } from '@repo/net';
import { HttpError } from '#shared/lib';
import {
  getAccount,
  insertAccount,
  readAccountSecrets,
  setAccountStatus,
  updateAccount,
  type AccountRow,
} from './store';

// MCP servers that sign in with OAuth (the MCP authorization spec): Helena is the OAuth
// client, with the MCP TypeScript SDK's own client (`auth()`), which does the discovery
// (RFC 9728, RFC 8414), the client registration (dynamic, RFC 7591), PKCE and refresh.
// Helena only keeps what the SDK hands it in the credential store: the registered client,
// the tokens and, during a sign-in, the PKCE verifier. A server of the agent MCP library
// names the connection as its Authorization header; the runner receives the current
// bearer token, never the refresh token.

export const MCP_OAUTH_KIND = 'mcp_oauth';
const LOOPBACK = 'http://127.0.0.1:53682/';
const EARLY_MS = 60_000;

// Tests replace fetch with a fake of the server and its authorization server.
let fetchOverride: typeof fetch | undefined;
export function setMcpOAuthFetchForTests(fn: typeof fetch | undefined): void {
  fetchOverride = fn;
}

interface Stored {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens & { expires_at?: number };
  verifier?: string;
  state?: string;
}

function callbackUrl(): string | null {
  const base = process.env.API_URL?.trim().replace(/\/+$/, '');
  return base && base.startsWith('https://') ? `${base}/connectors/mcp-oauth/callback` : null;
}

function readable(row: AccountRow): {
  serverUrl: string;
  scope: string | null;
  redirectUrl: string;
} {
  return {
    serverUrl: String(row.readable.serverUrl ?? ''),
    scope: typeof row.readable.scope === 'string' ? row.readable.scope : null,
    redirectUrl: String(row.readable.redirectUrl ?? LOOPBACK),
  };
}

// The SDK's view of one connection: every read and write goes to the credential row.
class StoredProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;
  private data: Stored;

  constructor(
    private readonly row: AccountRow,
    stored: Stored,
  ) {
    this.data = { ...stored };
  }

  get redirectUrl(): string {
    return readable(this.row).redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Helena',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    return this.data.state!;
  }

  clientInformation() {
    return this.data.client;
  }

  async saveClientInformation(client: OAuthClientInformationMixed) {
    this.data.client = client;
    await this.flush();
  }

  tokens() {
    return this.data.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.data.tokens = {
      ...tokens,
      expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    };
    delete this.data.verifier;
    await this.flush();
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }

  async saveCodeVerifier(verifier: string) {
    this.data.verifier = verifier;
    await this.flush();
  }

  codeVerifier(): string {
    if (!this.data.verifier) throw new HttpError(410, 'This sign-in expired. Start again.');
    return this.data.verifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') delete this.data.client;
    if (scope === 'all' || scope === 'tokens') delete this.data.tokens;
    if (scope === 'all' || scope === 'verifier') delete this.data.verifier;
    await this.flush();
  }

  private async flush() {
    const secrets: Record<string, string> = {};
    if (this.data.client) secrets.client = JSON.stringify(this.data.client);
    if (this.data.tokens) secrets.tokens = JSON.stringify(this.data.tokens);
    if (this.data.verifier) secrets.verifier = this.data.verifier;
    if (this.data.state) secrets.state = this.data.state;
    await updateAccount(this.row.id, { secrets });
  }
}

async function storedOf(id: number): Promise<Stored> {
  const secrets = await readAccountSecrets(id);
  const parse = <T>(value: string | undefined): T | undefined =>
    value ? (JSON.parse(value) as T) : undefined;
  return {
    client: parse(secrets.client),
    tokens: parse(secrets.tokens),
    verifier: secrets.verifier,
    state: secrets.state,
  };
}

async function assertServer(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new HttpError(400, 'That is not a server address.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new HttpError(400, 'The server address must start with https://.');
  }
  try {
    await assertPublicHttpUrl(parsed.toString());
  } catch (error) {
    if (error instanceof UrlNotAllowedError) throw new HttpError(400, error.message);
    throw error;
  }
  return parsed.toString();
}

export async function getMcpConnection(teamId: number, id: number): Promise<AccountRow> {
  const row = await getAccount(id, teamId, [MCP_OAUTH_KIND]);
  if (!row) throw new HttpError(404, 'MCP connection not found');
  return row;
}

export interface McpSignInStart {
  id: number;
  url: string | null;
  mode: 'paste' | 'callback' | 'connected';
}

async function runAuth(row: AccountRow, stored: Stored, code?: string) {
  const provider = new StoredProvider(row, stored);
  const { serverUrl, scope } = readable(row);
  try {
    const result = await auth(provider, {
      serverUrl,
      authorizationCode: code,
      scope: scope ?? undefined,
      fetchFn: fetchOverride,
    });
    return { result, url: provider.authorizationUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'The sign-in failed.';
    await setAccountStatus(row.id, 'error', message);
    throw new HttpError(502, `The MCP server's sign-in failed: ${message}`);
  }
}

// Creates the connection (or reuses one) and starts its sign-in.
export async function startMcpSignIn(
  teamId: number,
  input: {
    id?: number;
    label?: string;
    serverUrl?: string;
    scope?: string | null;
    projectId?: number | null;
  },
): Promise<McpSignInStart> {
  let id = input.id;
  if (id === undefined) {
    if (!input.serverUrl) throw new HttpError(400, 'Name the MCP server.');
    const serverUrl = await assertServer(input.serverUrl);
    id = await insertAccount({
      teamId,
      kind: MCP_OAUTH_KIND,
      label: input.label?.trim() || new URL(serverUrl).host,
      projectId: input.projectId ?? null,
      readable: {
        serverUrl,
        scope: input.scope?.trim() || null,
        redirectUrl: callbackUrl() ?? LOOPBACK,
      },
      secrets: {},
    });
  }
  const row = await getMcpConnection(teamId, id);
  const stored = await storedOf(id);
  stored.state = `${id}.${randomBytes(18).toString('base64url')}`;
  delete stored.tokens;
  await updateAccount(id, {
    secrets: {
      ...(stored.client && { client: JSON.stringify(stored.client) }),
      state: stored.state,
    },
  });
  const { result, url } = await runAuth(row, stored);
  if (result === 'AUTHORIZED') {
    await setAccountStatus(id, 'ok', null);
    return { id, url: null, mode: 'connected' };
  }
  return { id, url: url?.toString() ?? null, mode: callbackUrl() ? 'callback' : 'paste' };
}

function codeOf(pasted: string, state: string): string {
  const value = pasted.trim();
  if (!/^https?:\/\//i.test(value)) return value;
  const url = new URL(value);
  const error = url.searchParams.get('error');
  if (error) throw new HttpError(400, `The server refused: ${error}`);
  if (url.searchParams.get('state') !== state) {
    throw new HttpError(400, 'The address belongs to a different sign-in. Start again.');
  }
  const code = url.searchParams.get('code');
  if (!code) throw new HttpError(400, 'The address has no code.');
  return code;
}

// Finishes a sign-in with the address the browser ended on (or its code).
export async function finishMcpSignIn(
  teamId: number,
  id: number,
  redirectUrl: string,
): Promise<AccountRow> {
  const row = await getMcpConnection(teamId, id);
  const stored = await storedOf(id);
  if (!stored.state) throw new HttpError(410, 'This sign-in expired. Start again.');
  const code = codeOf(redirectUrl, stored.state);
  const { result } = await runAuth(row, stored, code);
  if (result !== 'AUTHORIZED') throw new HttpError(502, 'The MCP server did not sign in.');
  const after = await storedOf(id);
  delete after.state;
  await updateAccount(id, {
    secrets: {
      ...(after.client && { client: JSON.stringify(after.client) }),
      ...(after.tokens && { tokens: JSON.stringify(after.tokens) }),
    },
  });
  await setAccountStatus(id, 'ok', null);
  return getMcpConnection(teamId, id);
}

// The callback of a sign-in on https: the state names the connection.
export async function finishMcpCallback(
  teamIdOf: (id: number) => Promise<number | null>,
  state: string,
  url: string,
) {
  const id = Number(state.split('.')[0]);
  const teamId = Number.isInteger(id) ? await teamIdOf(id) : null;
  if (teamId === null) throw new HttpError(410, 'This sign-in expired. Start again.');
  return finishMcpSignIn(teamId, id, url);
}

// The Authorization header value for the runner: a current bearer token, refreshed when
// it is about to expire. A refused refresh marks the connection 'needs_auth'.
export async function mcpBearer(teamId: number, id: number): Promise<string | null> {
  const row = await getAccount(id, teamId, [MCP_OAUTH_KIND]);
  if (!row) return null;
  let stored = await storedOf(id);
  const tokens = stored.tokens;
  if (!tokens) return null;
  const fresh = !tokens.expires_at || tokens.expires_at - EARLY_MS > Date.now();
  if (!fresh) {
    if (!tokens.refresh_token) {
      await setAccountStatus(id, 'needs_auth', 'The token expired. Sign in again.');
      return null;
    }
    try {
      const { result } = await runAuth(row, stored);
      if (result !== 'AUTHORIZED') throw new Error('refresh refused');
    } catch {
      await setAccountStatus(id, 'needs_auth', 'The server refused the refresh. Sign in again.');
      return null;
    }
    stored = await storedOf(id);
  }
  const access = stored.tokens?.access_token;
  return access ? `Bearer ${access}` : null;
}
