import {
  db,
  integrationCredential,
  integrationCredentialUse,
  nextCredentialId,
  openCredential,
  project,
  sealCredential,
} from '@repo/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { connectors } from '@helena/connectors';
import { listAudit, type AuditEntry } from './audit';
import {
  grantsOf,
  pruneGrantsOutside,
  replaceGrants,
  type GrantEntry,
  type GrantInput,
} from './grants';
import {
  CREDENTIAL_KINDS,
  LISTED_KINDS,
  SECRET_FIELDS,
  type ListedKind,
  allowedOrigin,
  assertFieldsOfKind,
  assertLoginMethod,
  assertTotpSecret,
  loginUrlOf,
  type CredentialFields,
  type CredentialKind,
  type LoginMethod,
  type LoginRuntime,
} from './kinds';
import { generateSshKey, sshKeyComment } from './ssh-key';
import { composeDecisionModel } from './decision-model';
import type { DecisionKeySource } from './kinds';
import {
  ENV_KINDS,
  assertEnvName,
  assertEnvNameFree,
  forgetTeamSecrets,
  retainTeamSecrets,
} from './env';

// The credentials of the Credentials page: web logins, API keys, SSH keys and secrets
// of a team, each for the whole team or one project, and the agents they are granted
// to. They are rows of integration_credential. The secret fields are encrypted and
// write-only: a response says which of them hold a value, never the value.

export interface CredentialEntry {
  id: number;
  teamId: number;
  kind: ListedKind;
  label: string;
  projectId: number | null;
  projectKey: string | null;
  // An MCP/OAuth connection's server, and the health of its sign-in.
  serverUrl: string | null;
  status: 'ok' | 'needs_auth' | 'error' | null;
  statusDetail: string | null;
  loginUrl: string | null;
  allowedDomains: string[];
  username: string | null;
  notes: string;
  publicKey: string | null;
  runtime: LoginRuntime | null;
  method: LoginMethod | null;
  // decision_model: the System One service, its address and model, the owner's allowance of a
  // local or private address, and where the key comes from.
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  allowPrivateAddress: boolean;
  keySource: DecisionKeySource | null;
  modelServer: string | null;
  // api_key, secret, variable: the environment variable the agents' commands receive it in.
  envName: string | null;
  // variable: its value, which is not secret.
  value: string | null;
  secrets: string[];
  // The agents granted by name; `grants` holds every grant, to agents and projects.
  agentIds: number[];
  grants: GrantEntry[];
  createdAt: string;
  updatedAt: string;
}

// The readable fields, stored in `redacted`, with `true` for every secret field that
// holds a value.
interface Readable {
  loginUrl?: string;
  allowedDomains?: string[];
  username?: string;
  notes?: string;
  publicKey?: string;
  runtime?: LoginRuntime;
  method?: LoginMethod;
  provider?: string;
  baseUrl?: string;
  model?: string;
  allowPrivateAddress?: boolean;
  keySource?: DecisionKeySource;
  modelServer?: string;
  envName?: string;
  // variable: its value, readable.
  value?: string;
  [secretField: string]: unknown;
}

type Secrets = Record<string, string>;

const MAX_ALLOWED_DOMAINS = 20;

export const storeKinds = inArray(integrationCredential.integrationKey, [...LISTED_KINDS]);

const entryColumns = {
  id: integrationCredential.id,
  teamId: integrationCredential.teamId,
  kind: integrationCredential.integrationKey,
  label: integrationCredential.label,
  projectId: integrationCredential.projectId,
  projectKey: project.key,
  redacted: integrationCredential.redacted,
  status: integrationCredential.status,
  statusDetail: integrationCredential.statusDetail,
  createdAt: integrationCredential.createdAt,
  updatedAt: integrationCredential.updatedAt,
};

type EntryRow = {
  id: number;
  teamId: number;
  kind: string;
  label: string | null;
  projectId: number | null;
  projectKey: string | null;
  redacted: unknown;
  status: string | null;
  statusDetail: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function readableOf(value: unknown): Readable {
  return value && typeof value === 'object' ? (value as Readable) : {};
}

function toEntry(row: EntryRow, grants: GrantEntry[]): CredentialEntry {
  const kind = row.kind as ListedKind;
  const readable = readableOf(row.redacted);
  return {
    id: row.id,
    teamId: row.teamId,
    kind,
    label: row.label ?? '',
    projectId: row.projectId,
    projectKey: row.projectKey,
    serverUrl: typeof readable.serverUrl === 'string' ? readable.serverUrl : null,
    status: (row.status as CredentialEntry['status']) ?? null,
    statusDetail: row.statusDetail ?? null,
    loginUrl: readable.loginUrl ?? null,
    allowedDomains: readable.allowedDomains ?? [],
    username: readable.username ?? null,
    notes: readable.notes ?? '',
    publicKey: readable.publicKey ?? null,
    runtime: kind === 'runtime_login' ? (readable.runtime ?? null) : null,
    method: kind === 'runtime_login' ? (readable.method ?? null) : null,
    provider: kind === 'decision_model' ? (readable.provider ?? null) : null,
    baseUrl: kind === 'decision_model' ? (readable.baseUrl ?? null) : null,
    model: kind === 'decision_model' ? (readable.model ?? null) : null,
    allowPrivateAddress: kind === 'decision_model' && readable.allowPrivateAddress === true,
    keySource: kind === 'decision_model' ? (readable.keySource ?? 'stored') : null,
    modelServer:
      kind === 'decision_model' && readable.keySource === 'local-ai'
        ? (readable.modelServer ?? 'local')
        : null,
    envName:
      (ENV_KINDS as readonly string[]).includes(kind) && typeof readable.envName === 'string'
        ? readable.envName
        : null,
    value: kind === 'variable' && typeof readable.value === 'string' ? readable.value : null,
    secrets: (SECRET_FIELDS[kind] as readonly string[]).filter((field) => Boolean(readable[field])),
    agentIds: grants.flatMap((grant) => (grant.agentId === null ? [] : [grant.agentId])),
    grants,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function toEntries(rows: EntryRow[]): Promise<CredentialEntry[]> {
  const grants = await grantsOf(rows.map((row) => row.id));
  return rows.map((row) => toEntry(row, grants.get(row.id) ?? []));
}

function selectEntries() {
  return db
    .select(entryColumns)
    .from(integrationCredential)
    .leftJoin(project, eq(project.id, integrationCredential.projectId));
}

export async function listCredentialEntries(
  teamId: number,
  filter: { kind?: ListedKind; projectId?: number },
  window: { limit: number; offset: number },
): Promise<{ items: CredentialEntry[]; total: number }> {
  const where = and(
    eq(integrationCredential.teamId, teamId),
    filter.kind ? eq(integrationCredential.integrationKey, filter.kind) : storeKinds,
    filter.projectId === undefined
      ? undefined
      : eq(integrationCredential.projectId, filter.projectId),
  );
  const [rows, counted] = await Promise.all([
    selectEntries()
      .where(where)
      .orderBy(asc(integrationCredential.label), asc(integrationCredential.id))
      .limit(window.limit)
      .offset(window.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(integrationCredential)
      .where(where),
  ]);
  return { items: await toEntries(rows), total: counted[0]?.count ?? 0 };
}

export async function getCredentialEntry(
  id: number,
  teamId: number,
): Promise<CredentialEntry | null> {
  const [row] = await selectEntries().where(
    and(eq(integrationCredential.id, id), eq(integrationCredential.teamId, teamId), storeKinds),
  );
  return row ? (await toEntries([row]))[0] : null;
}

function required(value: string | undefined, what: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new HttpError(400, `${what} is required.`);
  return trimmed;
}

// A secret is stored exactly as it was typed: spaces around a password are part of it.
function requiredSecret(value: string | undefined, what: string): string {
  if (!value?.trim()) throw new HttpError(400, `${what} is required.`);
  return value;
}

// The readable and the secret fields a credential ends up with: the submitted fields
// over the stored ones. A secret field left out keeps its stored value; an empty or
// null authenticator key removes it.
function compose(
  kind: CredentialKind,
  fields: CredentialFields,
  current: { readable: Readable; secrets: Secrets },
): { readable: Readable; secrets: Secrets } {
  const notes = (fields.notes ?? current.readable.notes ?? '').trim();
  if (kind === 'web_login') {
    const loginUrl = loginUrlOf(
      required(fields.loginUrl ?? current.readable.loginUrl, 'A login URL'),
    );
    const domains = fields.allowedDomains ?? current.readable.allowedDomains ?? [];
    if (domains.length > MAX_ALLOWED_DOMAINS) {
      throw new HttpError(400, `A login allows at most ${MAX_ALLOWED_DOMAINS} domains.`);
    }
    const allowedDomains = [...new Set(domains.filter((d) => d.trim()).map(allowedOrigin))];
    const secrets: Secrets = {
      password: requiredSecret(fields.password ?? current.secrets.password, 'A password'),
    };
    const totpSecret =
      fields.totpSecret === undefined ? current.secrets.totpSecret : fields.totpSecret?.trim();
    if (totpSecret) {
      assertTotpSecret(totpSecret);
      secrets.totpSecret = totpSecret;
    }
    const readable = {
      loginUrl,
      allowedDomains,
      username: required(fields.username ?? current.readable.username, 'A username'),
      notes,
    };
    return { readable, secrets };
  }
  if (kind === 'ssh_key') {
    return {
      readable: { publicKey: current.readable.publicKey, notes },
      secrets: { privateKey: current.secrets.privateKey },
    };
  }
  if (kind === 'runtime_login') {
    const runtime = required(fields.runtime ?? current.readable.runtime, 'A runtime');
    const method = required(fields.method ?? current.readable.method, 'A sign-in method');
    assertLoginMethod(runtime, method);
    const value = fields.value === undefined ? current.secrets.value : fields.value?.trim();
    return {
      readable: { runtime: runtime as LoginRuntime, method: method as LoginMethod, notes },
      secrets: { value: requiredSecret(value, 'A token or key') },
    };
  }
  if (kind === 'decision_model') {
    const composed = composeDecisionModel(fields, current);
    return { readable: { ...composed.readable, notes }, secrets: composed.secrets };
  }
  const envName = envNameOf(fields, current.readable);
  if (kind === 'variable') {
    // Not secret: stored readable, exactly as typed but for a trailing line break.
    const value = (fields.value ?? current.readable.value ?? '').replace(/\r?\n$/, '');
    if (!value.trim()) throw new HttpError(400, 'A value is required.');
    if (!envName) throw new HttpError(400, 'A variable needs a name.');
    return { readable: { envName, value, notes }, secrets: {} };
  }
  const value = fields.value === undefined ? current.secrets.value : fields.value;
  return {
    readable: { notes, ...(envName && { envName }) },
    secrets: { value: requiredSecret(value, 'A value') },
  };
}

// The variable name a credential ends up with: the submitted one over the stored one. An
// empty or null name takes it away.
function envNameOf(fields: CredentialFields, readable: Readable): string | undefined {
  if (fields.envName === undefined) return readable.envName;
  const name = fields.envName?.trim() ?? '';
  return name ? assertEnvName(name) : undefined;
}

function stored(id: number, readable: Readable, secrets: Secrets) {
  const encrypted = sealCredential(id, JSON.stringify(secrets));
  const marks = Object.fromEntries(Object.keys(secrets).map((field) => [field, true]));
  return { ...encrypted, redacted: { ...readable, ...marks } };
}

async function assertProjectOfTeam(projectId: number, teamId: number): Promise<void> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)));
  if (!row) throw new HttpError(400, 'The project is not a project of this team.');
}

export interface NewCredentialEntry extends CredentialFields {
  kind: CredentialKind;
  label: string;
  projectId?: number | null;
}

export async function createCredentialEntry(
  teamId: number,
  input: NewCredentialEntry,
): Promise<CredentialEntry> {
  const { kind, label: rawLabel, projectId = null, ...fields } = input;
  assertFieldsOfKind(kind, fields);
  const label = required(rawLabel, 'A name');
  if (projectId !== null) await assertProjectOfTeam(projectId, teamId);
  const current = { readable: {}, secrets: {} as Secrets };
  if (kind === 'ssh_key') {
    const key = generateSshKey(sshKeyComment(label));
    current.readable = { publicKey: key.publicKey };
    current.secrets = { privateKey: key.privateKey };
  }
  const { readable, secrets } = compose(kind, fields, current);
  if (readable.envName) await assertEnvNameFree(teamId, projectId, readable.envName, null);
  const id = await nextCredentialId();
  const [row] = await db
    .insert(integrationCredential)
    .values({
      id,
      teamId,
      integrationKey: kind,
      label,
      projectId,
      ...stored(id, readable, secrets),
    })
    .returning({ id: integrationCredential.id });
  forgetTeamSecrets(teamId);
  return (await getCredentialEntry(row.id, teamId))!;
}

export interface CredentialEntryPatch extends CredentialFields {
  label?: string;
  projectId?: number | null;
}

// A credential moved to a project loses the grants of the agents that do not work there.
export async function updateCredentialEntry(
  id: number,
  teamId: number,
  patch: CredentialEntryPatch,
): Promise<CredentialEntry | null> {
  const existing = await getCredentialEntry(id, teamId);
  if (!existing) return null;
  const { label, projectId, ...fields } = patch;
  const name = label === undefined ? undefined : required(label, 'A name');
  if (projectId != null) await assertProjectOfTeam(projectId, teamId);
  // An MCP/OAuth connection keeps what its sign-in stored; only its name and scope change.
  if (existing.kind === 'mcp_oauth') {
    if (Object.values(fields).some((value) => value !== undefined)) {
      throw new HttpError(400, 'An MCP connection changes by signing in again.');
    }
    await db
      .update(integrationCredential)
      .set({
        ...(name !== undefined && { label: name }),
        ...(projectId !== undefined && { projectId }),
        updatedAt: new Date(),
      })
      .where(eq(integrationCredential.id, id));
    if (projectId != null) await pruneGrantsOutside(id, projectId);
    return getCredentialEntry(id, teamId);
  }
  const kind = existing.kind;
  assertFieldsOfKind(kind, fields);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(integrationCredential)
      .where(and(eq(integrationCredential.id, id), eq(integrationCredential.teamId, teamId)))
      .for('update');
    if (!row) return;
    const current = {
      readable: readableOf(row.redacted),
      secrets: JSON.parse(openCredential(row)) as Secrets,
    };
    const { readable, secrets } = compose(kind, fields, current);
    if (readable.envName) {
      const scope = projectId === undefined ? row.projectId : projectId;
      await assertEnvNameFree(teamId, scope, readable.envName, id);
    }
    if (JSON.stringify(current.secrets) !== JSON.stringify(secrets)) {
      await retainTeamSecrets(teamId, kind, current.secrets, tx);
    }
    await tx
      .update(integrationCredential)
      .set({
        ...stored(id, readable, secrets),
        ...(name !== undefined && { label: name }),
        ...(projectId !== undefined && { projectId }),
        updatedAt: new Date(),
      })
      .where(eq(integrationCredential.id, id));
    if (projectId != null) await pruneGrantsOutside(id, projectId, tx);
  });
  forgetTeamSecrets(teamId);
  return getCredentialEntry(id, teamId);
}

// A new key pair for an SSH key: the old public key stops working wherever it was added.
export async function regenerateSshKey(
  id: number,
  teamId: number,
): Promise<CredentialEntry | null> {
  const existing = await getCredentialEntry(id, teamId);
  if (!existing) return null;
  if (existing.kind !== 'ssh_key') throw new HttpError(400, 'Only an SSH key has a key pair.');
  const key = generateSshKey(sshKeyComment(existing.label));
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(integrationCredential)
      .where(and(eq(integrationCredential.id, id), eq(integrationCredential.teamId, teamId)))
      .for('update');
    if (!row) return;
    await retainTeamSecrets(teamId, existing.kind, JSON.parse(openCredential(row)), tx);
    await tx
      .update(integrationCredential)
      .set({
        ...stored(
          id,
          { publicKey: key.publicKey, notes: existing.notes },
          { privateKey: key.privateKey },
        ),
        updatedAt: new Date(),
      })
      .where(eq(integrationCredential.id, id));
  });
  forgetTeamSecrets(teamId);
  return getCredentialEntry(id, teamId);
}

export async function deleteCredentialEntry(
  id: number,
  teamId: number,
  person?: { name?: string | null; email?: string | null } | null,
): Promise<boolean> {
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(integrationCredential)
      .where(
        and(eq(integrationCredential.id, id), eq(integrationCredential.teamId, teamId), storeKinds),
      )
      .returning();
    if (!row) return false;
    await retainTeamSecrets(teamId, row.integrationKey, JSON.parse(openCredential(row)), tx);
    await tx.insert(integrationCredentialUse).values({
      teamId,
      credentialId: null,
      credentialLabel: row.label ?? '',
      agentId: null,
      agentName: person?.name || person?.email || '',
      action: 'changed',
      purpose: 'deleted',
    });
    return true;
  });
  forgetTeamSecrets(teamId);
  return deleted;
}

// The kinds a grant can be given for: the credentials of the page, and connector accounts.
export const GRANTABLE_KINDS = [...CREDENTIAL_KINDS, 'google', 'mcp_oauth'];

// Replaces the grants of a credential or a connector account. Every agent has to run in a
// runner and, for a credential limited to a project, work in that project; a project grant
// can only name that project.
export async function setCredentialGrants(
  id: number,
  teamId: number,
  grants: GrantInput[],
): Promise<GrantEntry[] | null> {
  const [row] = await db
    .select({
      id: integrationCredential.id,
      kind: integrationCredential.integrationKey,
      projectId: integrationCredential.projectId,
      projectKey: project.key,
      runtime: sql<string | null>`${integrationCredential.redacted}->>'runtime'`,
    })
    .from(integrationCredential)
    .leftJoin(project, eq(project.id, integrationCredential.projectId))
    .where(
      and(
        eq(integrationCredential.id, id),
        eq(integrationCredential.teamId, teamId),
        inArray(integrationCredential.integrationKey, GRANTABLE_KINDS),
      ),
    );
  if (!row) return null;
  const services = connectors.get(row.kind)?.services.map((service) => service.id) ?? [];
  await replaceGrants(
    { ...row, teamId, services, runtime: row.kind === 'runtime_login' ? row.runtime : null },
    grants,
  );
  return (await grantsOf([id])).get(id) ?? [];
}

// The audit log of one credential, newest first.
export function listCredentialUses(
  teamId: number,
  id: number,
  window: { limit: number; offset: number },
): Promise<{ items: AuditEntry[]; total: number }> {
  return listAudit(teamId, { credentialId: id }, window);
}
