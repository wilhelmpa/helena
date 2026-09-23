import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import {
  agentEgressEvent,
  agentRun,
  aiAgent,
  db,
  project,
  projectMember,
  projectSetting,
  user as users,
} from '@repo/db';
import { and, asc, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { getProjectSetting, setProjectSetting } from '#shared/project-settings';
import { HOME_SLUG, projectSlug } from '#shared/agent-socket';
import { isHomeAgent } from '#modules/agents/core/home-agent';
import {
  AGENT_NETWORK_MODES,
  DEFAULT_AGENT_NETWORK,
  EGRESS_REASONS,
  MAX_DOMAINS,
  MAX_DOMAIN_LENGTH,
  type AgentNetworkMode,
  type AgentNetworkSettings,
} from './model';

const SETTING_KEY = 'agent_network';
// Events older than this are deleted when a report arrives, at most once an hour.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// A host the lists name: a domain in its ASCII form, without a trailing dot, or an IP
// literal. A leading `*.` is dropped, because a domain covers its subdomains anyway. Null
// for anything else.
export function normalizeHost(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (host.startsWith('*.')) host = host.slice(2);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || host.length > MAX_DOMAIN_LENGTH) return null;
  if (isIP(host)) return host;
  const ascii = domainToASCII(host);
  if (!ascii || ascii.length > MAX_DOMAIN_LENGTH) return null;
  const labels = ascii.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  // A top-level domain is never all digits; this keeps 1.2.3 from passing as a name.
  if (/^\d+$/.test(labels[labels.length - 1])) return null;
  return ascii;
}

function normalizeList(values: string[], field: string): string[] {
  const hosts: string[] = [];
  for (const value of values) {
    const host = normalizeHost(value);
    if (!host)
      throw new HttpError(400, `${field} contains an invalid domain: ${value.slice(0, 80)}`);
    if (!hosts.includes(host)) hosts.push(host);
  }
  if (hosts.length > MAX_DOMAINS) throw new HttpError(400, `${field} has too many domains`);
  return hosts.sort();
}

function isMode(value: unknown): value is AgentNetworkMode {
  return AGENT_NETWORK_MODES.includes(value as AgentNetworkMode);
}

// A stored value that no longer validates (edited by hand, or from an older version) is
// read as far as it still makes sense, never thrown at the reader.
function sanitize(value: unknown): AgentNetworkSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AGENT_NETWORK, agents: {} };
  const stored = value as Partial<Record<keyof AgentNetworkSettings, unknown>>;
  const list = (items: unknown) =>
    (Array.isArray(items) ? items : [])
      .flatMap((item) => (typeof item === 'string' ? [normalizeHost(item)] : []))
      .filter((item): item is string => item !== null)
      .slice(0, MAX_DOMAINS);
  const agents: Record<string, AgentNetworkMode> = {};
  if (stored.agents && typeof stored.agents === 'object' && !Array.isArray(stored.agents)) {
    for (const [id, mode] of Object.entries(stored.agents)) {
      if (/^[1-9][0-9]{0,9}$/.test(id) && isMode(mode)) agents[id] = mode;
    }
  }
  return {
    mode: isMode(stored.mode) ? stored.mode : DEFAULT_AGENT_NETWORK.mode,
    allow: list(stored.allow),
    deny: list(stored.deny),
    mailPorts: stored.mailPorts === true,
    agents,
  };
}

// The agents of a project, the Home agent left out: it runs as Home, never in a project.
async function projectAgents(projectId: number) {
  const rows = await db
    .select({ id: aiAgent.id, username: aiAgent.username, name: users.name })
    .from(projectMember)
    .innerJoin(aiAgent, eq(aiAgent.userId, projectMember.userId))
    .innerJoin(users, eq(users.id, aiAgent.userId))
    .where(eq(projectMember.projectId, projectId))
    .orderBy(asc(users.name));
  return rows.filter((row) => !isHomeAgent(row.username));
}

export async function getAgentNetwork(projectId: number): Promise<AgentNetworkSettings> {
  return sanitize(await getProjectSetting(projectId, SETTING_KEY));
}

// The settings with every agent of the project and the mode of its own, for the settings
// page. An override of an agent that left the project is not shown and no longer applies.
export async function getAgentNetworkView(projectId: number) {
  const settings = await getAgentNetwork(projectId);
  const agents = await projectAgents(projectId);
  return {
    ...settings,
    agents: agents.map((agent) => ({ ...agent, mode: settings.agents[String(agent.id)] ?? null })),
  };
}

export interface AgentNetworkPatch {
  mode?: AgentNetworkMode;
  allow?: string[];
  deny?: string[];
  mailPorts?: boolean;
  agents?: Record<string, AgentNetworkMode | null>;
}

// The egress proxy reads these settings, so an agent may never change them for itself:
// a key of an agent is refused even when its role could edit the project's agents.
export async function setAgentNetwork(
  projectId: number,
  callerId: string,
  patch: AgentNetworkPatch,
) {
  const [agent] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(eq(aiAgent.userId, callerId));
  if (agent) throw new HttpError(403, "An agent cannot change the agents' network access");
  const current = await getAgentNetwork(projectId);
  const members = new Set((await projectAgents(projectId)).map((row) => String(row.id)));
  const agents = Object.fromEntries(
    Object.entries(current.agents).filter(([id]) => members.has(id)),
  ) as Record<string, AgentNetworkMode>;
  for (const [id, mode] of Object.entries(patch.agents ?? {})) {
    if (!members.has(id)) throw new HttpError(400, `Agent ${id} is not an agent of this project`);
    if (mode === null) delete agents[id];
    else agents[id] = mode;
  }
  const next: AgentNetworkSettings = {
    mode: patch.mode ?? current.mode,
    allow: patch.allow ? normalizeList(patch.allow, 'allow') : current.allow,
    deny: patch.deny ? normalizeList(patch.deny, 'deny') : current.deny,
    mailPorts: patch.mailPorts ?? current.mailPorts,
    agents,
  };
  await setProjectSetting(projectId, SETTING_KEY, next);
  return getAgentNetworkView(projectId);
}

export async function listAgentNetworkEvents(
  projectId: number,
  query: { limit?: number; before?: number; runId?: number; decision?: 'allowed' | 'blocked' },
) {
  const limit = query.limit ?? 50;
  const conditions: SQL[] = [eq(agentEgressEvent.projectId, projectId)];
  if (query.before) conditions.push(lt(agentEgressEvent.id, query.before));
  if (query.runId) conditions.push(eq(agentEgressEvent.runId, query.runId));
  if (query.decision) conditions.push(eq(agentEgressEvent.decision, query.decision));
  const rows = await db
    .select({
      id: agentEgressEvent.id,
      host: agentEgressEvent.host,
      port: agentEgressEvent.port,
      decision: agentEgressEvent.decision,
      reason: agentEgressEvent.reason,
      connections: agentEgressEvent.connections,
      bytesOut: agentEgressEvent.bytesOut,
      bytesIn: agentEgressEvent.bytesIn,
      firstAt: agentEgressEvent.firstAt,
      lastAt: agentEgressEvent.lastAt,
      runId: agentEgressEvent.runId,
      agentId: aiAgent.id,
      agentUsername: aiAgent.username,
      agentName: users.name,
    })
    .from(agentEgressEvent)
    .leftJoin(aiAgent, eq(aiAgent.id, agentEgressEvent.agentId))
    .leftJoin(users, eq(users.id, aiAgent.userId))
    .where(and(...conditions))
    .orderBy(desc(agentEgressEvent.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      host: row.host,
      port: row.port,
      decision: row.decision as 'allowed' | 'blocked',
      reason: row.reason,
      connections: row.connections,
      bytesOut: row.bytesOut,
      bytesIn: row.bytesIn,
      firstAt: row.firstAt.toISOString(),
      lastAt: row.lastAt.toISOString(),
      runId: row.runId,
      agent:
        row.agentId !== null
          ? { id: row.agentId, username: row.agentUsername ?? '', name: row.agentName ?? '' }
          : null,
    })),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
  };
}

export interface EgressPolicy extends AgentNetworkSettings {
  projectId: number | null;
}

// Every project's settings by slug, for the egress proxy. Home is the Home agent's, which
// works in no project: it gets the default.
export async function egressPolicies(): Promise<Record<string, EgressPolicy>> {
  const rows = await db
    .select({ id: project.id, key: project.key, value: projectSetting.value })
    .from(project)
    .leftJoin(
      projectSetting,
      and(eq(projectSetting.projectId, project.id), eq(projectSetting.key, SETTING_KEY)),
    );
  const policies: Record<string, EgressPolicy> = {
    [HOME_SLUG]: { projectId: null, ...DEFAULT_AGENT_NETWORK, agents: {} },
  };
  for (const row of rows) {
    const slug = projectSlug(row.key);
    if (slug === HOME_SLUG) continue;
    policies[slug] = { projectId: row.id, ...sanitize(row.value) };
  }
  return policies;
}

export interface EgressEventInput {
  slug: string;
  agentId: number | null;
  runId: number | null;
  host: string;
  port: number;
  decision: 'allowed' | 'blocked';
  reason: string | null;
  connections: number;
  bytesOut: number;
  bytesIn: number;
  firstAt: string;
  lastAt: string;
}

const MAX_REPORT = 500;
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;

function positiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function count(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

// The proxy's report, or null when it is not one. Each entry sums the connections of one
// unit to one destination with one decision since the previous report.
export function parseEgressEvents(body: unknown): EgressEventInput[] | null {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length > MAX_REPORT) return null;
  const parsed: EgressEventInput[] = [];
  for (const entry of events) {
    if (!entry || typeof entry !== 'object') return null;
    const event = entry as Record<string, unknown>;
    if (
      typeof event.slug !== 'string' ||
      !SLUG.test(event.slug) ||
      (event.agentId !== null && !positiveInt(event.agentId)) ||
      (event.runId !== null && !positiveInt(event.runId)) ||
      typeof event.host !== 'string' ||
      event.host.length < 1 ||
      event.host.length > 255 ||
      !count(event.port, 65535) ||
      (event.decision !== 'allowed' && event.decision !== 'blocked') ||
      (event.reason !== null &&
        !EGRESS_REASONS.includes(event.reason as (typeof EGRESS_REASONS)[number])) ||
      !positiveInt(event.connections) ||
      !count(event.bytesOut) ||
      !count(event.bytesIn) ||
      !timestamp(event.firstAt) ||
      !timestamp(event.lastAt)
    ) {
      return null;
    }
    parsed.push({
      slug: event.slug,
      agentId: event.agentId as number | null,
      runId: event.runId as number | null,
      host: event.host,
      port: event.port as number,
      decision: event.decision,
      reason: event.reason as string | null,
      connections: event.connections as number,
      bytesOut: event.bytesOut as number,
      bytesIn: event.bytesIn as number,
      firstAt: event.firstAt as string,
      lastAt: event.lastAt as string,
    });
  }
  return parsed;
}

let prunedAt = 0;

// Stores the proxy's report. The proxy names the unit's agent and run as the runner asked
// the launcher to start it; an agent or a run that does not belong to the project the
// connection came from is dropped from the entry rather than trusted.
export async function recordEgressEvents(events: EgressEventInput[]): Promise<number> {
  if (events.length === 0) return 0;
  const projects = await db.select({ id: project.id, key: project.key }).from(project);
  const projectBySlug = new Map(projects.map((row) => [projectSlug(row.key), row.id]));
  const agentIds = [...new Set(events.flatMap((event) => (event.agentId ? [event.agentId] : [])))];
  const runIds = [...new Set(events.flatMap((event) => (event.runId ? [event.runId] : [])))];
  const agents = agentIds.length
    ? await db
        .select({ id: aiAgent.id, userId: aiAgent.userId, username: aiAgent.username })
        .from(aiAgent)
        .where(inArray(aiAgent.id, agentIds))
    : [];
  const memberships = agents.length
    ? await db
        .select({ userId: projectMember.userId, projectId: projectMember.projectId })
        .from(projectMember)
        .where(
          inArray(
            projectMember.userId,
            agents.map((agent) => agent.userId),
          ),
        )
    : [];
  const runs = runIds.length
    ? await db
        .select({ id: agentRun.id, projectId: agentRun.projectId, agentId: agentRun.agentId })
        .from(agentRun)
        .where(inArray(agentRun.id, runIds))
    : [];

  const rows = events.flatMap((event) => {
    const projectId = event.slug === HOME_SLUG ? null : (projectBySlug.get(event.slug) ?? null);
    if (event.slug !== HOME_SLUG && projectId === null) return [];
    const agent = agents.find((candidate) => candidate.id === event.agentId);
    const agentFits =
      agent !== undefined &&
      (event.slug === HOME_SLUG
        ? isHomeAgent(agent.username)
        : memberships.some((row) => row.userId === agent.userId && row.projectId === projectId));
    const run = runs.find((candidate) => candidate.id === event.runId);
    const runFits =
      run !== undefined &&
      (projectId === null || run.projectId === projectId) &&
      (!agentFits || run.agentId === event.agentId);
    const firstAt = new Date(event.firstAt);
    const lastAt = new Date(event.lastAt);
    if (Number.isNaN(firstAt.getTime()) || Number.isNaN(lastAt.getTime())) return [];
    return [
      {
        slug: event.slug,
        projectId,
        agentId: agentFits ? event.agentId : null,
        runId: runFits ? event.runId : null,
        host: event.host.toLowerCase().slice(0, 255),
        port: event.port,
        decision: event.decision,
        reason: event.reason,
        connections: event.connections,
        bytesOut: event.bytesOut,
        bytesIn: event.bytesIn,
        firstAt,
        lastAt,
      },
    ];
  });
  if (rows.length > 0) await db.insert(agentEgressEvent).values(rows);
  if (Date.now() - prunedAt > PRUNE_EVERY_MS) {
    prunedAt = Date.now();
    await db
      .delete(agentEgressEvent)
      .where(lt(agentEgressEvent.lastAt, new Date(Date.now() - RETENTION_MS)));
  }
  return rows.length;
}
