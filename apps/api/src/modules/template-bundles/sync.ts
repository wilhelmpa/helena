// Moves a Helena template bundle (@helena/sdk TemplateBundle) into a team and reads one
// back out, over Helena's own HTTP API, never the database. Runs in the API (the
// template-bundles routes, with the caller's own credential), in Bun (with an API key,
// scripts/) and in a signed-in browser tab (with the session), so it holds no file
// system code and no API internals.
//
// Import is idempotent: it reads first and writes only what is missing. A template,
// skill or MCP server that exists but differs from the bundle is reported as drift and
// left alone (the owner may have tuned it in Helena); `update` writes the bundle over
// it. Skills and MCP servers are only ever added to an agent, never removed.

import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  type BundleAgent,
  type BundleMcpServer,
  type BundleSkill,
  type TemplateBundle,
} from '@helena/sdk';

// ---------------------------------------------------------------------------
// Transport and log
// ---------------------------------------------------------------------------

export type Transport = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const jsonHeaders = (body: unknown): Record<string, string> =>
  body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {};
const encode = (body: unknown): string | FormData | undefined =>
  body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body);

// Against the API directly, with a personal API key.
export function keyTransport(baseUrl: string, apiKey: string): Transport {
  const base = baseUrl.replace(/\/+$/, '');
  return (method, path, body) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'x-api-key': apiKey, ...jsonHeaders(body) },
      body: encode(body),
    });
}

// From a signed-in Helena tab, through the web app's /backend proxy and its cookies.
export function sessionTransport(prefix = '/backend'): Transport {
  return (method, path, body) =>
    fetch(`${prefix}${path}`, {
      method,
      credentials: 'include',
      headers: jsonHeaders(body),
      body: encode(body),
    });
}

export class SyncLog {
  readonly lines: string[] = [];
  written = 0;
  unchanged = 0;
  drift = 0;
  warnings = 0;

  constructor(
    readonly send: Transport,
    readonly opts: { dryRun: boolean; update: boolean },
    readonly echo: (line: string) => void = () => {},
  ) {}

  log(line: string): void {
    this.lines.push(line);
    this.echo(line);
  }

  ok(line: string): void {
    this.unchanged += 1;
    this.log(`[OK] ${line}`);
  }

  warn(line: string): void {
    this.warnings += 1;
    this.log(`[WARN] ${line}`);
  }

  // A difference between the bundle and the team. True when it is to be written over.
  differs(line: string): boolean {
    this.drift += 1;
    this.log(
      `[DRIFT] ${line}${this.opts.update ? '' : ' (left as is; update applies the bundle)'}`,
    );
    return this.opts.update;
  }

  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body);
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    if (!text) return undefined as T;
    const parsed = JSON.parse(text) as T;
    // Creating an agent answers with its new API key. It is dropped unread.
    if (parsed && typeof parsed === 'object' && 'apiKey' in parsed) {
      (parsed as { apiKey?: unknown }).apiKey = undefined;
    }
    return parsed;
  }

  // A write, made only outside a dry run. Null in a dry run.
  async write<T>(description: string, fn: () => Promise<T>): Promise<T | null> {
    this.log(`${this.opts.dryRun ? '[DRY-RUN] would' : '[WRITE]'} ${description}`);
    if (this.opts.dryRun) return null;
    const result = await fn();
    this.written += 1;
    return result;
  }

  summary(): string {
    return (
      `${this.written} write(s)${this.opts.dryRun ? ' (dry run: none made)' : ''}, ` +
      `${this.unchanged} unchanged, ${this.drift} drift, ${this.warnings} warning(s).`
    );
  }
}

// ---------------------------------------------------------------------------
// API shapes (the fields read here)
// ---------------------------------------------------------------------------

export interface SkillRow {
  id: number;
  name: string;
  source: 'upload' | 'inline' | 'github';
  sourceUrl: string | null;
  files: { path: string; size: number }[];
}

interface RuntimePolicy {
  reasoningEffort: string | null;
  toolDeny: string[];
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
  [key: string]: unknown;
}

export interface AgentRow {
  id: number;
  name: string;
  username: string;
  template: boolean;
  sourceTemplateId: number | null;
  model: string | null;
  instructions: string | null;
  runtimePolicy: RuntimePolicy;
  triggerOnMention: boolean;
  triggerOnAssign: boolean;
}

export interface OrgAgent {
  id: number;
  username: string;
  template: boolean;
  departmentId: number | null;
  reportsToAgentId: number | null;
  roleTitle: string;
  role: 'coordinator' | 'specialist' | 'reviewer' | null;
  capabilities: string[];
  runtimeAgentId: string | null;
}

export interface Organization {
  departments: { id: number; name: string }[];
  goals: { id: number; title: string }[];
  agents: OrgAgent[];
}

interface McpServerRow {
  id: number;
  name: string;
  description: string;
  transport: 'stdio' | 'http' | 'sse';
  command: string | null;
  args: string[];
  url: string | null;
  env: unknown[];
  headers: unknown[];
}

export const byHandle = <T extends { username: string }>(agents: T[], handle: string) =>
  agents.find((a) => a.username.toLowerCase() === handle.toLowerCase());

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const sorted = (a: readonly string[]) => [...a].sort();

export async function resolveTeam(log: SyncLog, teamId?: number): Promise<number> {
  const teams = await log.api<{ id: number; name: string }[]>('GET', '/teams');
  const team = teamId == null ? teams[0] : teams.find((t) => t.id === teamId);
  if (!team)
    throw new Error(teamId == null ? 'The caller belongs to no team' : `No team ${teamId}`);
  log.log(`Team ${team.id} (${team.name})`);
  return team.id;
}

// ---------------------------------------------------------------------------
// Adding skills and MCP servers to an agent (never removing)
// ---------------------------------------------------------------------------

async function addLinks(
  log: SyncLog,
  what: 'skills' | 'MCP servers',
  agent: { id: number; username: string },
  wanted: readonly string[],
  ids: Map<string, number>,
  read: () => Promise<{ id: number }[]>,
  put: (ids: number[]) => Promise<unknown>,
): Promise<void> {
  if (wanted.length === 0) return;
  const unknown = wanted.filter((name) => !ids.has(name));
  if (unknown.length > 0) {
    if (log.opts.dryRun)
      log.log(
        `[DRY-RUN] @${agent.username} would get ${what} not yet in the team: ${unknown.join(', ')}`,
      );
    else log.warn(`@${agent.username}: ${what} missing in the team: ${unknown.join(', ')}`);
  }
  const current = agent.id > 0 ? await read() : [];
  const have = new Set(current.map((row) => row.id));
  const missing = wanted
    .map((name) => ids.get(name))
    .filter((id): id is number => id != null && !have.has(id));
  if (missing.length === 0) {
    if (unknown.length === 0) log.ok(`@${agent.username} has its ${wanted.length} ${what}`);
    return;
  }
  await log.write(`add ${missing.length} ${what} to @${agent.username}`, () =>
    put([...have, ...missing]),
  );
}

export function addAgentSkills(
  log: SyncLog,
  teamId: number,
  agent: { id: number; username: string },
  wanted: readonly string[],
  skillIds: Map<string, number>,
): Promise<void> {
  return addLinks(
    log,
    'skills',
    agent,
    wanted,
    skillIds,
    () => log.api('GET', `/teams/${teamId}/ai-agents/${agent.id}/skills`),
    (skillIds) => log.api('PUT', `/teams/${teamId}/ai-agents/${agent.id}/skills`, { skillIds }),
  );
}

export function addAgentMcpServers(
  log: SyncLog,
  teamId: number,
  agent: { id: number; username: string },
  wanted: readonly string[],
  serverIds: Map<string, number>,
): Promise<void> {
  return addLinks(
    log,
    'MCP servers',
    agent,
    wanted,
    serverIds,
    () => log.api('GET', `/teams/${teamId}/ai-agents/${agent.id}/mcp-servers`),
    (mcpServerIds) =>
      log.api('PUT', `/teams/${teamId}/ai-agents/${agent.id}/mcp-servers`, { mcpServerIds }),
  );
}

// Name → id of what the team has, for steps that did not run the import.
export async function teamSkillIds(log: SyncLog, teamId: number): Promise<Map<string, number>> {
  const rows = await log.api<SkillRow[]>('GET', `/teams/${teamId}/agent-skills/options`);
  return new Map(rows.map((row) => [row.name, row.id]));
}

export async function teamMcpServerIds(log: SyncLog, teamId: number): Promise<Map<string, number>> {
  const rows = await log.api<McpServerRow[]>('GET', `/teams/${teamId}/mcp-servers`);
  return new Map(rows.map((row) => [row.name, row.id]));
}

// ---------------------------------------------------------------------------
// Import: skills
// ---------------------------------------------------------------------------

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Helena reads GitHub through jsDelivr, which now and then answers with a 5xx.
      const transient = err instanceof Error && / -> 50[234]:/.test(err.message);
      if (!transient || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

function referenceUpload(path: string, content: string): FormData {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/markdown' }), path.split('/').pop()!);
  return form;
}

async function importGithubSkill(
  log: SyncLog,
  teamId: number,
  library: SkillRow[],
  skill: BundleSkill & { source: { type: 'github' } },
): Promise<number | null> {
  const byUrl = library.find((row) => row.sourceUrl === skill.source.url);
  if (byUrl) {
    log.ok(`skill "${byUrl.name}" (${skill.license})`);
    return byUrl.id;
  }
  const byName = library.find((row) => row.name.toLowerCase() === skill.name.toLowerCase());
  if (byName) {
    log.warn(
      `skill "${skill.name}" exists from ${byName.sourceUrl ?? byName.source}; kept as it is`,
    );
    return byName.id;
  }
  const created = await log.write(
    `import skill "${skill.name}" from ${skill.source.url} (${skill.license})`,
    () =>
      retry(() =>
        log.api<SkillRow>('POST', `/teams/${teamId}/agent-skills`, {
          source: 'github',
          sourceUrl: skill.source.url,
        }),
      ),
  );
  if (!created) return null;
  if (created.name !== skill.name)
    log.warn(`${skill.source.url} is named "${created.name}", the bundle says "${skill.name}"`);
  library.push(created);
  return created.id;
}

// A skill carried as files: SKILL.md becomes an inline skill, each refs/<file>.md an
// uploaded reference, which Helena keeps as refs/<file>.
async function importFileSkill(
  log: SyncLog,
  teamId: number,
  library: SkillRow[],
  skill: BundleSkill & { source: { type: 'files' } },
): Promise<number | null> {
  const files = skill.source.files;
  const found = library.find((row) => row.name.toLowerCase() === skill.name.toLowerCase());
  let row = found ?? null;
  if (!found) {
    row = await log.write(`create skill "${skill.name}" from the bundle's files`, () =>
      log.api<SkillRow>('POST', `/teams/${teamId}/agent-skills`, {
        source: 'inline',
        markdown: files['SKILL.md'],
      }),
    );
    if (!row) return null;
    library.push(row);
  } else if (found.source === 'github') {
    log.warn(
      `skill "${skill.name}" is a GitHub import in the team; the bundle's files are not applied`,
    );
    return found.id;
  } else {
    const { markdown } = await log.api<{ markdown: string }>(
      'GET',
      `/teams/${teamId}/agent-skills/${found.id}/markdown`,
    );
    if (markdown === files['SKILL.md']) log.ok(`skill "${skill.name}" (files)`);
    else if (log.differs(`skill "${skill.name}": SKILL.md differs from the bundle`)) {
      await log.write(`update SKILL.md of "${skill.name}"`, () =>
        log.api('PATCH', `/teams/${teamId}/agent-skills/${found.id}`, {
          markdown: files['SKILL.md'],
        }),
      );
    }
  }
  const target = row!;
  for (const [path, content] of Object.entries(files)) {
    if (path === 'SKILL.md') continue;
    if (!target.files.some((file) => file.path === path)) {
      await log.write(`add ${path} to "${skill.name}"`, () =>
        log.api(
          'POST',
          `/teams/${teamId}/agent-skills/${target.id}/references`,
          referenceUpload(path, content),
        ),
      );
      continue;
    }
    const { content: live } = await log.api<{ content: string }>(
      'GET',
      `/teams/${teamId}/agent-skills/${target.id}/references/content?path=${encodeURIComponent(path)}`,
    );
    if (live === content) log.ok(`${path} of "${skill.name}"`);
    else if (log.differs(`${path} of "${skill.name}" differs from the bundle`)) {
      await log.write(`update ${path} of "${skill.name}"`, () =>
        log.api('PATCH', `/teams/${teamId}/agent-skills/${target.id}/references/content`, {
          path,
          content,
        }),
      );
    }
  }
  return target.id;
}

async function importSkills(
  log: SyncLog,
  teamId: number,
  skills: BundleSkill[],
): Promise<Map<string, number>> {
  const library = await log.api<SkillRow[]>('GET', `/teams/${teamId}/agent-skills/options`);
  const ids = new Map<string, number>();
  for (const skill of skills) {
    try {
      const id =
        skill.source.type === 'github'
          ? await importGithubSkill(
              log,
              teamId,
              library,
              skill as BundleSkill & { source: { type: 'github' } },
            )
          : await importFileSkill(
              log,
              teamId,
              library,
              skill as BundleSkill & { source: { type: 'files' } },
            );
      if (id != null) ids.set(skill.name, id);
    } catch (err) {
      log.warn(
        `skill "${skill.name}" not imported: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Import: MCP servers
// ---------------------------------------------------------------------------

function mcpBody(name: string, server: BundleMcpServer) {
  return {
    name,
    description: server.description ?? '',
    transport: server.type,
    command: server.type === 'stdio' ? (server.command ?? null) : null,
    args: server.args ?? [],
    url: server.type === 'stdio' ? null : (server.url ?? null),
  };
}

async function importMcpServers(
  log: SyncLog,
  teamId: number,
  servers: Record<string, BundleMcpServer>,
): Promise<Map<string, number>> {
  const rows = await log.api<McpServerRow[]>('GET', `/teams/${teamId}/mcp-servers`);
  const ids = new Map(rows.map((row) => [row.name, row.id]));
  for (const [name, server] of Object.entries(servers)) {
    const body = mcpBody(name, server);
    const found = rows.find((row) => row.name === name);
    if (!found) {
      const created = await log.write(
        `add MCP server "${name}" (${server.type}${server.command ? `: ${server.command} ${(server.args ?? []).join(' ')}` : ''})`,
        () => log.api<McpServerRow>('POST', `/teams/${teamId}/mcp-servers`, body),
      );
      if (created) ids.set(name, created.id);
      continue;
    }
    const same =
      found.transport === body.transport &&
      (found.command ?? null) === body.command &&
      sameList(found.args, body.args) &&
      (found.url ?? null) === body.url;
    if (same) log.ok(`MCP server "${name}"`);
    else if (log.differs(`MCP server "${name}" is set up differently in the team`)) {
      await log.write(`update MCP server "${name}"`, () =>
        log.api('PATCH', `/teams/${teamId}/mcp-servers/${found.id}`, body),
      );
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Import: agent templates
// ---------------------------------------------------------------------------

function policyFor(agent: BundleAgent, current?: RuntimePolicy): RuntimePolicy {
  const next: RuntimePolicy = {
    ...(current ?? { toolAllow: [], mcpGrants: [], files: [] }),
    reasoningEffort: agent.effort,
    toolDeny: [...agent.disallowedTools],
    // A newly imported template writes memory directly; preserve an existing opt-in.
    memoryApproval: current?.memoryApproval === true,
  };
  if (agent.maxTurns != null) next.maxTurns = agent.maxTurns;
  else delete next.maxTurns;
  if (agent.helena.runBudgetSeconds != null) next.runBudgetSeconds = agent.helena.runBudgetSeconds;
  else delete next.runBudgetSeconds;
  return next;
}

function templateDrift(agent: BundleAgent, row: AgentRow): string[] {
  const out: string[] = [];
  const policy = row.runtimePolicy;
  if (row.name !== agent.helena.displayName) out.push(`name "${row.name}"`);
  if ((row.instructions ?? '').trim() !== agent.instructions.trim()) out.push('instructions');
  if (row.model !== agent.model) out.push(`model ${row.model ?? 'default'}`);
  if (policy.reasoningEffort !== agent.effort)
    out.push(`effort ${policy.reasoningEffort ?? 'default'}`);
  if (!sameList(sorted(policy.toolDeny), sorted(agent.disallowedTools)))
    out.push('disallowed tools');
  if ((policy.maxTurns ?? null) !== agent.maxTurns) out.push('max turns');
  if ((policy.runBudgetSeconds ?? null) !== agent.helena.runBudgetSeconds) out.push('run budget');
  if (
    row.triggerOnMention !== agent.helena.triggers.mention ||
    row.triggerOnAssign !== agent.helena.triggers.assign
  )
    out.push('triggers');
  return out;
}

async function importAssignment(
  log: SyncLog,
  teamId: number,
  agentId: number,
  agent: BundleAgent,
  org: OrgAgent | undefined,
): Promise<void> {
  const body = {
    departmentId: org?.departmentId ?? null,
    reportsToAgentId: null,
    runtimeAgentId: null,
    role: 'specialist' as const,
    roleTitle: agent.helena.roleTitle,
    capabilities: [...agent.helena.capabilities],
  };
  const label = `role "${agent.helena.roleTitle}" and capabilities [${agent.helena.capabilities.join(', ')}] of @${agent.name}`;
  if (!org?.role) {
    await log.write(`set ${label}`, () =>
      log.api('PUT', `/teams/${teamId}/organization/agents/${agentId}`, body),
    );
    return;
  }
  const same =
    org.role === 'specialist' &&
    org.roleTitle === agent.helena.roleTitle &&
    sameList(org.capabilities, agent.helena.capabilities);
  if (same) log.ok(`${label}`);
  else if (
    log.differs(`@${agent.name}: role "${org.roleTitle}" [${org.capabilities.join(', ')}]`)
  ) {
    await log.write(`set ${label}`, () =>
      log.api('PUT', `/teams/${teamId}/organization/agents/${agentId}`, body),
    );
  }
}

async function importAgent(
  log: SyncLog,
  teamId: number,
  agent: BundleAgent,
  agents: AgentRow[],
  org: Organization,
  skillIds: Map<string, number>,
  serverIds: Map<string, number>,
): Promise<void> {
  const found = byHandle(agents, agent.name);
  if (found && !found.template) {
    log.warn(`@${agent.name} exists and is not a template; a working agent is left alone`);
    return;
  }
  let row: { id: number; username: string };
  if (!found) {
    const created = await log.write(
      `create template @${agent.name} "${agent.helena.displayName}" (${agent.model ?? 'default model'}, effort ${agent.effort ?? 'default'})`,
      () =>
        log.api<{ agent: AgentRow }>('POST', `/teams/${teamId}/ai-agents`, {
          name: agent.helena.displayName,
          username: agent.name,
          kind: 'external',
          template: true,
          instructions: agent.instructions,
          model: agent.model,
          runtimePolicy: policyFor(agent),
          triggerOnMention: agent.helena.triggers.mention,
          triggerOnAssign: agent.helena.triggers.assign,
          runnerScope: 'team',
        }),
    );
    row = created ? created.agent : { id: -1, username: agent.name };
  } else {
    row = found;
    const drift = templateDrift(agent, found);
    if (drift.length === 0) log.ok(`template @${agent.name}`);
    else if (log.differs(`template @${agent.name}: ${drift.join(', ')}`)) {
      await log.write(`update template @${agent.name} (${drift.join(', ')})`, () =>
        log.api('PATCH', `/teams/${teamId}/ai-agents/${found.id}`, {
          name: agent.helena.displayName,
          instructions: agent.instructions,
          model: agent.model,
          runtimePolicy: policyFor(agent, found.runtimePolicy),
          triggerOnMention: agent.helena.triggers.mention,
          triggerOnAssign: agent.helena.triggers.assign,
        }),
      );
    }
  }
  if (row.id < 0) {
    log.log(
      `[DRY-RUN] would set role "${agent.helena.roleTitle}", ${agent.skills.length} skill(s) and ` +
        `${agent.mcpServers.length} MCP server(s) on @${agent.name}`,
    );
    return;
  }
  const rowId = row.id;
  await importAssignment(
    log,
    teamId,
    rowId,
    agent,
    org.agents.find((a) => a.id === rowId),
  );
  await addAgentSkills(log, teamId, row, agent.skills, skillIds);
  await addAgentMcpServers(log, teamId, row, agent.mcpServers, serverIds);
}

// Makes the team hold everything the bundle describes.
export async function importBundle(
  log: SyncLog,
  teamId: number,
  bundle: TemplateBundle,
  options: { skipAgents?: boolean } = {},
): Promise<{ skillIds: Map<string, number>; serverIds: Map<string, number> }> {
  log.log(`\n== Bundle ${bundle.name} ${bundle.version}: skills ==`);
  const skillIds = await importSkills(log, teamId, bundle.skills);
  log.log('\n== MCP servers ==');
  const serverIds = await importMcpServers(log, teamId, bundle.mcpServers);
  if (options.skipAgents) return { skillIds, serverIds };
  log.log('\n== Agent templates ==');
  const agents = await log.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  const org = await log.api<Organization>('GET', `/teams/${teamId}/organization`);
  // A capability must stay unique among the team's templates, including those that
  // come from elsewhere.
  const inBundle = new Set(bundle.agents.map((agent) => agent.name.toLowerCase()));
  for (const other of org.agents.filter(
    (a) => a.template && !inBundle.has(a.username.toLowerCase()),
  )) {
    for (const agent of bundle.agents) {
      const shared = agent.helena.capabilities.filter((c) => other.capabilities.includes(c));
      if (shared.length > 0)
        log.warn(`@${agent.name} shares [${shared.join(', ')}] with @${other.username}`);
    }
  }
  for (const agent of bundle.agents) {
    await importAgent(log, teamId, agent, agents, org, skillIds, serverIds);
  }
  return { skillIds, serverIds };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportOptions {
  productName?: string;
  // Which templates, by handle; all of the team's templates when omitted.
  agents?: string[];
  workingAgents?: boolean;
  extraSkills?: string[];
  includeMcpServers?: boolean;
  // A bundle that already describes some of them: its metadata, descriptions,
  // licenses and attributions are reused (the team does not store them).
  known?: TemplateBundle;
  name?: string;
  displayName?: string;
  version?: string;
  description?: string;
  license?: string;
  author?: { name: string; url?: string };
}

async function exportSkill(
  log: SyncLog,
  teamId: number,
  row: SkillRow,
  meta: { license: string; author: string },
  known: Map<string, BundleSkill>,
): Promise<BundleSkill> {
  const knownSkill = known.get(row.name);
  if (row.source === 'github' && row.sourceUrl) {
    const repo = /github\.com\/([^/]+\/[^/]+)/.exec(row.sourceUrl)?.[1] ?? row.sourceUrl;
    if (!knownSkill) log.warn(`skill "${row.name}": license unknown, check ${row.sourceUrl}`);
    return {
      name: row.name,
      source: { type: 'github', url: row.sourceUrl },
      license: knownSkill?.license ?? 'NOASSERTION',
      attribution: knownSkill?.attribution ?? repo,
    };
  }
  const { markdown } = await log.api<{ markdown: string }>(
    'GET',
    `/teams/${teamId}/agent-skills/${row.id}/markdown`,
  );
  const files: Record<string, string> = { 'SKILL.md': markdown };
  for (const file of row.files) {
    if (!/\.md$/i.test(file.path)) continue;
    const { content } = await log.api<{ content: string }>(
      'GET',
      `/teams/${teamId}/agent-skills/${row.id}/references/content?path=${encodeURIComponent(file.path)}`,
    );
    files[file.path] = content;
  }
  return {
    name: row.name,
    source: { type: 'files', files },
    license: knownSkill?.license ?? meta.license,
    attribution: knownSkill?.attribution ?? `${meta.author} (${meta.license})`,
  };
}

// Reads the team's templates, their skills and MCP servers into a bundle.
export async function exportBundle(
  log: SyncLog,
  teamId: number,
  options: ExportOptions = {},
): Promise<TemplateBundle> {
  const known = options.known;
  const license = options.license ?? known?.license ?? 'AGPL-3.0-only';
  const author = options.author ?? known?.author ?? { name: options.productName ?? 'Ava' };
  const knownSkills = new Map((known?.skills ?? []).map((skill) => [skill.name, skill]));
  const knownAgents = new Map((known?.agents ?? []).map((agent) => [agent.name, agent]));
  const agents = await log.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  const org = await log.api<Organization>('GET', `/teams/${teamId}/organization`);
  const wanted = options.agents?.map((handle) => handle.toLowerCase());
  const templates = agents
    .filter(
      (row) =>
        row.template !== (options.workingAgents === true) &&
        (!wanted || wanted.includes(row.username.toLowerCase())),
    )
    .sort((a, b) => a.username.localeCompare(b.username));

  const skills = new Map<number, BundleSkill>();
  const mcpServers: Record<string, BundleMcpServer> = {};
  const out: BundleAgent[] = [];
  for (const row of templates) {
    const skillRows = await log.api<SkillRow[]>(
      'GET',
      `/teams/${teamId}/ai-agents/${row.id}/skills`,
    );
    for (const skillRow of skillRows) {
      if (!skills.has(skillRow.id)) {
        skills.set(
          skillRow.id,
          await exportSkill(log, teamId, skillRow, { license, author: author.name }, knownSkills),
        );
      }
    }
    const serverRows =
      options.includeMcpServers === false
        ? []
        : await log.api<McpServerRow[]>('GET', `/teams/${teamId}/ai-agents/${row.id}/mcp-servers`);
    for (const server of serverRows) {
      if (server.env.length > 0 || server.headers.length > 0)
        log.warn(
          `MCP server "${server.name}": env and headers are left out (they can hold secrets)`,
        );
      mcpServers[server.name] = {
        type: server.transport,
        ...(server.command ? { command: server.command } : {}),
        ...(server.args.length > 0 ? { args: server.args } : {}),
        ...(server.url ? { url: server.url } : {}),
        ...(server.description ? { description: server.description } : {}),
      };
    }
    const assignment = org.agents.find((a) => a.id === row.id);
    const policy = row.runtimePolicy;
    out.push({
      name: row.username,
      description:
        knownAgents.get(row.username)?.description ?? (assignment?.roleTitle || row.name),
      instructions: (row.instructions ?? '').trim() || 'Follow your assigned project instructions.',
      model: row.model,
      effort: policy.reasoningEffort,
      maxTurns: policy.maxTurns ?? null,
      disallowedTools: [...policy.toolDeny],
      skills: skillRows.map((skill) => skill.name),
      mcpServers: serverRows.map((server) => server.name),
      helena: {
        displayName: row.name,
        roleTitle: assignment?.roleTitle ?? '',
        capabilities: assignment?.capabilities ?? [],
        runBudgetSeconds: policy.runBudgetSeconds ?? null,
        triggers: { mention: row.triggerOnMention, assign: row.triggerOnAssign },
      },
    });
  }
  if (options.extraSkills?.length) {
    const library = await log.api<SkillRow[]>('GET', `/teams/${teamId}/agent-skills/options`);
    for (const name of options.extraSkills) {
      const row = library.find((skill) => skill.name === name);
      if (!row) throw new Error(`Skill ${name} is missing`);
      if (!skills.has(row.id))
        skills.set(
          row.id,
          await exportSkill(log, teamId, row, { license, author: author.name }, knownSkills),
        );
    }
  }
  log.log(
    `Exported ${out.length} template(s), ${skills.size} skill(s), ${Object.keys(mcpServers).length} MCP server(s).`,
  );
  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    name: options.name ?? known?.name ?? 'helena-templates',
    displayName: options.displayName ?? known?.displayName ?? 'Vorlagen',
    version: options.version ?? known?.version ?? '1.0.0',
    description:
      options.description ??
      known?.description ??
      `Aus ${options.productName ?? 'Ava'} exportierte Agenten-Vorlagen.`,
    license,
    author,
    skills: [...skills.values()].sort(
      (a, b) =>
        Number(a.source.type === 'files') - Number(b.source.type === 'files') ||
        a.name.localeCompare(b.name),
    ),
    mcpServers,
    agents: out,
  };
}

// ---------------------------------------------------------------------------
// Report (read-only)
// ---------------------------------------------------------------------------

export async function reportTemplates(log: SyncLog, teamId: number): Promise<void> {
  log.log('\n== Templates in the team ==');
  const agents = await log.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  const org = await log.api<Organization>('GET', `/teams/${teamId}/organization`);
  const templates = agents.filter((a) => a.template).sort((a, b) => a.name.localeCompare(b.name));
  for (const row of templates) {
    const skills = await log.api<{ name: string }[]>(
      'GET',
      `/teams/${teamId}/ai-agents/${row.id}/skills`,
    );
    const servers = await log.api<{ name: string }[]>(
      'GET',
      `/teams/${teamId}/ai-agents/${row.id}/mcp-servers`,
    );
    const assignment = org.agents.find((a) => a.id === row.id);
    const copies = agents.filter((a) => a.sourceTemplateId === row.id).length;
    const policy = row.runtimePolicy;
    log.log(
      `- ${row.name} (@${row.username}) — ${assignment?.roleTitle || 'no role title'}; ` +
        `${row.model ?? 'default model'} / ${policy.reasoningEffort ?? 'default'}; ` +
        `turns ${policy.maxTurns ?? '-'}, budget ${policy.runBudgetSeconds ?? '-'} s; ` +
        `denied [${policy.toolDeny.join(', ')}]; capabilities [${assignment?.capabilities.join(', ') ?? ''}]; ` +
        `MCP [${servers.map((s) => s.name).join(', ')}]; ${copies} cop${copies === 1 ? 'y' : 'ies'}; ` +
        `${skills.length} skill(s): ${skills.map((s) => s.name).join(', ')}`,
    );
  }
  log.log(`${templates.length} template(s).`);
}
