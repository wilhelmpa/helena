#!/usr/bin/env bun
/**
 * setup-agent-pool.ts — configuration as code for Helena's agent pool ("Agentenpool").
 *
 * The pool itself lives in ../agent-pool/pool.ts (templates, which skills each one gets,
 * where every skill comes from and under which license) and ../agent-pool/skills/ (the
 * skills written for Helena, as SKILL.md files). This script makes a Helena instance
 * match it, through Helena's own HTTP API, never the database:
 *
 *   skills     the team skill library: GitHub imports pinned to a commit (Helena's
 *              importer takes SKILL.md and markdown only, never scripts) and the
 *              self-written skills from ../agent-pool/skills/.
 *   templates  the pool templates (template = true: they run nowhere, a project adds a
 *              copy), each with its instructions, model and reasoning, run budgets,
 *              denied toolsets, triggers, role title, capabilities and skills. The two
 *              templates that existed before the pool (coder, content) only get skills
 *              added; nothing else on them is touched.
 *   report     read-only: prints every template with its model, skills and capabilities.
 *
 * Only these three run by default. Four older, owner-approved steps stay available but
 * run only when named in --sections, because they change running agents or projects:
 *   copies     project copies closing the gaps of docs/volition-agent-pool-research.md C
 *   org        "Familie & Privat" department + extra skills for the four coordinators
 *   shopify    the Shopify Dev MCP server (read-only, no mutations) on coder-verve
 *   goals      organization goals for the roadmap phases of volition-hub-plan.md
 *
 * Idempotent: every step reads first and writes only what is missing. A template or
 * self-written skill that exists but differs from the pool is reported as [DRIFT] and
 * left alone (the owner may have tuned it in the UI); --update writes the pool's values
 * over such differences. Skills are only ever added to an agent, never removed.
 * --dry-run writes nothing at all.
 *
 * Two ways to run it:
 *
 * 1. With a personal API key (Helena → Konto → API-Schlüssel), on the server:
 *      HELENA_API_KEY=itp_... bun deployment/volition-stack/scripts/setup-agent-pool.ts \
 *        [--dry-run] [--update] [--sections=skills,templates,report] \
 *        [--base-url=http://localhost:3000] [--team-id=1]
 *    The key is read once, sent as the x-api-key header and never printed.
 *
 * 2. In a browser that is signed in to Helena, with that session and no key at all:
 *      bun build deployment/volition-stack/scripts/setup-agent-pool.browser.ts \
 *        --target=browser --format=iife --outfile=/tmp/helena-agent-pool.js
 *    then evaluate /tmp/helena-agent-pool.js in a Helena tab (DevTools console, or a
 *    headless driver) and call
 *      await helenaAgentPool.run({ dryRun: true })            // or { update: true }
 *    It calls the same API through `/backend` with the page's own cookies and returns
 *    the log lines. Every agent Helena creates gets its own API key in the answer; this
 *    script drops it unread (a template never runs, so its key reaches no project).
 */

import {
  EXISTING_TEMPLATES,
  GITHUB_SKILLS,
  OWN_SKILLS,
  POOL_TEMPLATES,
  type GithubSkillSeed,
  type OwnSkillSeed,
  type TemplateSeed,
} from '../agent-pool/pool.ts';
import { COPIES, COORDINATOR_SKILLS, ROADMAP_GOALS } from '../agent-pool/legacy.ts';

// ---------------------------------------------------------------------------
// Options, transport, log
// ---------------------------------------------------------------------------

export const DEFAULT_SECTIONS = ['skills', 'templates', 'report'] as const;
export const ALL_SECTIONS = [
  'skills',
  'templates',
  'copies',
  'org',
  'shopify',
  'goals',
  'report',
] as const;
export type Section = (typeof ALL_SECTIONS)[number];

export interface PoolOptions {
  dryRun?: boolean;
  update?: boolean;
  sections?: Section[];
  teamId?: number;
}

// How a request reaches Helena: with an API key against the API directly, or with the
// browser's own session through the web app's /backend proxy.
export type Transport = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; ok: boolean; text: () => Promise<string> }>;

export function keyTransport(baseUrl: string, apiKey: string): Transport {
  const base = baseUrl.replace(/\/+$/, '');
  return (method, path, body) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        'x-api-key': apiKey,
        ...(body !== undefined && !(body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
    });
}

export function sessionTransport(prefix = '/backend'): Transport {
  return (method, path, body) =>
    fetch(`${prefix}${path}`, {
      method,
      credentials: 'include',
      headers:
        body !== undefined && !(body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {},
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
    });
}

class Pool {
  readonly lines: string[] = [];
  written = 0;
  unchanged = 0;
  drift = 0;
  warnings = 0;

  constructor(
    readonly send: Transport,
    readonly opts: Required<Pick<PoolOptions, 'dryRun' | 'update'>>,
    readonly echo: (line: string) => void,
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

  // A difference between the pool and the instance. Applied only with --update.
  differs(line: string): boolean {
    this.drift += 1;
    this.log(`[DRIFT] ${line}${this.opts.update ? '' : ' (left as is; --update applies the pool value)'}`);
    return this.opts.update;
  }

  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body);
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    if (!text) return undefined as T;
    const parsed = JSON.parse(text) as T;
    // Creating or copying an agent answers with its new API key. Never keep it.
    if (parsed && typeof parsed === 'object' && 'apiKey' in parsed) {
      (parsed as { apiKey?: unknown }).apiKey = undefined;
    }
    return parsed;
  }

  // A write, performed only outside --dry-run. Returns null in a dry run.
  async write<T>(description: string, fn: () => Promise<T>): Promise<T | null> {
    this.log(`${this.opts.dryRun ? '[DRY-RUN] would' : '[WRITE]'} ${description}`);
    if (this.opts.dryRun) return null;
    const result = await fn();
    this.written += 1;
    return result;
  }
}

// ---------------------------------------------------------------------------
// API shapes (the fields this script reads)
// ---------------------------------------------------------------------------

interface SkillRow {
  id: number;
  name: string;
  description: string;
  source: 'upload' | 'inline' | 'github';
  sourceUrl: string | null;
  files: { path: string; size: number }[];
}

interface RuntimePolicy {
  reasoningEffort: string | null;
  toolAllow: string[];
  toolDeny: string[];
  mcpGrants: string[];
  files: { kind: 'instructions'; path: string; content: string }[];
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
  [key: string]: unknown;
}

interface AgentRow {
  id: number;
  name: string;
  username: string;
  kind: 'external' | 'internal';
  template: boolean;
  sourceTemplateId: number | null;
  model: string | null;
  instructions: string | null;
  runtimePolicy: RuntimePolicy;
  triggerOnMention: boolean;
  triggerOnAssign: boolean;
  projects: { id: number; key: string }[];
  dailyTokenCeiling: number | null;
  monthlyTokenCeiling: number | null;
}

interface OrgAgent {
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

interface Organization {
  departments: { id: number; name: string }[];
  goals: { id: number; title: string }[];
  agents: OrgAgent[];
}

const byHandle = (agents: AgentRow[], username: string) =>
  agents.find((a) => a.username.toLowerCase() === username.toLowerCase());

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

async function resolveTeam(pool: Pool, teamId?: number): Promise<number> {
  const teams = await pool.api<{ id: number; name: string }[]>('GET', '/teams');
  if (teams.length === 0) throw new Error('The caller belongs to no team.');
  const team = teamId == null ? teams[0]! : teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`Team ${teamId} is not one of the caller's teams`);
  pool.log(`Team ${team.id} (${team.name})`);
  return team.id;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

async function listSkills(pool: Pool, teamId: number): Promise<SkillRow[]> {
  return pool.api<SkillRow[]>('GET', `/teams/${teamId}/agent-skills/options`);
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const transient = err instanceof Error && / -> 50[234]:/.test(err.message);
      if (!transient || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

// A GitHub skill is found by its pinned URL first, then by name: a skill of that name
// from elsewhere (an older pin, a hand import) is used as is and reported, never
// replaced — the links the owner made to it would go with it.
async function ensureGithubSkill(
  pool: Pool,
  teamId: number,
  library: SkillRow[],
  seed: GithubSkillSeed,
): Promise<number | null> {
  const byUrl = library.find((s) => s.sourceUrl === seed.sourceUrl);
  if (byUrl) {
    pool.ok(`skill "${byUrl.name}" (${seed.license})`);
    return byUrl.id;
  }
  const byName = library.find((s) => s.name.toLowerCase() === seed.name.toLowerCase());
  if (byName) {
    pool.warn(
      `skill "${seed.name}" exists from ${byName.sourceUrl ?? byName.source}, not ${seed.sourceUrl} — using it as is`,
    );
    return byName.id;
  }
  const created = await pool.write(
    `import skill "${seed.name}" from ${seed.sourceUrl} (${seed.license})`,
    () =>
      // Helena reads the repository through jsDelivr, which now and then answers a
      // request with a 5xx; Helena passes that on as 502.
      retry(() =>
        pool.api<SkillRow>('POST', `/teams/${teamId}/agent-skills`, {
          source: 'github',
          sourceUrl: seed.sourceUrl,
        }),
      ),
  );
  if (!created) return null;
  if (created.name !== seed.name) {
    pool.warn(`imported "${seed.sourceUrl}" is named "${created.name}", pool expects "${seed.name}"`);
  }
  library.push(created);
  return created.id;
}

function referenceFile(path: string, content: string): FormData {
  const form = new FormData();
  const name = path.split('/').pop()!;
  form.append('file', new Blob([content], { type: 'text/markdown' }), name);
  return form;
}

// A self-written skill: the files under ../agent-pool/skills/<name>/ are its source of
// truth. Its references are uploaded as refs/<file>.md, which is where Helena keeps an
// uploaded reference and what the SKILL.md links point at.
async function ensureOwnSkill(
  pool: Pool,
  teamId: number,
  library: SkillRow[],
  seed: OwnSkillSeed,
): Promise<number | null> {
  const found = library.find((s) => s.name.toLowerCase() === seed.name.toLowerCase());
  let skill: SkillRow | null = found ?? null;
  if (!found) {
    skill = await pool.write(`create own skill "${seed.name}"`, () =>
      pool.api<SkillRow>('POST', `/teams/${teamId}/agent-skills`, {
        source: 'inline',
        markdown: seed.markdown,
      }),
    );
    if (!skill) {
      for (const path of Object.keys(seed.refs)) {
        pool.log(`[DRY-RUN] would add reference ${path} to "${seed.name}"`);
      }
      return null;
    }
    library.push(skill);
  } else if (found.source === 'github') {
    pool.warn(`skill "${seed.name}" is a GitHub import; the own skill of that name is not applied`);
    return found.id;
  } else {
    const { markdown } = await pool.api<{ markdown: string }>(
      'GET',
      `/teams/${teamId}/agent-skills/${found.id}/markdown`,
    );
    if (markdown === seed.markdown) pool.ok(`own skill "${seed.name}"`);
    else if (pool.differs(`own skill "${seed.name}": SKILL.md differs from the pool`)) {
      await pool.write(`update SKILL.md of "${seed.name}"`, () =>
        pool.api('PATCH', `/teams/${teamId}/agent-skills/${found.id}`, {
          markdown: seed.markdown,
        }),
      );
    }
  }
  const current = skill!;
  for (const [path, content] of Object.entries(seed.refs)) {
    const existing = current.files.find((f) => f.path === path);
    if (!existing) {
      await pool.write(`add reference ${path} to "${seed.name}"`, () =>
        pool.api('POST', `/teams/${teamId}/agent-skills/${current.id}/references`, referenceFile(path, content)),
      );
      continue;
    }
    const { content: live } = await pool.api<{ content: string }>(
      'GET',
      `/teams/${teamId}/agent-skills/${current.id}/references/content?path=${encodeURIComponent(path)}`,
    );
    if (live === content) pool.ok(`reference ${path} of "${seed.name}"`);
    else if (pool.differs(`reference ${path} of "${seed.name}" differs from the pool`)) {
      await pool.write(`update reference ${path} of "${seed.name}"`, () =>
        pool.api('PATCH', `/teams/${teamId}/agent-skills/${current.id}/references/content`, {
          path,
          content,
        }),
      );
    }
  }
  return current.id;
}

async function ensureSkills(pool: Pool, teamId: number): Promise<Map<string, number>> {
  pool.log('\n== Skills ==');
  const library = await listSkills(pool, teamId);
  const ids = new Map<string, number>();
  for (const seed of GITHUB_SKILLS) {
    try {
      const id = await ensureGithubSkill(pool, teamId, library, seed);
      if (id != null) ids.set(seed.key, id);
    } catch (err) {
      pool.warn(`skill "${seed.name}" not imported: ${err instanceof Error ? err.message : err}`);
    }
  }
  for (const seed of OWN_SKILLS) {
    const id = await ensureOwnSkill(pool, teamId, library, seed);
    if (id != null) ids.set(seed.key, id);
  }
  return ids;
}

// Skill ids for keys, read from the library when the skills section did not run.
async function skillIdsFromLibrary(pool: Pool, teamId: number): Promise<Map<string, number>> {
  const library = await listSkills(pool, teamId);
  const ids = new Map<string, number>();
  for (const seed of GITHUB_SKILLS) {
    const found =
      library.find((s) => s.sourceUrl === seed.sourceUrl) ??
      library.find((s) => s.name.toLowerCase() === seed.name.toLowerCase());
    if (found) ids.set(seed.key, found.id);
  }
  for (const seed of OWN_SKILLS) {
    const found = library.find((s) => s.name.toLowerCase() === seed.name.toLowerCase());
    if (found) ids.set(seed.key, found.id);
  }
  return ids;
}

// Adds the wanted skills to an agent. Never removes one: the PUT replaces the whole set,
// so the current set is read first and only the union is written.
async function addAgentSkills(
  pool: Pool,
  teamId: number,
  agent: { id: number; username: string },
  wantKeys: readonly string[],
  skillIds: Map<string, number>,
): Promise<void> {
  const current = await pool.api<{ id: number }[]>(
    'GET',
    `/teams/${teamId}/ai-agents/${agent.id}/skills`,
  );
  const have = new Set(current.map((s) => s.id));
  const unknown = wantKeys.filter((key) => !skillIds.has(key));
  if (unknown.length > 0) {
    const verb = pool.opts.dryRun ? 'would get' : 'cannot get';
    pool.log(`[${pool.opts.dryRun ? 'DRY-RUN' : 'WARN'}] @${agent.username} ${verb} skill(s) not yet in the library: ${unknown.join(', ')}`);
    if (!pool.opts.dryRun) pool.warnings += 1;
  }
  const missing = wantKeys
    .map((key) => skillIds.get(key))
    .filter((id): id is number => id != null && !have.has(id));
  if (missing.length === 0) {
    if (unknown.length === 0) pool.ok(`@${agent.username} has its ${wantKeys.length} pool skill(s)`);
    return;
  }
  await pool.write(`add ${missing.length} skill(s) to @${agent.username}`, () =>
    pool.api('PUT', `/teams/${teamId}/ai-agents/${agent.id}/skills`, {
      skillIds: [...have, ...missing],
    }),
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function policyFor(seed: TemplateSeed, current?: RuntimePolicy): RuntimePolicy {
  const base: RuntimePolicy = current ?? {
    reasoningEffort: null,
    toolAllow: [],
    toolDeny: [],
    mcpGrants: [],
    files: [],
  };
  const next: RuntimePolicy = {
    ...base,
    reasoningEffort: seed.reasoningEffort,
    toolDeny: [...seed.toolDeny],
  };
  if (seed.maxTurns != null) next.maxTurns = seed.maxTurns;
  else delete next.maxTurns;
  if (seed.runBudgetSeconds != null) next.runBudgetSeconds = seed.runBudgetSeconds;
  else delete next.runBudgetSeconds;
  return next;
}

// What of a template's own configuration differs from its seed, as readable names.
function templateDrift(seed: TemplateSeed, agent: AgentRow): string[] {
  const out: string[] = [];
  const policy = agent.runtimePolicy;
  if (agent.name !== seed.name) out.push(`name "${agent.name}"`);
  if ((agent.instructions ?? '') !== seed.instructions) out.push('instructions');
  if (agent.model !== seed.model) out.push(`model ${agent.model ?? 'default'}`);
  if (policy.reasoningEffort !== seed.reasoningEffort)
    out.push(`reasoning ${policy.reasoningEffort ?? 'default'}`);
  if (!sameList([...policy.toolDeny].sort(), [...seed.toolDeny].sort())) out.push('denied toolsets');
  if ((policy.maxTurns ?? null) !== (seed.maxTurns ?? null)) out.push('max turns');
  if ((policy.runBudgetSeconds ?? null) !== (seed.runBudgetSeconds ?? null)) out.push('run budget');
  if (agent.triggerOnMention !== seed.triggerOnMention || agent.triggerOnAssign !== seed.triggerOnAssign)
    out.push('triggers');
  return out;
}

async function ensureAssignment(
  pool: Pool,
  teamId: number,
  agentId: number,
  seed: TemplateSeed,
  org: OrgAgent | undefined,
): Promise<void> {
  const body = {
    departmentId: null,
    reportsToAgentId: null,
    runtimeAgentId: null,
    role: 'specialist' as const,
    roleTitle: seed.roleTitle,
    capabilities: [...seed.capabilities],
  };
  if (!org || !org.role) {
    await pool.write(
      `set role "${seed.roleTitle}" and capabilities [${seed.capabilities.join(', ')}] on @${seed.username}`,
      () => pool.api('PUT', `/teams/${teamId}/organization/agents/${agentId}`, body),
    );
    return;
  }
  const same =
    org.roleTitle === seed.roleTitle &&
    org.role === 'specialist' &&
    sameList(org.capabilities, seed.capabilities);
  if (same) pool.ok(`@${seed.username} role and capabilities`);
  else if (pool.differs(`@${seed.username} role/capabilities: "${org.roleTitle}" [${org.capabilities.join(', ')}]`)) {
    await pool.write(`set role and capabilities of @${seed.username}`, () =>
      pool.api('PUT', `/teams/${teamId}/organization/agents/${agentId}`, {
        ...body,
        departmentId: org.departmentId,
      }),
    );
  }
}

async function ensureTemplate(
  pool: Pool,
  teamId: number,
  seed: TemplateSeed,
  agents: AgentRow[],
  org: Organization,
  skillIds: Map<string, number>,
): Promise<void> {
  const found = byHandle(agents, seed.username);
  if (found && !found.template) {
    pool.warn(`@${seed.username} exists but is not a template — the pool leaves a working agent alone`);
    return;
  }
  if (!found) {
    const created = await pool.write(
      `create template @${seed.username} "${seed.name}" (${seed.model ?? 'default model'}, reasoning ${seed.reasoningEffort ?? 'default'})`,
      () =>
        pool.api<{ agent: AgentRow }>('POST', `/teams/${teamId}/ai-agents`, {
          name: seed.name,
          username: seed.username,
          kind: 'external',
          template: true,
          instructions: seed.instructions,
          model: seed.model,
          runtimePolicy: policyFor(seed),
          triggerOnMention: seed.triggerOnMention,
          triggerOnAssign: seed.triggerOnAssign,
          runnerScope: 'team',
        }),
    );
    if (!created) {
      pool.log(
        `[DRY-RUN] would set role "${seed.roleTitle}", capabilities [${seed.capabilities.join(', ')}] and ${seed.skills.length} skill(s) on @${seed.username}`,
      );
      return;
    }
    const agent = created.agent;
    await ensureAssignment(pool, teamId, agent.id, seed, undefined);
    await addAgentSkills(pool, teamId, agent, seed.skills, skillIds);
    return;
  }

  const drift = templateDrift(seed, found);
  if (drift.length === 0) pool.ok(`template @${seed.username}`);
  else if (pool.differs(`template @${seed.username}: ${drift.join(', ')}`)) {
    await pool.write(`update template @${seed.username} (${drift.join(', ')})`, () =>
      pool.api('PATCH', `/teams/${teamId}/ai-agents/${found.id}`, {
        name: seed.name,
        instructions: seed.instructions,
        model: seed.model,
        runtimePolicy: policyFor(seed, found.runtimePolicy),
        triggerOnMention: seed.triggerOnMention,
        triggerOnAssign: seed.triggerOnAssign,
      }),
    );
  }
  await ensureAssignment(
    pool,
    teamId,
    found.id,
    seed,
    org.agents.find((a) => a.id === found.id),
  );
  await addAgentSkills(pool, teamId, found, seed.skills, skillIds);
}

async function ensureTemplates(
  pool: Pool,
  teamId: number,
  skillIds: Map<string, number>,
): Promise<void> {
  pool.log('\n== Templates ==');
  const agents = await pool.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  const org = await pool.api<Organization>('GET', `/teams/${teamId}/organization`);

  // The templates that predate the pool: skills are added, nothing else is changed.
  for (const existing of EXISTING_TEMPLATES) {
    const agent = byHandle(agents, existing.username);
    if (!agent?.template) {
      pool.warn(`template @${existing.username} not found — skipped`);
      continue;
    }
    await addAgentSkills(pool, teamId, agent, existing.skills, skillIds);
  }

  // A workflow role matched by capability needs exactly one agent of a project to carry
  // it, so two templates copied into one project must not share one.
  const capabilityOwners = new Map<string, string>();
  const poolHandles = new Set(POOL_TEMPLATES.map((seed) => seed.username.toLowerCase()));
  for (const other of org.agents.filter((a) => a.template && !poolHandles.has(a.username.toLowerCase()))) {
    for (const capability of other.capabilities) capabilityOwners.set(capability, other.username);
  }
  for (const seed of POOL_TEMPLATES) {
    for (const capability of seed.capabilities) {
      const other = capabilityOwners.get(capability);
      if (other) pool.warn(`capability "${capability}" is on both @${other} and @${seed.username}`);
      capabilityOwners.set(capability, seed.username);
    }
    await ensureTemplate(pool, teamId, seed, agents, org, skillIds);
  }
}

// ---------------------------------------------------------------------------
// Report (read-only)
// ---------------------------------------------------------------------------

async function report(pool: Pool, teamId: number): Promise<void> {
  pool.log('\n== Pool report ==');
  const agents = await pool.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  const org = await pool.api<Organization>('GET', `/teams/${teamId}/organization`);
  const templates = agents.filter((a) => a.template).sort((a, b) => a.name.localeCompare(b.name));
  for (const agent of templates) {
    const skills = await pool.api<{ name: string }[]>(
      'GET',
      `/teams/${teamId}/ai-agents/${agent.id}/skills`,
    );
    const assignment = org.agents.find((a) => a.id === agent.id);
    const copies = agents.filter((a) => a.sourceTemplateId === agent.id).length;
    const policy = agent.runtimePolicy;
    pool.log(
      `- ${agent.name} (@${agent.username}) — ${assignment?.roleTitle || 'no role title'}; ` +
        `model ${agent.model ?? 'default'} / ${policy.reasoningEffort ?? 'default'}; ` +
        `turns ${policy.maxTurns ?? '-'}, budget ${policy.runBudgetSeconds ?? '-'} s; ` +
        `denied [${policy.toolDeny.join(', ')}]; capabilities [${assignment?.capabilities.join(', ') ?? ''}]; ` +
        `${copies} cop${copies === 1 ? 'y' : 'ies'}; ${skills.length} skill(s): ${skills.map((s) => s.name).join(', ')}`,
    );
  }
  pool.log(`${templates.length} template(s).`);
}

// ---------------------------------------------------------------------------
// Older steps (opt-in): copies, org, shopify, goals
// ---------------------------------------------------------------------------

async function ensureCopies(pool: Pool, teamId: number): Promise<void> {
  pool.log('\n== Project copies ==');
  const projects = await pool.api<{ id: number; key: string; teamId: number }[]>('GET', '/projects');
  const agents = await pool.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  for (const copy of COPIES) {
    const template = byHandle(agents, copy.template);
    const project = projects.find((p) => p.key === copy.projectKey && p.teamId === teamId);
    if (!template?.template || !project) {
      pool.warn(`copy of @${copy.template} into ${copy.projectKey}: template or project missing`);
      continue;
    }
    const suffix = `-${copy.projectKey.toLowerCase()}`;
    const handle = `${template.username.slice(0, 64 - suffix.length)}${suffix}`;
    if (byHandle(agents, handle)) {
      pool.ok(`copy @${handle}`);
      continue;
    }
    await pool.write(`copy @${copy.template} into ${copy.projectKey} (@${handle})`, () =>
      pool.api('POST', `/teams/${teamId}/ai-agents/${template.id}/copy`, { projectId: project.id }),
    );
  }
}

async function ensureOrg(pool: Pool, teamId: number, skillIds: Map<string, number>): Promise<void> {
  pool.log('\n== Coordinator skills and the "Familie & Privat" department ==');
  const agents = await pool.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  for (const coordinator of agents.filter((a) => /^hermes-.+-coordinator$/i.test(a.username))) {
    await addAgentSkills(pool, teamId, coordinator, COORDINATOR_SKILLS, skillIds);
  }
  const org = await pool.api<Organization>('GET', `/teams/${teamId}/organization`);
  let department = org.departments.find((d) => d.name === 'Familie & Privat');
  if (department) pool.ok('department "Familie & Privat"');
  else {
    department =
      (await pool.write('create department "Familie & Privat"', () =>
        pool.api<{ id: number; name: string }>('POST', `/teams/${teamId}/organization/departments`, {
          name: 'Familie & Privat',
          description: 'FAM und PRIV: Familie und private Organisation, ohne Kundenbezug.',
        }),
      )) ?? undefined;
    if (!department) return;
  }
  for (const username of ['hermes-fam-coordinator', 'hermes-priv-coordinator']) {
    const current = org.agents.find((a) => a.username === username);
    if (!current) {
      pool.warn(`${username} not found`);
      continue;
    }
    if (current.departmentId === department.id) {
      pool.ok(`${username} in "Familie & Privat"`);
      continue;
    }
    // The PUT overwrites department, reporting line, role title and runtime reference,
    // so every field is sent back.
    await pool.write(`assign ${username} to "Familie & Privat"`, () =>
      pool.api('PUT', `/teams/${teamId}/organization/agents/${current.id}`, {
        departmentId: department!.id,
        reportsToAgentId: current.reportsToAgentId,
        roleTitle: current.roleTitle,
        role: current.role,
        capabilities: current.capabilities,
        runtimeAgentId: current.runtimeAgentId,
      }),
    );
  }
}

async function ensureShopifyMcp(pool: Pool, teamId: number): Promise<void> {
  pool.log('\n== Shopify Dev MCP (read-only, no mutations) on coder-verve ==');
  const servers = await pool.api<{ id: number; name: string }[]>('GET', `/teams/${teamId}/mcp-servers`);
  let server = servers.find((s) => s.name === 'shopify-dev-mcp');
  if (server) pool.ok('MCP server "shopify-dev-mcp"');
  else {
    server =
      (await pool.write('create MCP server "shopify-dev-mcp" (no --allow-mutations)', () =>
        pool.api<{ id: number; name: string }>('POST', `/teams/${teamId}/mcp-servers`, {
          name: 'shopify-dev-mcp',
          description:
            'Durchsucht Shopify-Doku und API-Schemas, prüft GraphQL/Liquid/Extension-Code. ' +
            'Kein Schreibzugriff auf einen Store (kein --allow-mutations).',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@shopify/dev-mcp@latest'],
        }),
      )) ?? undefined;
    if (!server) return;
  }
  const agents = await pool.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  const coderVerve = byHandle(agents, 'coder-verve');
  if (!coderVerve) {
    pool.warn('coder-verve not found');
    return;
  }
  const current = await pool.api<{ id: number }[]>(
    'GET',
    `/teams/${teamId}/ai-agents/${coderVerve.id}/mcp-servers`,
  );
  if (current.some((s) => s.id === server!.id)) {
    pool.ok('shopify-dev-mcp on coder-verve');
    return;
  }
  await pool.write('enable shopify-dev-mcp on coder-verve', () =>
    pool.api('PUT', `/teams/${teamId}/ai-agents/${coderVerve.id}/mcp-servers`, {
      mcpServerIds: [...current.map((s) => s.id), server!.id],
    }),
  );
}

async function ensureGoals(pool: Pool, teamId: number): Promise<void> {
  pool.log('\n== Goals (roadmap phases) ==');
  const org = await pool.api<Organization>('GET', `/teams/${teamId}/organization`);
  const department = org.departments.find((d) => d.name === 'Volition');
  for (const goal of ROADMAP_GOALS) {
    if (org.goals.some((g) => g.title === goal.title)) {
      pool.ok(`goal "${goal.title}"`);
      continue;
    }
    await pool.write(`create goal "${goal.title}"`, () =>
      pool.api('POST', `/teams/${teamId}/organization/goals`, {
        title: goal.title,
        description: goal.description,
        departmentId: department?.id ?? null,
        status: 'active',
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export async function runAgentPool(
  options: PoolOptions,
  send: Transport,
  echo: (line: string) => void = () => {},
): Promise<{ lines: string[]; written: number; unchanged: number; drift: number; warnings: number }> {
  const sections = new Set<Section>(options.sections ?? DEFAULT_SECTIONS);
  for (const section of sections) {
    if (!ALL_SECTIONS.includes(section)) throw new Error(`Unknown section "${section}"`);
  }
  const pool = new Pool(send, { dryRun: !!options.dryRun, update: !!options.update }, echo);
  pool.log(
    `Helena agent pool — ${pool.opts.dryRun ? 'DRY RUN (no writes)' : 'LIVE (writes)'}` +
      `${pool.opts.update ? ', --update' : ''}; sections: ${[...sections].join(', ')}`,
  );
  const teamId = await resolveTeam(pool, options.teamId);
  const skillIds = sections.has('skills')
    ? await ensureSkills(pool, teamId)
    : await skillIdsFromLibrary(pool, teamId);
  if (sections.has('templates')) await ensureTemplates(pool, teamId, skillIds);
  if (sections.has('copies')) await ensureCopies(pool, teamId);
  if (sections.has('org')) await ensureOrg(pool, teamId, skillIds);
  if (sections.has('shopify')) await ensureShopifyMcp(pool, teamId);
  if (sections.has('goals')) await ensureGoals(pool, teamId);
  if (sections.has('report')) await report(pool, teamId);
  pool.log(
    `\n== Summary ==\n${pool.written} write(s)${pool.opts.dryRun ? ' (dry run: none made)' : ''}, ` +
      `${pool.unchanged} unchanged, ${pool.drift} drift, ${pool.warnings} warning(s).`,
  );
  return {
    lines: pool.lines,
    written: pool.written,
    unchanged: pool.unchanged,
    drift: pool.drift,
    warnings: pool.warnings,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const apiKey = process.env.HELENA_API_KEY;
  if (!apiKey) {
    console.error(
      'HELENA_API_KEY is not set. Create a personal API key in Helena (Konto → API-Schlüssel) ' +
        'and pass it as HELENA_API_KEY, or run the browser build from a signed-in Helena tab ' +
        '(see the header of this file).',
    );
    process.exit(1);
  }
  const sections = value('sections')?.split(',').map((s) => s.trim()).filter(Boolean) as
    | Section[]
    | undefined;
  const teamId = value('team-id');
  const result = await runAgentPool(
    {
      dryRun: args.includes('--dry-run'),
      update: args.includes('--update'),
      sections,
      teamId: teamId ? Number(teamId) : undefined,
    },
    keyTransport(value('base-url') ?? 'http://localhost:3000', apiKey),
    (line) => console.log(line),
  );
  if (result.warnings > 0) process.exitCode = 2;
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('\nsetup-agent-pool failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
