import {
  db,
  agentRun,
  aiAgent,
  integrationCredential,
  integrationCredentialGrant,
  integrationCredentialUse,
  issue,
  project,
  user,
} from '@repo/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '@repo/crypto';
import { HttpError, iso } from '#shared/lib';
import { agentWorksInProject } from '../core/service';
import {
  CREDENTIAL_KINDS,
  SECRET_FIELDS,
  allowedOrigin,
  assertFieldsOfKind,
  assertTotpSecret,
  loginUrlOf,
  type CredentialFields,
  type CredentialKind,
} from './kinds';
import { generateSshKey, sshKeyComment } from './ssh-key';

// The credentials of the Credentials page: web logins, API keys, SSH keys and secrets
// of a team, each for the whole team or one project, and the agents they are granted
// to. They are rows of integration_credential. The secret fields are encrypted and
// write-only: a response says which of them hold a value, never the value.

export interface CredentialEntry {
  id: number;
  teamId: number;
  kind: CredentialKind;
  label: string;
  projectId: number | null;
  projectKey: string | null;
  loginUrl: string | null;
  allowedDomains: string[];
  username: string | null;
  notes: string;
  publicKey: string | null;
  secrets: string[];
  agentIds: number[];
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
  [secretField: string]: unknown;
}

type Secrets = Record<string, string>;

const MAX_ALLOWED_DOMAINS = 20;

export const storeKinds = inArray(integrationCredential.integrationKey, [...CREDENTIAL_KINDS]);

const entryColumns = {
  id: integrationCredential.id,
  teamId: integrationCredential.teamId,
  kind: integrationCredential.integrationKey,
  label: integrationCredential.label,
  projectId: integrationCredential.projectId,
  projectKey: project.key,
  redacted: integrationCredential.redacted,
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
  createdAt: Date;
  updatedAt: Date;
};

function readableOf(value: unknown): Readable {
  return value && typeof value === 'object' ? (value as Readable) : {};
}

function toEntry(row: EntryRow, agentIds: number[]): CredentialEntry {
  const kind = row.kind as CredentialKind;
  const readable = readableOf(row.redacted);
  return {
    id: row.id,
    teamId: row.teamId,
    kind,
    label: row.label ?? '',
    projectId: row.projectId,
    projectKey: row.projectKey,
    loginUrl: readable.loginUrl ?? null,
    allowedDomains: readable.allowedDomains ?? [],
    username: readable.username ?? null,
    notes: readable.notes ?? '',
    publicKey: readable.publicKey ?? null,
    secrets: SECRET_FIELDS[kind].filter((field) => Boolean(readable[field])),
    agentIds,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function grantsOf(credentialIds: number[]): Promise<Map<number, number[]>> {
  const byCredential = new Map<number, number[]>();
  if (credentialIds.length === 0) return byCredential;
  const rows = await db
    .select({
      credentialId: integrationCredentialGrant.credentialId,
      agentId: integrationCredentialGrant.agentId,
    })
    .from(integrationCredentialGrant)
    .where(inArray(integrationCredentialGrant.credentialId, credentialIds))
    .orderBy(integrationCredentialGrant.agentId);
  for (const row of rows) {
    byCredential.set(row.credentialId, [
      ...(byCredential.get(row.credentialId) ?? []),
      row.agentId,
    ]);
  }
  return byCredential;
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
  filter: { kind?: CredentialKind; projectId?: number },
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

async function readSecrets(id: number): Promise<Secrets> {
  const [row] = await db
    .select({
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(eq(integrationCredential.id, id));
  return row ? (JSON.parse(decryptSecret(row)) as Secrets) : {};
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
  const value = fields.value === undefined ? current.secrets.value : fields.value;
  return { readable: { notes }, secrets: { value: requiredSecret(value, 'A value') } };
}

function stored(readable: Readable, secrets: Secrets) {
  const encrypted = encryptSecret(JSON.stringify(secrets));
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
  const [row] = await db
    .insert(integrationCredential)
    .values({ teamId, integrationKey: kind, label, projectId, ...stored(readable, secrets) })
    .returning({ id: integrationCredential.id });
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
  assertFieldsOfKind(existing.kind, fields);
  const name = label === undefined ? undefined : required(label, 'A name');
  if (projectId != null) await assertProjectOfTeam(projectId, teamId);
  const [row] = await db
    .select({ redacted: integrationCredential.redacted })
    .from(integrationCredential)
    .where(eq(integrationCredential.id, id));
  const current = { readable: readableOf(row.redacted), secrets: await readSecrets(id) };
  const { readable, secrets } = compose(existing.kind, fields, current);
  const outside: number[] = [];
  if (projectId != null) {
    for (const agentId of existing.agentIds) {
      if (!(await agentWorksInProject(agentId, projectId))) outside.push(agentId);
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(integrationCredential)
      .set({
        ...stored(readable, secrets),
        ...(name !== undefined && { label: name }),
        ...(projectId !== undefined && { projectId }),
        updatedAt: new Date(),
      })
      .where(eq(integrationCredential.id, id));
    if (outside.length > 0) {
      await tx
        .delete(integrationCredentialGrant)
        .where(
          and(
            eq(integrationCredentialGrant.credentialId, id),
            inArray(integrationCredentialGrant.agentId, outside),
          ),
        );
    }
  });
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
  await db
    .update(integrationCredential)
    .set({
      ...stored(
        { publicKey: key.publicKey, notes: existing.notes },
        { privateKey: key.privateKey },
      ),
      updatedAt: new Date(),
    })
    .where(eq(integrationCredential.id, id));
  return getCredentialEntry(id, teamId);
}

export async function deleteCredentialEntry(id: number, teamId: number): Promise<boolean> {
  const deleted = await db
    .delete(integrationCredential)
    .where(
      and(eq(integrationCredential.id, id), eq(integrationCredential.teamId, teamId), storeKinds),
    )
    .returning({ id: integrationCredential.id });
  return deleted.length > 0;
}

// Replaces the agents a credential is granted to. Every agent has to be one of the team
// that runs in Hermes, and work in the credential's project when it has one.
export async function setCredentialGrants(
  id: number,
  teamId: number,
  agentIds: number[],
): Promise<CredentialEntry | null> {
  const existing = await getCredentialEntry(id, teamId);
  if (!existing) return null;
  const unique = [...new Set(agentIds)];
  const agents =
    unique.length === 0
      ? []
      : await db
          .select({
            id: aiAgent.id,
            name: user.name,
            kind: aiAgent.kind,
            template: aiAgent.template,
          })
          .from(aiAgent)
          .innerJoin(user, eq(user.id, aiAgent.userId))
          .where(and(eq(aiAgent.teamId, teamId), inArray(aiAgent.id, unique)));
  if (agents.length !== unique.length) throw new HttpError(400, 'An agent is not of this team.');
  for (const agent of agents) {
    if (agent.kind !== 'external' || agent.template) {
      throw new HttpError(400, `${agent.name} does not run in Hermes.`);
    }
    if (existing.projectId !== null && !(await agentWorksInProject(agent.id, existing.projectId))) {
      throw new HttpError(400, `${agent.name} does not work in ${existing.projectKey}.`);
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(integrationCredentialGrant)
      .where(eq(integrationCredentialGrant.credentialId, id));
    if (unique.length > 0) {
      await tx
        .insert(integrationCredentialGrant)
        .values(unique.map((agentId) => ({ credentialId: id, agentId })));
    }
  });
  return getCredentialEntry(id, teamId);
}

export async function hasWebLoginGrant(agentId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: integrationCredential.id })
    .from(integrationCredentialGrant)
    .innerJoin(
      integrationCredential,
      and(
        eq(integrationCredential.id, integrationCredentialGrant.credentialId),
        eq(integrationCredential.integrationKey, 'web_login'),
      ),
    )
    .where(eq(integrationCredentialGrant.agentId, agentId))
    .limit(1);
  return Boolean(row);
}

export interface CredentialUseEntry {
  id: number;
  action: 'delivered' | 'used';
  purpose: string;
  agentId: number | null;
  agentName: string;
  runId: number | null;
  issueIdentifier: string | null;
  chatMessageId: number | null;
  createdAt: string;
}

// The audit log of one credential, newest first.
export async function listCredentialUses(
  id: number,
  window: { limit: number; offset: number },
): Promise<{ items: CredentialUseEntry[]; total: number }> {
  const where = eq(integrationCredentialUse.credentialId, id);
  const [rows, counted] = await Promise.all([
    db
      .select({
        id: integrationCredentialUse.id,
        action: integrationCredentialUse.action,
        purpose: integrationCredentialUse.purpose,
        agentId: integrationCredentialUse.agentId,
        agentName: integrationCredentialUse.agentName,
        runId: integrationCredentialUse.runId,
        issueIdentifier: sql<
          string | null
        >`case when ${issue.id} is null then null else ${project.key} || '-' || ${issue.sequenceNumber} end`,
        chatMessageId: integrationCredentialUse.chatMessageId,
        createdAt: integrationCredentialUse.createdAt,
      })
      .from(integrationCredentialUse)
      .leftJoin(agentRun, eq(agentRun.id, integrationCredentialUse.runId))
      .leftJoin(issue, eq(issue.id, agentRun.issueId))
      .leftJoin(project, eq(project.id, issue.projectId))
      .where(where)
      .orderBy(desc(integrationCredentialUse.createdAt), desc(integrationCredentialUse.id))
      .limit(window.limit)
      .offset(window.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(integrationCredentialUse)
      .where(where),
  ]);
  return {
    items: rows.map((row) => ({
      ...row,
      action: row.action as CredentialUseEntry['action'],
      createdAt: iso(row.createdAt),
    })),
    total: counted[0]?.count ?? 0,
  };
}
