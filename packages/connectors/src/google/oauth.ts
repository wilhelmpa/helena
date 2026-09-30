import { CodeChallengeMethod, OAuth2Client, type OAuth2ClientOptions } from 'google-auth-library';
import type { GoogleOAuthClient } from './client-json';
import { scopesFor } from './services';

// Signing in to a Google account with Google's own library (google-auth-library): the
// authorization code flow with PKCE and offline access, so Helena keeps a refresh token
// and asks for short-lived access tokens when it needs one.

// Where a Desktop client's loopback redirect lands. Nothing listens there: the browser
// shows "can't be reached", and the owner copies that page's address back into Helena.
// Google accepts any port on 127.0.0.1 for a Desktop client.
export const LOOPBACK_REDIRECT = 'http://127.0.0.1:53682/';

type Endpoints = NonNullable<OAuth2ClientOptions['endpoints']>;

let endpointOverride: Endpoints | null = null;

// Tests point the token and token-info endpoints at a local fake of Google.
export function setGoogleEndpointsForTests(endpoints: Endpoints | null) {
  endpointOverride = endpoints;
}

export function googleOAuthClient(client: GoogleOAuthClient, redirectUri?: string): OAuth2Client {
  return new OAuth2Client({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri,
    ...(endpointOverride ? { endpoints: endpointOverride } : {}),
  });
}

export interface AuthStart {
  url: string;
  codeVerifier: string;
  redirectUri: string;
}

export async function startGoogleAuth(
  client: GoogleOAuthClient,
  options: { services: readonly string[]; state: string; loginHint?: string; redirectUri?: string },
): Promise<AuthStart> {
  const redirectUri = options.redirectUri ?? LOOPBACK_REDIRECT;
  const oauth = googleOAuthClient(client, redirectUri);
  const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
  const url = oauth.generateAuthUrl({
    access_type: 'offline',
    // A refresh token is only issued on consent; a second sign-in of the same account
    // would otherwise come back without one.
    prompt: 'consent',
    include_granted_scopes: true,
    scope: scopesFor(options.services),
    state: options.state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
  });
  return { url, codeVerifier, redirectUri };
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    // 'needs_auth': the grant is gone (revoked, expired, password changed).
    readonly status: 'needs_auth' | 'error' = 'error',
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

// What the owner brought back: the whole address the loopback redirect ended on, or just
// the code. The state of an address has to be the one this sign-in started with.
export function codeFromRedirect(pasted: string, state: string): string {
  const value = pasted.trim();
  if (!value) throw new GoogleAuthError('Paste the address the browser ended on.');
  if (!/^https?:\/\//i.test(value)) {
    if (/^[\w./-]{10,}$/.test(value)) return value;
    throw new GoogleAuthError('That is neither the address nor the code.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GoogleAuthError('That address cannot be read.');
  }
  const error = url.searchParams.get('error');
  if (error) {
    throw new GoogleAuthError(
      error === 'access_denied' ? 'Google access was declined.' : `Google refused: ${error}`,
    );
  }
  if (url.searchParams.get('state') !== state) {
    throw new GoogleAuthError('The address belongs to a different sign-in. Start again.');
  }
  const code = url.searchParams.get('code');
  if (!code) throw new GoogleAuthError('The address has no code.');
  return code;
}

export interface GoogleGrant {
  email: string;
  refreshToken: string;
  scopes: string[];
}

// Exchanges the code for tokens and reads which address signed in and which scopes it
// granted, from Google's token info.
export async function finishGoogleAuth(
  client: GoogleOAuthClient,
  options: { code: string; codeVerifier: string; redirectUri: string },
): Promise<GoogleGrant> {
  const oauth = googleOAuthClient(client, options.redirectUri);
  let tokens;
  try {
    ({ tokens } = await oauth.getToken({
      code: options.code,
      codeVerifier: options.codeVerifier,
      redirect_uri: options.redirectUri,
    }));
  } catch (error) {
    throw new GoogleAuthError(`Google did not accept the code: ${oauthMessage(error)}`);
  }
  if (!tokens.refresh_token) {
    throw new GoogleAuthError(
      'Google returned no refresh token. Remove Ava under myaccount.google.com → Security → Third-party access and sign in again.',
    );
  }
  if (!tokens.access_token) throw new GoogleAuthError('Google returned no access token.');
  const info = await oauth.getTokenInfo(tokens.access_token);
  if (!info.email) throw new GoogleAuthError('Google did not say which account signed in.');
  return {
    email: info.email.toLowerCase(),
    refreshToken: tokens.refresh_token,
    scopes: info.scopes ?? (tokens.scope ? tokens.scope.split(' ') : []),
  };
}

// The error text Google's token endpoint sent, never a token.
export function oauthMessage(error: unknown): string {
  const response = (error as { response?: { data?: unknown } })?.response?.data;
  if (response && typeof response === 'object') {
    const data = response as { error?: unknown; error_description?: unknown };
    const parts = [data.error, data.error_description].filter((part) => typeof part === 'string');
    if (parts.length > 0) return parts.join(': ').slice(0, 300);
  }
  return error instanceof Error ? error.message.slice(0, 300) : 'unknown error';
}

function isInvalidGrant(error: unknown): boolean {
  const data = (error as { response?: { data?: { error?: unknown } } })?.response?.data;
  return data?.error === 'invalid_grant' || /invalid_grant/.test(String(error));
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Access tokens by refresh token fingerprint, reused until a minute before they expire.
const cache = new Map<string, CachedToken>();
const EARLY_MS = 60_000;

export function clearGoogleTokenCache(): void {
  cache.clear();
}

// A signed-in client for the Google API clients, refreshing on its own.
export function authorizedClient(client: GoogleOAuthClient, refreshToken: string): OAuth2Client {
  const oauth = googleOAuthClient(client);
  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}

// A current access token for the account, for IMAP/SMTP (XOAUTH2) and health checks. A
// revoked or expired grant throws a GoogleAuthError with status 'needs_auth'.
export async function googleAccessToken(
  client: GoogleOAuthClient,
  refreshToken: string,
  key: string,
): Promise<{ token: string; expiresAt: number }> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt - EARLY_MS > Date.now()) return cached;
  const oauth = authorizedClient(client, refreshToken);
  try {
    const { token } = await oauth.getAccessToken();
    if (!token) throw new Error('no access token');
    const fresh = { token, expiresAt: oauth.credentials.expiry_date ?? Date.now() + 3_000_000 };
    cache.set(key, fresh);
    return fresh;
  } catch (error) {
    cache.delete(key);
    if (isInvalidGrant(error)) {
      throw new GoogleAuthError(
        'Google no longer accepts this sign-in. Sign in to the account again.',
        'needs_auth',
      );
    }
    throw new GoogleAuthError(`Google could not be reached: ${oauthMessage(error)}`);
  }
}

// Which scopes the token of the account holds now.
export async function googleTokenScopes(client: GoogleOAuthClient, token: string) {
  const info = await googleOAuthClient(client).getTokenInfo(token);
  return { email: info.email?.toLowerCase() ?? null, scopes: info.scopes ?? [] };
}
