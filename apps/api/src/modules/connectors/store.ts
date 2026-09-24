import {
  db,
  integrationCredential,
  nextCredentialId,
  openCredential,
  project,
  sealCredential,
} from '@repo/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { iso } from '#shared/lib';
import { grantsOf, type GrantEntry } from '#modules/agents/credentials/grants';

// Connector accounts in the credential store: rows of integration_credential whose kind
// is a connector ('google', 'google_oauth_client', 'mcp_oauth'). `redacted` holds the
// readable settings, the ciphertext the secrets; a response names which secrets are set,
// never their values.

export type Readable = Record<string, unknown>;
export type Secrets = Record<string, string>;

export interface AccountRow {
  id: number;
  teamId: number;
  kind: string;
  label: string;
  projectId: number | null;
  projectKey: string | null;
  readable: Readable;
  status: 'ok' | 'needs_auth' | 'error' | null;
  statusDetail: string | null;
  checkedAt: string | null;
  grants: GrantEntry[];
  createdAt: string;
  updatedAt: string;
}

const columns = {
  id: integrationCredential.id,
  teamId: integrationCredential.teamId,
  kind: integrationCredential.integrationKey,
  label: integrationCredential.label,
  projectId: integrationCredential.projectId,
  projectKey: project.key,
  redacted: integrationCredential.redacted,
  status: integrationCredential.status,
  statusDetail: integrationCredential.statusDetail,
  checkedAt: integrationCredential.checkedAt,
  createdAt: integrationCredential.createdAt,
  updatedAt: integrationCredential.updatedAt,
};

type Row = {
  id: number;
  teamId: number;
  kind: string;
  label: string | null;
  projectId: number | null;
  projectKey: string | null;
  redacted: unknown;
  status: string | null;
  statusDetail: string | null;
  checkedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

async function toAccounts(rows: Row[]): Promise<AccountRow[]> {
  const grants = await grantsOf(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    teamId: row.teamId,
    kind: row.kind,
    label: row.label ?? '',
    projectId: row.projectId,
    projectKey: row.projectKey,
    readable: row.redacted && typeof row.redacted === 'object' ? (row.redacted as Readable) : {},
    status: row.status as AccountRow['status'],
    statusDetail: row.statusDetail,
    checkedAt: row.checkedAt ? iso(row.checkedAt) : null,
    grants: grants.get(row.id) ?? [],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }));
}

export async function listAccounts(teamId: number, kind: string): Promise<AccountRow[]> {
  const rows = await db
    .select(columns)
    .from(integrationCredential)
    .leftJoin(project, eq(project.id, integrationCredential.projectId))
    .where(
      and(eq(integrationCredential.teamId, teamId), eq(integrationCredential.integrationKey, kind)),
    )
    .orderBy(asc(integrationCredential.label), asc(integrationCredential.id));
  return toAccounts(rows);
}

export async function getAccount(
  id: number,
  teamId: number,
  kinds: string[],
): Promise<AccountRow | null> {
  const [row] = await db
    .select(columns)
    .from(integrationCredential)
    .leftJoin(project, eq(project.id, integrationCredential.projectId))
    .where(
      and(
        eq(integrationCredential.id, id),
        eq(integrationCredential.teamId, teamId),
        inArray(integrationCredential.integrationKey, kinds),
      ),
    );
  return row ? ((await toAccounts([row]))[0] ?? null) : null;
}

export async function readAccountSecrets(id: number): Promise<Secrets> {
  const [row] = await db
    .select({
      id: integrationCredential.id,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(eq(integrationCredential.id, id));
  return row ? (JSON.parse(openCredential(row)) as Secrets) : {};
}

// The stored form: secrets encrypted as one JSON object, the readable fields plus `true`
// for every secret that is set.
export function sealed(id: number, readable: Readable, secrets: Secrets) {
  const encrypted = sealCredential(id, JSON.stringify(secrets));
  const marks = Object.fromEntries(Object.keys(secrets).map((field) => [field, true]));
  return { ...encrypted, redacted: { ...readable, ...marks } };
}

// The readable fields without the marks of the secrets.
export function readableOnly(readable: Readable, secretFields: readonly string[]): Readable {
  return Object.fromEntries(
    Object.entries(readable).filter(([key]) => !secretFields.includes(key)),
  );
}

export async function insertAccount(input: {
  teamId: number;
  kind: string;
  label: string;
  projectId: number | null;
  readable: Readable;
  secrets: Secrets;
}): Promise<number> {
  const id = await nextCredentialId();
  const [row] = await db
    .insert(integrationCredential)
    .values({
      id,
      teamId: input.teamId,
      integrationKey: input.kind,
      label: input.label,
      projectId: input.projectId,
      ...sealed(id, input.readable, input.secrets),
    })
    .returning({ id: integrationCredential.id });
  return row!.id;
}

export async function updateAccount(
  id: number,
  patch: {
    label?: string;
    projectId?: number | null;
    readable?: Readable;
    secrets?: Secrets;
    status?: AccountRow['status'];
    statusDetail?: string | null;
  },
): Promise<void> {
  let stored = {};
  if (patch.readable || patch.secrets) {
    const currentSecrets = await readAccountSecrets(id);
    const [row] = await db
      .select({ redacted: integrationCredential.redacted })
      .from(integrationCredential)
      .where(eq(integrationCredential.id, id));
    const currentReadable = readableOnly(
      (row?.redacted as Readable | undefined) ?? {},
      Object.keys(currentSecrets),
    );
    stored = sealed(id, patch.readable ?? currentReadable, patch.secrets ?? currentSecrets);
  }
  await db
    .update(integrationCredential)
    .set({
      ...stored,
      ...(patch.label !== undefined && { label: patch.label }),
      ...(patch.projectId !== undefined && { projectId: patch.projectId }),
      ...(patch.status !== undefined && {
        status: patch.status,
        statusDetail: patch.statusDetail ?? null,
        checkedAt: new Date(),
      }),
      updatedAt: new Date(),
    })
    .where(eq(integrationCredential.id, id));
}

export async function setAccountStatus(
  id: number,
  status: NonNullable<AccountRow['status']>,
  detail: string | null,
): Promise<void> {
  await db
    .update(integrationCredential)
    .set({ status, statusDetail: detail?.slice(0, 500) ?? null, checkedAt: new Date() })
    .where(eq(integrationCredential.id, id));
}

export async function deleteAccount(id: number, teamId: number, kind: string): Promise<boolean> {
  const deleted = await db
    .delete(integrationCredential)
    .where(
      and(
        eq(integrationCredential.id, id),
        eq(integrationCredential.teamId, teamId),
        eq(integrationCredential.integrationKey, kind),
      ),
    )
    .returning({ id: integrationCredential.id });
  return deleted.length > 0;
}
