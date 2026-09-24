import { db, agentMcpServer, agentMcpServerLink, integrationCredential } from '@repo/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { decryptSecret } from '@repo/crypto';
import { iso, HttpError, rethrowDuplicate } from '#shared/lib';
import { onTemplateRelevantChange } from '../core/template-sync';

// The team's library of MCP servers and the servers enabled on each agent. An env or
// header value is a literal or the id of one of the team's secrets: a secret or an API
// key of the Credentials page that is not limited to a project. Its value is decrypted
// only for the runner of an agent the server is enabled on.

const teamSecret = and(
  inArray(integrationCredential.integrationKey, ['secret', 'api_key']),
  isNull(integrationCredential.projectId),
);

export type McpTransport = 'stdio' | 'http' | 'sse';

// How env and headers are stored: exactly one of the two fields is set.
interface StoredValue {
  name: string;
  value?: string;
  credentialId?: number;
}

export interface McpServerValue {
  name: string;
  value: string | null;
  credentialId: number | null;
  credentialLabel: string | null;
}

export interface McpServerRow {
  id: number;
  teamId: number;
  name: string;
  description: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env: McpServerValue[];
  headers: McpServerValue[];
  builtin: boolean;
  createdAt: string;
}

// The instance's own library entries (name = the value stored, which is also its Hermes
// toolset/MCP server key; a team cannot rename, edit or delete these — see guards in
// index.ts). "Hermes-eigener Browser (alt)" is not an MCP server at all: the runner
// recognizes this one name and keeps it out of the MCP server list it writes, using its
// presence on an agent only as the "keep Hermes' native CDP browser toolset" flag (see
// packages/runner/src/policy.ts, BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME).
export const BROWSER_GATEWAY_MCP_SERVER_NAME = 'projekt-browser';
export const BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME = 'hermes-browser-legacy';
export const BUILTIN_MCP_SERVER_NAMES = [
  BROWSER_GATEWAY_MCP_SERVER_NAME,
  BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME,
] as const;

export interface McpServerInput {
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[];
  url?: string | null;
  env?: StoredValue[];
  headers?: StoredValue[];
}

type ServerRecord = typeof agentMcpServer.$inferSelect;

async function secretLabels(teamId: number): Promise<Map<number, string | null>> {
  const rows = await db
    .select({ id: integrationCredential.id, label: integrationCredential.label })
    .from(integrationCredential)
    .where(and(eq(integrationCredential.teamId, teamId), teamSecret));
  return new Map(rows.map((row) => [row.id, row.label]));
}

function stored(value: unknown): StoredValue[] {
  return Array.isArray(value) ? (value as StoredValue[]) : [];
}

function valuesOf(value: unknown, labels: Map<number, string | null>): McpServerValue[] {
  return stored(value).map((entry) =>
    entry.credentialId === undefined
      ? { name: entry.name, value: entry.value ?? '', credentialId: null, credentialLabel: null }
      : {
          name: entry.name,
          value: null,
          credentialId: entry.credentialId,
          credentialLabel: labels.get(entry.credentialId) ?? null,
        },
  );
}

function mapRow(row: ServerRecord, labels: Map<number, string | null>): McpServerRow {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    description: row.description,
    transport: row.transport as McpTransport,
    command: row.command,
    args: Array.isArray(row.args) ? (row.args as string[]) : [],
    url: row.url,
    env: valuesOf(row.env, labels),
    headers: valuesOf(row.headers, labels),
    builtin: row.builtin,
    createdAt: iso(row.createdAt),
  };
}

// Hermes expands ${VAR} in every string of a server's configuration, with the values of
// its own environment, which holds the provider credentials of the whole installation.
function refuseExpansion(value: string, what: string): void {
  if (value.includes('${')) {
    throw new HttpError(400, `${what} cannot contain "\${". Reference a secret instead.`);
  }
}

function checkedValues(list: StoredValue[], what: string, caseInsensitive: boolean) {
  const seen = new Set<string>();
  return list.map((entry): StoredValue => {
    const key = caseInsensitive ? entry.name.toLowerCase() : entry.name;
    if (seen.has(key)) throw new HttpError(400, `${what} ${entry.name} is set twice.`);
    seen.add(key);
    if ((entry.value === undefined) === (entry.credentialId === undefined)) {
      throw new HttpError(400, `${what} ${entry.name} needs either a value or a secret.`);
    }
    if (entry.credentialId !== undefined) {
      return { name: entry.name, credentialId: entry.credentialId };
    }
    refuseExpansion(entry.value!, `${what} ${entry.name}`);
    return { name: entry.name, value: entry.value };
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function transportFields(input: McpServerInput): {
  command: string | null;
  args: string[];
  url: string | null;
  env: StoredValue[];
  headers: StoredValue[];
} {
  if (input.transport === 'stdio') {
    const command = input.command?.trim();
    if (!command) throw new HttpError(400, 'A stdio server needs a command.');
    refuseExpansion(command, 'The command');
    const args = input.args ?? [];
    for (const arg of args) refuseExpansion(arg, 'An argument');
    const env = checkedValues(input.env ?? [], 'Environment variable', false);
    return { command, args, url: null, env, headers: [] };
  }
  const url = input.url?.trim() ?? '';
  if (!isHttpUrl(url)) throw new HttpError(400, 'An http or sse server needs an http(s) URL.');
  refuseExpansion(url, 'The URL');
  const headers = checkedValues(input.headers ?? [], 'Header', true);
  return { command: null, args: [], url, env: [], headers };
}

// The stored columns of a server, and the labels of the team's secrets. The fields its
// transport does not use are cleared, so a change of transport needs no second request to
// empty them.
async function columns(teamId: number, input: McpServerInput) {
  const fields = transportFields(input);
  const labels = await secretLabels(teamId);
  for (const entry of [...fields.env, ...fields.headers]) {
    if (entry.credentialId !== undefined && !labels.has(entry.credentialId)) {
      throw new HttpError(400, `The secret of ${entry.name} is not a secret of this team.`);
    }
  }
  const values = {
    name: input.name,
    description: (input.description ?? '').trim(),
    transport: input.transport,
    ...fields,
  };
  return { values, labels };
}

// A team's library, the built-in entries included: a team that does not have them yet (one
// created before them, or since) gets them here, once, so every team can switch
// "Projekt-Browser" on for an agent without a setup step.
export async function listMcpServers(teamId: number): Promise<McpServerRow[]> {
  const load = () =>
    Promise.all([
      db
        .select()
        .from(agentMcpServer)
        .where(eq(agentMcpServer.teamId, teamId))
        .orderBy(agentMcpServer.name),
      secretLabels(teamId),
    ]);
  let [rows, labels] = await load();
  const present = new Set(rows.filter((row) => row.builtin).map((row) => row.name));
  if (BUILTIN_MCP_SERVER_NAMES.some((name) => !present.has(name))) {
    await ensureBuiltinMcpServers(teamId);
    [rows, labels] = await load();
  }
  return rows.map((row) => mapRow(row, labels));
}

async function getRecord(id: number, teamId: number): Promise<ServerRecord | null> {
  const [row] = await db
    .select()
    .from(agentMcpServer)
    .where(and(eq(agentMcpServer.id, id), eq(agentMcpServer.teamId, teamId)));
  return row ?? null;
}

export async function createMcpServer(teamId: number, input: McpServerInput) {
  const { values, labels } = await columns(teamId, input);
  try {
    const [row] = await db
      .insert(agentMcpServer)
      .values({ teamId, ...values })
      .returning();
    return mapRow(row, labels);
  } catch (err) {
    rethrowDuplicate(err, 'server');
  }
}

export async function updateMcpServer(
  id: number,
  teamId: number,
  patch: Partial<McpServerInput>,
): Promise<McpServerRow | null> {
  const existing = await getRecord(id, teamId);
  if (!existing) return null;
  if (existing.builtin)
    throw new HttpError(403, 'This MCP server is built in and cannot be changed.');
  const { values, labels } = await columns(teamId, {
    name: existing.name,
    description: existing.description,
    transport: existing.transport as McpTransport,
    command: existing.command,
    args: existing.args as string[],
    url: existing.url,
    env: stored(existing.env),
    headers: stored(existing.headers),
    ...patch,
  });
  try {
    const [row] = await db
      .update(agentMcpServer)
      .set(values)
      .where(and(eq(agentMcpServer.id, id), eq(agentMcpServer.teamId, teamId)))
      .returning();
    return mapRow(row, labels);
  } catch (err) {
    rethrowDuplicate(err, 'server');
  }
}

export async function deleteMcpServer(id: number, teamId: number): Promise<boolean> {
  const existing = await getRecord(id, teamId);
  if (!existing) return false;
  if (existing.builtin)
    throw new HttpError(403, 'This MCP server is built in and cannot be deleted.');
  const deleted = await db
    .delete(agentMcpServer)
    .where(and(eq(agentMcpServer.id, id), eq(agentMcpServer.teamId, teamId)))
    .returning({ id: agentMcpServer.id });
  return deleted.length > 0;
}

// Idempotent: called once per team (setup-browser-gateway.ts) and safe to call again after
// the gateway's shim path changes — it updates the existing builtin row rather than
// duplicating it. "Projekt-Browser" is a real stdio MCP server, reached over the gateway's
// Unix socket by the shim at BROWSER_GATEWAY_SHIM_PATH (see
// deployment/volition-stack/browser/README.md). "Hermes-eigener Browser (alt)" carries no
// command Hermes ever runs (see BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME above); it is stored
// with a placeholder, self-explaining command so a team owner inspecting the library is not
// confused by an empty one, off by default per the design (§3: "Rückfallweg... standardmäßig
// aus" — no agent gets it enabled by this function).
export const BROWSER_GATEWAY_SHIM_PATH = '/usr/local/libexec/volition-browser-gateway-mcp';

export async function ensureBuiltinMcpServers(teamId: number): Promise<void> {
  const seeds: Array<{
    name: string;
    description: string;
    transport: McpTransport;
    command: string;
    args: string[];
  }> = [
    {
      name: BROWSER_GATEWAY_MCP_SERVER_NAME,
      description:
        "The project browser gateway: patchright over CDP against the project's own, " +
        'always-on Chromium, with logins filled from Zugänge and a shared control lock with ' +
        'the live view. Built in; cannot be edited or removed.',
      transport: 'stdio',
      command: BROWSER_GATEWAY_SHIM_PATH,
      args: [],
    },
    {
      name: BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME,
      description:
        "Falls back to Hermes' own, pre-gateway CDP browser toolset instead of the shared " +
        'gateway. Off by default; only Hermes reads this flag. Built in; cannot be edited or ' +
        'removed.',
      transport: 'stdio',
      command: 'hermes-native-browser-toolset',
      args: [],
    },
  ];
  for (const seed of seeds) {
    await db
      .insert(agentMcpServer)
      .values({ teamId, ...seed, builtin: true })
      .onConflictDoUpdate({
        target: [agentMcpServer.teamId, agentMcpServer.name],
        set: { description: seed.description, command: seed.command, builtin: true },
      });
  }
}

async function linkedRecords(agentId: number): Promise<ServerRecord[]> {
  const rows = await db
    .select({ server: agentMcpServer })
    .from(agentMcpServerLink)
    .innerJoin(agentMcpServer, eq(agentMcpServer.id, agentMcpServerLink.mcpServerId))
    .where(eq(agentMcpServerLink.agentId, agentId))
    .orderBy(agentMcpServer.name);
  return rows.map(({ server }) => server);
}

export async function listAgentMcpServers(
  agentId: number,
  teamId: number,
): Promise<McpServerRow[]> {
  const [rows, labels] = await Promise.all([linkedRecords(agentId), secretLabels(teamId)]);
  return rows.map((row) => mapRow(row, labels));
}

// Unknown ids and ids from another team are ignored, not rejected.
export async function setAgentMcpServers(
  agentId: number,
  teamId: number,
  mcpServerIds: number[],
): Promise<void> {
  const unique = [...new Set(mcpServerIds)];
  const valid =
    unique.length === 0
      ? []
      : (
          await db
            .select({ id: agentMcpServer.id })
            .from(agentMcpServer)
            .where(and(eq(agentMcpServer.teamId, teamId), inArray(agentMcpServer.id, unique)))
        ).map((row) => row.id);
  await db.transaction(async (tx) => {
    await tx.delete(agentMcpServerLink).where(eq(agentMcpServerLink.agentId, agentId));
    if (valid.length > 0) {
      await tx
        .insert(agentMcpServerLink)
        .values(valid.map((mcpServerId) => ({ agentId, mcpServerId })));
    }
  });
  await onTemplateRelevantChange(agentId, ['mcpServers']);
}

export async function agentMcpServerIds(agentId: number): Promise<number[]> {
  const rows = await db
    .select({ id: agentMcpServerLink.mcpServerId })
    .from(agentMcpServerLink)
    .where(eq(agentMcpServerLink.agentId, agentId));
  return rows.map((row) => row.id);
}

// A value of a server in the runtime policy: a literal, or the id of a secret, whose value
// the runner reads from agentMcpSecrets.
export type RuntimeMcpValue = { name: string; value: string } | { name: string; secret: number };

export interface RuntimeMcpServer {
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env: RuntimeMcpValue[];
  headers: RuntimeMcpValue[];
}

function runtimeValues(value: unknown): RuntimeMcpValue[] {
  return stored(value).map((entry) =>
    entry.credentialId === undefined
      ? { name: entry.name, value: entry.value ?? '' }
      : { name: entry.name, secret: entry.credentialId },
  );
}

export async function agentRuntimeMcpServers(agentId: number): Promise<RuntimeMcpServer[]> {
  return (await linkedRecords(agentId)).map((row) => ({
    name: row.name,
    transport: row.transport as McpTransport,
    command: row.command,
    args: Array.isArray(row.args) ? (row.args as string[]) : [],
    url: row.url,
    env: runtimeValues(row.env),
    headers: runtimeValues(row.headers),
  }));
}

// The names of the agent's MCP servers that reference each secret, by secret id.
export async function mcpSecretServers(agentId: number): Promise<Map<number, string[]>> {
  const servers = new Map<number, string[]>();
  for (const row of await linkedRecords(agentId)) {
    for (const entry of [...stored(row.env), ...stored(row.headers)]) {
      if (entry.credentialId === undefined) continue;
      const names = servers.get(entry.credentialId) ?? [];
      if (!names.includes(row.name)) servers.set(entry.credentialId, [...names, row.name]);
    }
  }
  return servers;
}

// The values of the secrets the agent's MCP servers reference, by secret id. A secret
// deleted since is left out.
export async function agentMcpSecrets(
  agentId: number,
  teamId: number,
): Promise<Record<string, string>> {
  const ids = [...(await mcpSecretServers(agentId)).keys()];
  if (ids.length === 0) return {};
  const rows = await db
    .select({
      id: integrationCredential.id,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, teamId),
        teamSecret,
        inArray(integrationCredential.id, ids),
      ),
    );
  return Object.fromEntries(
    rows.map((row) => [
      String(row.id),
      String((JSON.parse(decryptSecret(row)) as { value: unknown }).value),
    ]),
  );
}
