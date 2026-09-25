import {
  db,
  integrationCredential,
  nextCredentialId,
  openCredential,
  sealCredential,
} from '@repo/db';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import {
  coerceConfig,
  redactConfig,
  ToolConfigError,
  type ToolConfig,
  type ConfigField,
} from '@repo/agent-tools';
import { iso, HttpError } from '#shared/lib';
import { CREDENTIAL_KINDS } from '../credentials/kinds';
import { credentialSchemaFor, integrationKind, type IntegrationKind } from './catalog';

// Data access for integration credentials. They belong to the team, so a
// project-scoped caller resolves its team id first. The full credential object is
// encrypted at rest (AES-256-GCM) as one JSON blob; `redacted` holds the same object
// with secret fields masked, in plaintext, for a masked display. The plaintext
// credential is never returned over HTTP. The rows of the Credentials page share the
// table and are left out here.

function integrationsOf(teamId: number) {
  return and(
    eq(integrationCredential.teamId, teamId),
    notInArray(integrationCredential.integrationKey, [...CREDENTIAL_KINDS]),
  );
}

export interface CredentialRow {
  id: number;
  teamId: number;
  integrationKey: string;
  label: string | null;
  redacted: Record<string, unknown>;
  createdAt: string;
}

const dtoColumns = {
  id: integrationCredential.id,
  teamId: integrationCredential.teamId,
  integrationKey: integrationCredential.integrationKey,
  label: integrationCredential.label,
  redacted: integrationCredential.redacted,
  createdAt: integrationCredential.createdAt,
};

function mapRow(row: {
  id: number;
  teamId: number;
  integrationKey: string;
  label: string | null;
  redacted: unknown;
  createdAt: Date;
}): CredentialRow {
  return {
    id: row.id,
    teamId: row.teamId,
    integrationKey: row.integrationKey,
    label: row.label,
    redacted:
      row.redacted && typeof row.redacted === 'object'
        ? (row.redacted as Record<string, unknown>)
        : {},
    createdAt: iso(row.createdAt),
  };
}

// Validates a submitted credential against a schema, mapping the package's validation
// error to a 400.
function coerce(fields: ConfigField[], input: unknown): ToolConfig {
  try {
    return coerceConfig(fields, input);
  } catch (err) {
    if (err instanceof ToolConfigError) throw new HttpError(400, err.message);
    throw err;
  }
}

// One page of the team's credentials, by integration key, with how many it holds in
// total.
export async function listCredentials(
  teamId: number,
  window: { limit: number; offset: number },
): Promise<{ items: CredentialRow[]; total: number }> {
  const where = integrationsOf(teamId);
  const [rows, counted] = await Promise.all([
    db
      .select(dtoColumns)
      .from(integrationCredential)
      .where(where)
      .orderBy(integrationCredential.integrationKey)
      .limit(window.limit)
      .offset(window.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(integrationCredential)
      .where(where),
  ]);
  return { items: rows.map(mapRow), total: counted[0]?.count ?? 0 };
}

export interface CredentialOption {
  id: number;
  integrationKey: string;
  kind: IntegrationKind | 'secret';
  label: string | null;
}

// The team's credentials as picker entries, by integration key: its integrations, and
// as kind 'secret' the secrets and API keys of the Credentials page that an MCP server
// may name (those not limited to a project).
export async function listCredentialOptions(teamId: number): Promise<CredentialOption[]> {
  const rows = await db
    .select({
      id: integrationCredential.id,
      integrationKey: integrationCredential.integrationKey,
      label: integrationCredential.label,
    })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, teamId),
        isNull(integrationCredential.projectId),
        notInArray(integrationCredential.integrationKey, ['web_login', 'ssh_key']),
      ),
    )
    .orderBy(integrationCredential.integrationKey);
  return rows.flatMap((row) => {
    const kind =
      row.integrationKey === 'secret' ||
      row.integrationKey === 'api_key' ||
      row.integrationKey === 'mcp_oauth'
        ? 'secret'
        : integrationKind(row.integrationKey);
    return kind ? [{ ...row, kind }] : [];
  });
}

export async function getCredentialById(id: number, teamId: number): Promise<CredentialRow | null> {
  const rows = await db
    .select(dtoColumns)
    .from(integrationCredential)
    .where(and(eq(integrationCredential.id, id), integrationsOf(teamId)));
  return rows[0] ? mapRow(rows[0]) : null;
}

async function decrypt(id: number, teamId: number): Promise<ToolConfig | null> {
  const rows = await db
    .select({
      id: integrationCredential.id,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(and(eq(integrationCredential.id, id), eq(integrationCredential.teamId, teamId)));
  const row = rows[0];
  if (!row) return null;
  return JSON.parse(openCredential(row)) as ToolConfig;
}

// The decrypted values of a credential of the team, for a configured tool that runs with
// it (agents/tools/run.ts). Never returned over HTTP.
export function credentialValues(id: number, teamId: number): Promise<ToolConfig | null> {
  return decrypt(id, teamId);
}

export interface NewCredentialInput {
  integrationKey: string;
  label?: string | null;
  credential: Record<string, unknown>;
}

export async function createCredential(
  teamId: number,
  input: NewCredentialInput,
): Promise<CredentialRow> {
  const schema = credentialSchemaFor(input.integrationKey);
  if (!schema) throw new HttpError(400, `Unknown integration: ${input.integrationKey}`);
  const config = coerce(schema, input.credential);
  const id = await nextCredentialId();
  const enc = sealCredential(id, JSON.stringify(config));
  const [row] = await db
    .insert(integrationCredential)
    .values({
      id,
      teamId,
      integrationKey: input.integrationKey,
      label: input.label ?? null,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      redacted: redactConfig(schema, config),
    })
    .returning(dtoColumns);
  return mapRow(row);
}

export interface CredentialPatch {
  label?: string | null;
  // Only the fields being changed. Secret fields left out keep their stored value.
  credential?: Record<string, unknown>;
}

export async function updateCredential(
  id: number,
  teamId: number,
  patch: CredentialPatch,
): Promise<CredentialRow | null> {
  const existing = await getCredentialById(id, teamId);
  if (!existing) return null;
  const schema = credentialSchemaFor(existing.integrationKey);
  if (!schema) throw new HttpError(400, `Unknown integration: ${existing.integrationKey}`);

  const set: Partial<typeof integrationCredential.$inferInsert> = {};
  if (patch.label !== undefined) set.label = patch.label;

  if (patch.credential !== undefined) {
    // Merge the submitted fields over the stored credential so unchanged secrets (left
    // out by the form) are preserved, then re-validate the whole credential.
    const current = (await decrypt(id, teamId)) ?? {};
    const merged = coerce(schema, { ...current, ...patch.credential });
    const enc = sealCredential(id, JSON.stringify(merged));
    set.ciphertext = enc.ciphertext;
    set.iv = enc.iv;
    set.authTag = enc.authTag;
    set.redacted = redactConfig(schema, merged);
  }

  if (Object.keys(set).length > 0) {
    await db
      .update(integrationCredential)
      .set(set)
      .where(and(eq(integrationCredential.id, id), eq(integrationCredential.teamId, teamId)));
  }
  return getCredentialById(id, teamId);
}

export async function deleteCredential(id: number, teamId: number): Promise<boolean> {
  const existing = await getCredentialById(id, teamId);
  if (!existing) return false;
  await db
    .delete(integrationCredential)
    .where(and(eq(integrationCredential.id, id), eq(integrationCredential.teamId, teamId)));
  return true;
}
