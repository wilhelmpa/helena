import { randomBytes } from 'node:crypto';
import { db, getDisplayName, connectorAuthSession, mailAccount, project } from '@repo/db';
import { decryptSecret, encryptSecret, secretContext } from '@repo/crypto';
import {
  ClientJsonError,
  codeFromRedirect,
  finishGoogleAuth,
  gogAccounts,
  googleAccessToken,
  GoogleAuthError,
  googleTokenScopes,
  gogServiceNames,
  isGoogleService,
  parseClientJson,
  servicesCovered,
  startGoogleAuth,
  GOOGLE_SERVICE_IDS,
  type GoogleServiceId,
} from '@helena/connectors/google';
import { and, eq, lt, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { pruneGrantsOutside, replaceGrants } from '#modules/agents/credentials/grants';
import {
  deleteAccount,
  getAccount,
  insertAccount,
  listAccounts,
  readAccountSecrets,
  setAccountStatus,
  updateAccount,
  type AccountRow,
} from '../store';
import {
  googleBroker,
  googleReadable,
  oauthClientOf,
  requireBroker,
  type GoogleEngine,
} from './engine';

// The Google accounts of a team: their OAuth clients, the sign-in (start → the owner signs
// in at Google → the address or code comes back), the services each has switched on, a
// health check, and the Mail service, which is the account's mailbox in Helena's inbox.

const AUTH_SESSION_MS = 15 * 60_000;
export const DEFAULT_FETCH_DAYS = 30;

// ── OAuth clients ─────────────────────────────────────────────────────────────────────────

export interface GoogleClientEntry {
  id: number;
  label: string;
  clientId: string;
  projectId: string | null;
  type: 'installed' | 'web';
  accounts: number;
  createdAt: string;
}

function clientEntry(row: AccountRow, accounts: AccountRow[]): GoogleClientEntry {
  return {
    id: row.id,
    label: row.label,
    clientId: String(row.readable.clientId ?? ''),
    projectId: typeof row.readable.projectId === 'string' ? row.readable.projectId : null,
    type: row.readable.type === 'web' ? 'web' : 'installed',
    accounts: accounts.filter((account) => googleReadable(account).clientCredentialId === row.id)
      .length,
    createdAt: row.createdAt,
  };
}

export async function listGoogleClients(teamId: number): Promise<GoogleClientEntry[]> {
  const [clients, accounts] = await Promise.all([
    listAccounts(teamId, 'google_oauth_client'),
    listAccounts(teamId, 'google'),
  ]);
  return clients.map((row) => clientEntry(row, accounts));
}

// Stores the client file the owner uploaded: in Helena for the helena engine, or handed
// to gog (and not kept in Helena) for the gog engine.
export async function importGoogleClient(
  teamId: number,
  input: { json: string; label?: string; engine: GoogleEngine },
): Promise<GoogleClientEntry | null> {
  let client;
  try {
    client = parseClientJson(input.json);
  } catch (error) {
    if (error instanceof ClientJsonError) throw new HttpError(400, error.message);
    throw error;
  }
  if (input.engine === 'gog') {
    await requireBroker().call({ op: 'credentials', json: input.json });
    return null;
  }
  const existing = (await listAccounts(teamId, 'google_oauth_client')).find(
    (row) => row.readable.clientId === client.clientId,
  );
  const readable = {
    clientId: client.clientId,
    projectId: client.projectId,
    type: client.type,
    redirectUris: client.redirectUris,
  };
  const label = input.label?.trim() || client.projectId || client.clientId.split('-')[0]!;
  let id: number;
  if (existing) {
    id = existing.id;
    await updateAccount(id, { label, readable, secrets: { clientSecret: client.clientSecret } });
  } else {
    id = await insertAccount({
      teamId,
      kind: 'google_oauth_client',
      label,
      projectId: null,
      readable,
      secrets: { clientSecret: client.clientSecret },
    });
  }
  const accounts = await listAccounts(teamId, 'google');
  return clientEntry((await getAccount(id, teamId, ['google_oauth_client']))!, accounts);
}

export async function deleteGoogleClient(teamId: number, id: number): Promise<boolean> {
  const used = (await listAccounts(teamId, 'google')).some(
    (account) => googleReadable(account).clientCredentialId === id,
  );
  if (used) throw new HttpError(409, 'Accounts still sign in with this client.');
  return deleteAccount(id, teamId, 'google_oauth_client');
}

// ── Accounts ──────────────────────────────────────────────────────────────────────────────

export interface GoogleServiceState {
  id: GoogleServiceId;
  // Switched on by the owner.
  enabled: boolean;
  // Covered by the scopes Google granted; a service switched on without them needs a new
  // sign-in.
  granted: boolean;
}

export interface GoogleAccountEntry {
  id: number;
  label: string;
  email: string;
  engine: GoogleEngine;
  clientCredentialId: number | null;
  projectId: number | null;
  projectKey: string | null;
  services: GoogleServiceState[];
  status: AccountRow['status'];
  statusDetail: string | null;
  checkedAt: string | null;
  signedIn: boolean;
  grants: AccountRow['grants'];
  mail: {
    accountId: number;
    enabled: boolean;
    fetchDays: number | null;
    syncStatus: string;
    syncError: string | null;
  } | null;
  createdAt: string;
}

async function mailAccountOf(credentialId: number) {
  const [row] = await db
    .select()
    .from(mailAccount)
    .where(and(eq(mailAccount.credentialId, credentialId), eq(mailAccount.auth, 'xoauth2')));
  return row ?? null;
}

async function accountEntry(row: AccountRow): Promise<GoogleAccountEntry> {
  const readable = googleReadable(row);
  const covered = new Set<string>(
    readable.engine === 'gog' ? readable.gogServices : servicesCovered(readable.grantedScopes),
  );
  const mail = await mailAccountOf(row.id);
  return {
    id: row.id,
    label: row.label,
    email: readable.email,
    engine: readable.engine,
    clientCredentialId: readable.clientCredentialId,
    projectId: row.projectId,
    projectKey: row.projectKey,
    services: GOOGLE_SERVICE_IDS.map((id) => ({
      id,
      enabled: readable.services.includes(id),
      granted: covered.has(id),
    })),
    status: row.status,
    statusDetail: row.statusDetail,
    checkedAt: row.checkedAt,
    signedIn: readable.engine === 'gog' || row.readable.refreshToken === true,
    grants: row.grants,
    mail: mail
      ? {
          accountId: mail.id,
          enabled: mail.enabled,
          fetchDays: mail.fetchDays,
          syncStatus: mail.syncStatus,
          syncError: mail.syncError,
        }
      : null,
    createdAt: row.createdAt,
  };
}

export async function listGoogleAccounts(teamId: number): Promise<GoogleAccountEntry[]> {
  const rows = await listAccounts(teamId, 'google');
  return Promise.all(rows.map(accountEntry));
}

export async function getGoogleAccount(teamId: number, id: number): Promise<AccountRow> {
  const row = await getAccount(id, teamId, ['google']);
  if (!row) throw new HttpError(404, 'Google account not found');
  return row;
}

export async function googleAccountEntry(teamId: number, id: number) {
  return accountEntry(await getGoogleAccount(teamId, id));
}

async function assertTeamProject(teamId: number, projectId: number | null | undefined) {
  if (projectId == null) return;
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)));
  if (!row) throw new HttpError(400, 'The project must belong to this team.');
}

// gog's service names ('gmail' …) as Helena's ('mail' …). An empty list means gog did not
// say, which is read as every service.
function fromGogServices(names: readonly string[]): GoogleServiceId[] {
  if (names.length === 0) return [...GOOGLE_SERVICE_IDS];
  return GOOGLE_SERVICE_IDS.filter((service) => names.includes(gogServiceNames([service])[0]!));
}

function validServices(services: readonly string[]): GoogleServiceId[] {
  for (const service of services) {
    if (!isGoogleService(service)) throw new HttpError(400, `Unknown Google service ${service}.`);
  }
  return [...new Set(services)] as GoogleServiceId[];
}

// The mailbox of the account's Mail service: an IMAP account that signs in with the
// account's token (XOAUTH2). It exists while Mail is switched on and the token covers it;
// switched off, it stops importing and keeps what it imported. A mailbox of the same
// address that signed in with a password moves to the token, so no app password is left.
export async function syncMailService(teamId: number, id: number): Promise<void> {
  const row = await getGoogleAccount(teamId, id);
  const readable = googleReadable(row);
  const wanted =
    readable.engine === 'helena' &&
    readable.services.includes('mail') &&
    servicesCovered(readable.grantedScopes).includes('mail');
  const current =
    (await mailAccountOf(row.id)) ??
    (
      await db
        .select()
        .from(mailAccount)
        .where(and(eq(mailAccount.teamId, teamId), eq(mailAccount.address, readable.email)))
    )[0] ??
    null;
  if (!wanted) {
    if (current?.credentialId === row.id && current.enabled) {
      await db
        .update(mailAccount)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(mailAccount.id, current.id));
    }
    return;
  }
  const gmail = {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapTls: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpTls: true,
    username: readable.email,
    credentialId: row.id,
    auth: 'xoauth2',
  };
  if (current) {
    await db
      .update(mailAccount)
      .set({
        ...gmail,
        enabled: true,
        ...(current.credentialId !== row.id && { syncStatus: 'idle', syncError: null }),
        updatedAt: new Date(),
      })
      .where(eq(mailAccount.id, current.id));
    return;
  }
  await db.insert(mailAccount).values({
    ...gmail,
    teamId,
    projectId: row.projectId,
    name: readable.email,
    address: readable.email,
    fetchDays: DEFAULT_FETCH_DAYS,
    enabled: true,
  });
}

export async function updateGoogleAccount(
  teamId: number,
  id: number,
  patch: { label?: string; projectId?: number | null; services?: string[] },
): Promise<GoogleAccountEntry> {
  const row = await getGoogleAccount(teamId, id);
  await assertTeamProject(teamId, patch.projectId);
  const readable = googleReadable(row);
  const services = patch.services ? validServices(patch.services) : readable.services;
  await updateAccount(id, {
    ...(patch.label !== undefined && { label: patch.label.trim() || readable.email }),
    ...(patch.projectId !== undefined && { projectId: patch.projectId }),
    readable: { ...readable, services },
  });
  if (patch.projectId != null) await pruneGrantsOutside(id, patch.projectId);
  await syncMailService(teamId, id);
  return googleAccountEntry(teamId, id);
}

// Removing the account ends its Mail service's import (the imported mail stays until the
// mailbox is deleted) and removes its grants. `fromGog` also removes gog's token.
export async function deleteGoogleAccount(
  teamId: number,
  id: number,
  options: { fromGog?: boolean } = {},
): Promise<void> {
  const row = await getGoogleAccount(teamId, id);
  const readable = googleReadable(row);
  if (readable.engine === 'gog' && options.fromGog) {
    await requireBroker().call({ op: 'remove', email: readable.email });
  }
  await db
    .update(mailAccount)
    .set({ enabled: false, credentialId: null, updatedAt: new Date() })
    .where(eq(mailAccount.credentialId, id));
  await deleteAccount(id, teamId, 'google');
}

// ── Health ────────────────────────────────────────────────────────────────────────────────

// Asks Google (or gog) whether the account still works and which scopes it holds. Writes
// the result to the account and returns it.
export async function checkGoogleAccount(teamId: number, id: number): Promise<GoogleAccountEntry> {
  const row = await getGoogleAccount(teamId, id);
  const readable = googleReadable(row);
  if (readable.engine === 'gog') {
    const broker = googleBroker();
    if (!broker) {
      await setAccountStatus(id, 'error', 'gog is not set up on this server.');
    } else {
      try {
        const listed = gogAccounts(await broker.call({ op: 'accounts' }));
        const found = listed.find((entry) => entry.email === readable.email);
        if (!found) await setAccountStatus(id, 'needs_auth', 'gog has no token for this account.');
        else if (!found.ok) await setAccountStatus(id, 'needs_auth', found.error);
        else {
          if (found.services.length > 0) {
            await updateAccount(id, {
              readable: { ...readable, gogServices: fromGogServices(found.services) },
            });
          }
          await setAccountStatus(id, 'ok', null);
        }
      } catch (error) {
        await setAccountStatus(id, 'error', error instanceof Error ? error.message : 'gog failed.');
      }
    }
    return googleAccountEntry(teamId, id);
  }
  const secrets = await readAccountSecrets(id);
  if (!secrets.refreshToken) {
    await setAccountStatus(id, 'needs_auth', 'The account is not signed in.');
    return googleAccountEntry(teamId, id);
  }
  try {
    const client = await oauthClientOf(teamId, readable.clientCredentialId);
    const { token } = await googleAccessToken(client, secrets.refreshToken, `google:${id}`);
    const info = await googleTokenScopes(client, token);
    const covered = servicesCovered(info.scopes);
    await updateAccount(id, { readable: { ...readable, grantedScopes: info.scopes } });
    const missing = readable.services.filter(
      (service) => !covered.includes(service as GoogleServiceId),
    );
    if (missing.length > 0) {
      await setAccountStatus(id, 'needs_auth', `Sign in again to allow: ${missing.join(', ')}.`);
    } else {
      await setAccountStatus(id, 'ok', null);
    }
  } catch (error) {
    if (error instanceof GoogleAuthError) await setAccountStatus(id, error.status, error.message);
    else if (error instanceof HttpError) await setAccountStatus(id, 'error', error.message);
    else throw error;
  }
  await syncMailService(teamId, id);
  return googleAccountEntry(teamId, id);
}

// ── Sign-in ───────────────────────────────────────────────────────────────────────────────

interface AuthPayload {
  engine: GoogleEngine;
  clientCredentialId: number | null;
  codeVerifier: string | null;
  redirectUri: string | null;
  services: GoogleServiceId[];
  email: string | null;
  // Signing in an existing account again, or moving it from gog to Helena.
  accountId: number | null;
  projectId: number | null;
  // After moving an account from gog to Helena: remove gog's token.
  removeFromGog: boolean;
}

export interface AuthStartResult {
  sessionId: string;
  url: string;
  // 'paste': the owner copies the address the browser ends on back into Helena.
  // 'callback': Google returns to Helena itself.
  mode: 'paste' | 'callback';
}

// The payload of a sign-in is bound to its row.
const sessionContext = (id: string) => secretContext('connector_auth_session', id, 'payload');

// Helena's own callback, for a Web client once Helena runs on https.
export function callbackUrl(): string | null {
  const base = process.env.API_URL?.trim().replace(/\/+$/, '');
  if (!base || !/^https:\/\//.test(base)) return null;
  return `${base}/connectors/google/oauth/callback`;
}

async function saveSession(teamId: number, userId: string, payload: AuthPayload): Promise<string> {
  await db.delete(connectorAuthSession).where(lt(connectorAuthSession.expiresAt, new Date()));
  const id = randomBytes(24).toString('base64url');
  await db.insert(connectorAuthSession).values({
    id,
    teamId,
    userId,
    connector: 'google',
    ...encryptSecret(JSON.stringify(payload), sessionContext(id)),
    expiresAt: new Date(Date.now() + AUTH_SESSION_MS),
  });
  return id;
}

async function takeSession(
  sessionId: string,
  who: { teamId: number; userId: string } | null,
): Promise<{ teamId: number; userId: string; payload: AuthPayload }> {
  const [row] = await db
    .delete(connectorAuthSession)
    .where(
      and(
        eq(connectorAuthSession.id, sessionId),
        eq(connectorAuthSession.connector, 'google'),
        sql`${connectorAuthSession.expiresAt} > now()`,
        who ? eq(connectorAuthSession.teamId, who.teamId) : undefined,
        who ? eq(connectorAuthSession.userId, who.userId) : undefined,
      ),
    )
    .returning();
  if (!row) throw new HttpError(410, 'This sign-in expired. Start again.');
  return {
    teamId: row.teamId,
    userId: row.userId,
    payload: JSON.parse(decryptSecret(row, sessionContext(row.id))) as AuthPayload,
  };
}

export interface AuthStartInput {
  engine: GoogleEngine;
  clientCredentialId?: number;
  email?: string;
  services: string[];
  projectId?: number | null;
  accountId?: number;
  removeFromGog?: boolean;
}

export async function startGoogleSignIn(
  teamId: number,
  userId: string,
  input: AuthStartInput,
): Promise<AuthStartResult> {
  const services = validServices(input.services);
  await assertTeamProject(teamId, input.projectId);
  let email = input.email?.trim().toLowerCase() || null;
  let projectId = input.projectId ?? null;
  if (input.accountId !== undefined) {
    const existing = await getGoogleAccount(teamId, input.accountId);
    email = googleReadable(existing).email;
    projectId = existing.projectId;
  }
  if (input.engine === 'gog') {
    if (!email) throw new HttpError(400, 'gog needs the address of the account.');
    const answer = (await requireBroker().call({
      op: 'auth-start',
      email,
      services: gogServiceNames(services),
    })) as { url?: unknown } | null;
    if (!answer || typeof answer.url !== 'string') {
      throw new HttpError(502, 'gog did not give a sign-in address.');
    }
    const sessionId = await saveSession(teamId, userId, {
      engine: 'gog',
      clientCredentialId: null,
      codeVerifier: null,
      redirectUri: null,
      services,
      email,
      accountId: input.accountId ?? null,
      projectId,
      removeFromGog: false,
    });
    return { sessionId, url: answer.url, mode: 'paste' };
  }
  const clientCredentialId =
    input.clientCredentialId ??
    (input.accountId !== undefined
      ? googleReadable(await getGoogleAccount(teamId, input.accountId)).clientCredentialId
      : null);
  if (clientCredentialId == null) throw new HttpError(400, 'Choose the OAuth client.');
  const client = await oauthClientOf(teamId, clientCredentialId);
  const callback = client.type === 'web' ? callbackUrl() : null;
  const payload: AuthPayload = {
    engine: 'helena',
    clientCredentialId,
    codeVerifier: null,
    redirectUri: null,
    services,
    email,
    accountId: input.accountId ?? null,
    projectId,
    removeFromGog: input.removeFromGog === true,
  };
  // The state is the session id, so the session is written after the URL is built.
  const sessionId = randomBytes(24).toString('base64url');
  const start = await startGoogleAuth(client, {
    services,
    state: sessionId,
    loginHint: email ?? undefined,
    redirectUri: callback ?? undefined,
  });
  await db.delete(connectorAuthSession).where(lt(connectorAuthSession.expiresAt, new Date()));
  await db.insert(connectorAuthSession).values({
    id: sessionId,
    teamId,
    userId,
    connector: 'google',
    ...encryptSecret(
      JSON.stringify({
        ...payload,
        codeVerifier: start.codeVerifier,
        redirectUri: start.redirectUri,
      }),
      sessionContext(sessionId),
    ),
    expiresAt: new Date(Date.now() + AUTH_SESSION_MS),
  });
  return { sessionId, url: start.url, mode: callback ? 'callback' : 'paste' };
}

async function upsertAccount(
  teamId: number,
  payload: AuthPayload,
  granted: {
    email: string;
    engine: GoogleEngine;
    refreshToken?: string;
    scopes: string[];
    gogServices?: GoogleServiceId[];
  },
): Promise<number> {
  const all = await listAccounts(teamId, 'google');
  const existing =
    (payload.accountId !== null ? all.find((row) => row.id === payload.accountId) : undefined) ??
    all.find((row) => googleReadable(row).email === granted.email);
  if (payload.accountId !== null && existing && googleReadable(existing).email !== granted.email) {
    throw new HttpError(
      400,
      `You signed in as ${granted.email}, but this account is ${googleReadable(existing).email}.`,
    );
  }
  const readable = {
    email: granted.email,
    engine: granted.engine,
    clientCredentialId: granted.engine === 'helena' ? payload.clientCredentialId : null,
    services:
      granted.engine === 'helena'
        ? payload.services.filter((service) => servicesCovered(granted.scopes).includes(service))
        : payload.services,
    grantedScopes: granted.scopes,
    gogServices: granted.engine === 'gog' ? (granted.gogServices ?? payload.services) : [],
  };
  const secrets: Record<string, string> = granted.refreshToken
    ? { refreshToken: granted.refreshToken }
    : {};
  if (existing) {
    await updateAccount(existing.id, { readable, secrets });
    await setAccountStatus(existing.id, 'ok', null);
    return existing.id;
  }
  const id = await insertAccount({
    teamId,
    kind: 'google',
    label: granted.email,
    projectId: payload.projectId,
    readable,
    secrets,
  });
  await setAccountStatus(id, 'ok', null);
  // A project's account is granted to that project's agents from the start.
  if (payload.projectId !== null) {
    await replaceGrants(
      {
        id,
        teamId,
        projectId: payload.projectId,
        projectKey: null,
        services: GOOGLE_SERVICE_IDS,
      },
      [{ projectId: payload.projectId, access: 'write' }],
    );
  }
  return id;
}

async function finishWith(
  teamId: number,
  payload: AuthPayload,
  pasted: { redirectUrl: string; state: string },
): Promise<number> {
  if (payload.engine === 'gog') {
    await requireBroker().call({
      op: 'auth-finish',
      email: payload.email!,
      services: gogServiceNames(payload.services),
      redirectUrl: pasted.redirectUrl,
    });
    return upsertAccount(teamId, payload, {
      email: payload.email!,
      engine: 'gog',
      scopes: [],
    });
  }
  const client = await oauthClientOf(teamId, payload.clientCredentialId);
  let grant;
  try {
    const code = codeFromRedirect(pasted.redirectUrl, pasted.state);
    grant = await finishGoogleAuth(client, {
      displayName: await getDisplayName(),
      code,
      codeVerifier: payload.codeVerifier!,
      redirectUri: payload.redirectUri!,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) throw new HttpError(400, error.message);
    throw error;
  }
  if (payload.email && payload.accountId === null && grant.email !== payload.email) {
    throw new HttpError(400, `You signed in as ${grant.email}, not ${payload.email}.`);
  }
  const id = await upsertAccount(teamId, payload, {
    email: grant.email,
    engine: 'helena',
    refreshToken: grant.refreshToken,
    scopes: grant.scopes,
  });
  if (payload.removeFromGog) {
    const broker = googleBroker();
    if (broker) await broker.call({ op: 'remove', email: grant.email }).catch(() => undefined);
  }
  await syncMailService(teamId, id);
  return id;
}

export async function finishGoogleSignIn(
  teamId: number,
  userId: string,
  input: { sessionId: string; redirectUrl: string },
): Promise<GoogleAccountEntry> {
  const session = await takeSession(input.sessionId, { teamId, userId });
  const id = await finishWith(teamId, session.payload, {
    redirectUrl: input.redirectUrl,
    state: input.sessionId,
  });
  return googleAccountEntry(teamId, id);
}

// Google's redirect to Helena's callback (a Web client on https). The state names the
// session; the person must be the one who started it, which the route checks.
export async function finishGoogleCallback(
  state: string,
  url: string,
  userId: string,
): Promise<{ teamId: number; accountId: number }> {
  const [row] = await db
    .select({ teamId: connectorAuthSession.teamId, userId: connectorAuthSession.userId })
    .from(connectorAuthSession)
    .where(eq(connectorAuthSession.id, state));
  if (!row || row.userId !== userId) throw new HttpError(410, 'This sign-in expired. Start again.');
  const session = await takeSession(state, { teamId: row.teamId, userId });
  const accountId = await finishWith(row.teamId, session.payload, { redirectUrl: url, state });
  return { teamId: row.teamId, accountId };
}

// ── gog ───────────────────────────────────────────────────────────────────────────────────

export interface GogStatus {
  available: boolean;
  // Accounts gog holds a token for that Helena does not list yet.
  unlisted: { email: string; services: string[]; ok: boolean }[];
}

export async function gogStatus(teamId: number): Promise<GogStatus> {
  const broker = googleBroker();
  if (!broker) return { available: false, unlisted: [] };
  const listed = gogAccounts(await broker.call({ op: 'accounts' }));
  const known = new Set(
    (await listAccounts(teamId, 'google')).map((row) => googleReadable(row).email),
  );
  return {
    available: true,
    unlisted: listed
      .filter((entry) => !known.has(entry.email))
      .map(({ email, services, ok }) => ({ email, services, ok })),
  };
}

// Lists an account gog already holds a token for in Helena, with the services gog was
// authorized for. No token moves.
export async function adoptGogAccount(
  teamId: number,
  input: { email: string; projectId?: number | null },
): Promise<GoogleAccountEntry> {
  await assertTeamProject(teamId, input.projectId);
  const email = input.email.trim().toLowerCase();
  const listed = gogAccounts(await requireBroker().call({ op: 'accounts' }));
  const found = listed.find((entry) => entry.email === email);
  if (!found) throw new HttpError(404, 'gog has no token for this address.');
  const services = fromGogServices(found.services);
  const id = await upsertAccount(
    teamId,
    {
      engine: 'gog',
      clientCredentialId: null,
      codeVerifier: null,
      redirectUri: null,
      services,
      email,
      accountId: null,
      projectId: input.projectId ?? null,
      removeFromGog: false,
    },
    { email, engine: 'gog', scopes: [], gogServices: services },
  );
  if (!found.ok) await setAccountStatus(id, 'needs_auth', found.error);
  return googleAccountEntry(teamId, id);
}
