import { and, eq, inArray, or } from 'drizzle-orm';
import type { CredentialField, LocalizedText } from '@helena/sdk';
import {
  agentTool,
  agentToolLink,
  aiAgent,
  db,
  integrationCredential,
  integrationCredentialGrant,
  project,
  projectMember,
} from '@repo/db';
import { HttpError } from '#shared/lib';
import { host, registries } from '#shared/helena';
import { updateCredential } from '#modules/agents/integrations/service';

// A project's extensions (Projekt › Einstellungen › Erweiterungen): the settings a plugin
// brings for this project, read from the plugin's own connectors, never named here. A
// connector's credential belongs to the project when it is limited to the project, granted
// to the project or to one of its agents, or bound to one of its agents as a configured
// tool. Its non-secret fields (limits, switches, lists) are shown and saved here; its secret
// fields only say whether they are set, and stay as they are: a secret changes in Zugänge.

export interface ExtensionField {
  key: string;
  label: LocalizedText;
  type: CredentialField['type'];
  required: boolean;
  placeholder: string | null;
  help: LocalizedText | null;
}

export interface ExtensionConnection {
  id: number;
  label: string | null;
  // The non-secret fields as stored.
  values: Record<string, string | number | boolean>;
  // For each secret field: whether it holds a value. Never the value.
  secrets: Record<string, boolean>;
}

export interface ExtensionConnector {
  id: string;
  label: LocalizedText;
  description: LocalizedText | null;
  fields: ExtensionField[];
  connections: ExtensionConnection[];
}

export interface ProjectExtension {
  id: string;
  name: LocalizedText;
  version: string;
  status: string;
  connectors: ExtensionConnector[];
}

type Project = { id: number; teamId: number };

// The ids of the team's credentials that belong to the project (see above).
async function projectCredentialIds(target: Project): Promise<Set<number>> {
  const agents = db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .where(and(eq(aiAgent.teamId, target.teamId), eq(projectMember.projectId, target.id)));
  const [own, granted, bound] = await Promise.all([
    db
      .select({ id: integrationCredential.id })
      .from(integrationCredential)
      .where(
        and(
          eq(integrationCredential.teamId, target.teamId),
          eq(integrationCredential.projectId, target.id),
        ),
      ),
    db
      .select({ id: integrationCredentialGrant.credentialId })
      .from(integrationCredentialGrant)
      .innerJoin(
        integrationCredential,
        eq(integrationCredential.id, integrationCredentialGrant.credentialId),
      )
      .where(
        and(
          eq(integrationCredential.teamId, target.teamId),
          or(
            eq(integrationCredentialGrant.projectId, target.id),
            inArray(integrationCredentialGrant.agentId, agents),
          ),
        ),
      ),
    db
      .select({ id: agentTool.credentialId })
      .from(agentToolLink)
      .innerJoin(agentTool, eq(agentTool.id, agentToolLink.agentToolId))
      .where(and(eq(agentTool.teamId, target.teamId), inArray(agentToolLink.agentId, agents))),
  ]);
  return new Set([...own, ...granted, ...bound].map((row) => row.id));
}

function connectionOf(
  fields: CredentialField[],
  row: { id: number; label: string | null; redacted: unknown },
): ExtensionConnection {
  const stored =
    row.redacted && typeof row.redacted === 'object'
      ? (row.redacted as Record<string, unknown>)
      : {};
  const values: ExtensionConnection['values'] = {};
  const secrets: ExtensionConnection['secrets'] = {};
  for (const field of fields) {
    const value = stored[field.key];
    if (field.type === 'secret') {
      secrets[field.key] = value !== undefined && value !== null && value !== '';
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      values[field.key] = value;
    }
  }
  return { id: row.id, label: row.label, values, secrets };
}

// The extensions with settings for this project, by plugin, in the order plugins loaded.
export async function projectExtensions(target: Project): Promise<ProjectExtension[]> {
  const ids = [...(await projectCredentialIds(target))];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: integrationCredential.id,
      integrationKey: integrationCredential.integrationKey,
      label: integrationCredential.label,
      redacted: integrationCredential.redacted,
    })
    .from(integrationCredential)
    .where(inArray(integrationCredential.id, ids))
    .orderBy(integrationCredential.id);

  const byPlugin = new Map<string, Map<string, ExtensionConnector>>();
  for (const row of rows) {
    const connector = registries.connectors.get(row.integrationKey);
    const pluginId = registries.connectors.pluginOf(row.integrationKey);
    if (!connector || !pluginId) continue;
    const connectors = byPlugin.get(pluginId) ?? new Map<string, ExtensionConnector>();
    byPlugin.set(pluginId, connectors);
    const entry = connectors.get(connector.id) ?? {
      id: connector.id,
      label: connector.label,
      description: connector.description ?? null,
      fields: connector.credentialSchema.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        placeholder: field.placeholder ?? null,
        help: field.help ?? null,
      })),
      connections: [],
    };
    connectors.set(connector.id, entry);
    entry.connections.push(connectionOf(connector.credentialSchema, row));
  }

  return host
    .list()
    .filter((plugin) => byPlugin.has(plugin.manifest.id))
    .map((plugin) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      status: plugin.status,
      connectors: [...byPlugin.get(plugin.manifest.id)!.values()],
    }));
}

// Saves the non-secret fields of one of the project's connections. A secret field in the
// patch is refused rather than silently dropped: it changes in Zugänge, where the owner
// sees what he replaces. Fields left out keep their value (updateCredential merges).
export async function updateProjectExtension(
  target: Project,
  credentialId: number,
  values: Record<string, unknown>,
): Promise<ExtensionConnection> {
  if (!(await projectCredentialIds(target)).has(credentialId))
    throw new HttpError(404, 'Connection not found in this project');
  const [row] = await db
    .select({ integrationKey: integrationCredential.integrationKey })
    .from(integrationCredential)
    .where(eq(integrationCredential.id, credentialId));
  const connector = row ? registries.connectors.get(row.integrationKey) : undefined;
  if (!row || !connector) throw new HttpError(404, 'Connection not found in this project');
  const fields = new Map(connector.credentialSchema.map((field) => [field.key, field]));
  for (const key of Object.keys(values)) {
    const field = fields.get(key);
    if (!field) throw new HttpError(400, `Unknown setting: ${key}`);
    if (field.type === 'secret')
      throw new HttpError(400, `${key} is a secret and changes in Zugänge`);
  }
  const updated = await updateCredential(credentialId, target.teamId, { credential: values });
  if (!updated) throw new HttpError(404, 'Connection not found in this project');
  return connectionOf(connector.credentialSchema, updated);
}

// For Helena › Einstellungen › Erweiterungen: the projects each plugin has settings in.
export async function extensionProjects(): Promise<
  Record<string, { key: string; name: string }[]>
> {
  const projects = await db
    .select({ id: project.id, teamId: project.teamId, key: project.key, name: project.name })
    .from(project)
    .orderBy(project.name);
  const out: Record<string, { key: string; name: string }[]> = {};
  for (const entry of projects) {
    for (const extension of await projectExtensions(entry)) {
      (out[extension.id] ??= []).push({ key: entry.key, name: entry.name });
    }
  }
  return out;
}
