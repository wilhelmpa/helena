#!/usr/bin/env bun
/**
 * seed.ts — loads the demo organization into a Helena instance, through its HTTP API only.
 *
 *   HELENA_API_KEY=… bun scripts/helena-demo/seed.ts [--base-url=http://localhost:3000]
 *       [--team-id=N] [--dry-run] [--with-skills] [--start-work]
 *
 * What it makes (scripts/helena-demo/demo-data.ts):
 *   - the pool templates the demo copies, imported from the pool bundle (bundles/agent-pool)
 *     through the bundle import; `--with-skills` also imports their skills and MCP servers
 *     (GitHub skills are pinned to a commit and need the network)
 *   - two projects, SITE and OPS; Helena gives each its coordinator, which reports to the
 *     Home agent
 *   - specialists copied from pool templates into each project, reporting to its coordinator
 *   - sample tasks, a weekly routine in OPS, a builder workflow in SITE
 *
 * Idempotent: every step reads first and creates only what is missing; a second run writes
 * nothing. Nothing is assigned to an agent unless --start-work is given, so no model runs
 * before the user decides it. The API key is sent as x-api-key and never printed; the keys
 * of agents Helena creates are dropped unread.
 */

import { join } from 'node:path';
import type { TemplateBundle } from '../helena-bundle.ts';
import { readBundle } from '../helena-bundle-files.ts';
import { importBundle, keyTransport, SyncLog, type Transport } from '../helena-bundle-sync.ts';
import { DEMO_PROJECTS, DEMO_ROUTINE, DEMO_WORKFLOW, type DemoProject } from './demo-data.ts';

// Helena's agent pool, a template bundle (docs/helena-decisions/template-bundles.md).
const POOL_BUNDLE = join(import.meta.dir, '..', '..', 'bundles', 'agent-pool');

export interface DemoOptions {
  dryRun?: boolean;
  withSkills?: boolean;
  startWork?: boolean;
  teamId?: number;
}

interface Agent {
  id: number;
  userId?: string;
  name: string;
  username: string;
  template: boolean;
  sourceTemplateId: number | null;
  projects: { id: number; key: string }[];
}

interface OrgAgent {
  id: number;
  username: string;
  role: 'coordinator' | 'specialist' | 'reviewer' | null;
  reportsToAgentId: number | null;
}

interface Project {
  id: number;
  key: string;
  teamId: number;
}

const HOME_AGENT_USERNAME = 'master';

function list<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    for (const field of ['items', 'data', 'results', 'issues', 'routines', 'pipelines']) {
      const inner = (value as Record<string, unknown>)[field];
      if (Array.isArray(inner)) return inner as T[];
    }
  }
  return [];
}

export class DemoSeed {
  readonly lines: string[] = [];
  written = 0;
  warnings = 0;

  constructor(
    private readonly send: Transport,
    private readonly opts: DemoOptions,
    private readonly echo: (line: string) => void = () => {},
  ) {}

  log(line: string): void {
    this.lines.push(line);
    this.echo(line);
  }

  warn(line: string): void {
    this.warnings += 1;
    this.log(`[WARN] ${line}`);
  }

  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body);
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    if (!text) return undefined as T;
    const parsed = JSON.parse(text) as T;
    if (parsed && typeof parsed === 'object' && 'apiKey' in parsed) {
      (parsed as { apiKey?: unknown }).apiKey = undefined;
    }
    return parsed;
  }

  async write<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
    this.log(`${this.opts.dryRun ? '[DRY-RUN] would' : '[WRITE]'} ${what}`);
    if (this.opts.dryRun) return null;
    const result = await fn();
    this.written += 1;
    return result;
  }

  async run(): Promise<void> {
    const teamId = await this.resolveTeam();
    await this.pool(teamId);
    const agents = () => this.api<Agent[]>('GET', `/teams/${teamId}/ai-agents`);
    const home = (await agents()).find((a) => a.username.toLowerCase() === HOME_AGENT_USERNAME);
    if (!home) {
      this.warn(
        'the Home agent does not exist yet; the coordinators report to nobody until it is ' +
          'bootstrapped. Run the seed again afterwards and it links them.',
      );
    }
    for (const project of DEMO_PROJECTS) {
      const row = await this.ensureProject(project);
      if (!row) continue;
      const coordinator = await this.ensureCoordinator(teamId, row, home);
      const specialists = await this.ensureSpecialists(teamId, row, project, coordinator);
      await this.ensureTasks(row, project, specialists);
    }
    await this.ensureRoutine(teamId);
    await this.ensureWorkflow();
    this.log(
      `\n== Demo ==\n${this.written} write(s)${this.opts.dryRun ? ' (dry run: none made)' : ''}, ` +
        `${this.warnings} warning(s). Open the SITE project, assign "${DEMO_PROJECTS[0]!.tasks[0]!.title}" ` +
        'to its researcher and watch the run.',
    );
  }

  private async resolveTeam(): Promise<number> {
    const teams = await this.api<{ id: number; name: string }[]>('GET', '/teams');
    const team = this.opts.teamId ? teams.find((t) => t.id === this.opts.teamId) : teams[0];
    if (!team) throw new Error('no team found for this API key');
    this.log(`team ${team.name} (#${team.id})`);
    return team.id;
  }

  private async pool(teamId: number): Promise<void> {
    // Only the templates the demo copies. Without --with-skills they come without skills and
    // MCP servers, so the seed needs no network and names nothing it did not import.
    const full = readBundle(POOL_BUNDLE);
    const wanted = new Set(DEMO_PROJECTS.flatMap((project) => project.specialists));
    const agents = full.agents.filter((agent) => wanted.has(agent.name.toLowerCase()));
    const skillNames = new Set(agents.flatMap((agent) => agent.skills));
    const serverNames = new Set(agents.flatMap((agent) => agent.mcpServers));
    const bundle: TemplateBundle = this.opts.withSkills
      ? {
          ...full,
          agents,
          skills: full.skills.filter((skill) => skillNames.has(skill.name)),
          mcpServers: Object.fromEntries(
            Object.entries(full.mcpServers).filter(([name]) => serverNames.has(name)),
          ),
        }
      : {
          ...full,
          agents: agents.map((agent) => ({ ...agent, skills: [], mcpServers: [] })),
          skills: [],
          mcpServers: {},
        };
    const log = new SyncLog(this.send, { dryRun: !!this.opts.dryRun, update: false });
    await importBundle(log, teamId, bundle);
    this.written += log.written;
    this.warnings += log.warnings;
    this.log(
      `pool templates (${agents.map((agent) => agent.name).join(', ')}): ${log.summary()}` +
        (this.opts.withSkills ? '' : ' Skills not imported; --with-skills adds them.'),
    );
  }

  private async ensureProject(project: DemoProject): Promise<Project | null> {
    const projects = await this.api<Project[]>('GET', '/projects');
    const found = projects.find((p) => p.key === project.key);
    if (found) {
      this.log(`[OK] project ${project.key}`);
      return found;
    }
    return this.write(`create project ${project.key} "${project.name}"`, () =>
      this.api<Project>('POST', '/projects', {
        key: project.key,
        name: project.name,
        description: project.description,
        preset: project.preset,
      }),
    );
  }

  private async ensureCoordinator(
    teamId: number,
    project: Project,
    home: Agent | undefined,
  ): Promise<OrgAgent | null> {
    const org = await this.api<{ agents: OrgAgent[] }>('GET', `/teams/${teamId}/organization`);
    const username = `hermes-${project.key.toLowerCase()}-coordinator`;
    const coordinator = org.agents.find((a) => a.username.toLowerCase() === username);
    if (!coordinator) {
      this.warn(`project ${project.key} has no coordinator @${username}`);
      return null;
    }
    if (home && coordinator.reportsToAgentId !== home.id) {
      await this.write(`let @${username} report to the Home agent`, () =>
        this.api('PUT', `/teams/${teamId}/organization/agents/${coordinator.id}`, {
          reportsToAgentId: home.id,
          role: 'coordinator',
        }),
      );
    } else {
      this.log(`[OK] coordinator @${username}`);
    }
    return coordinator;
  }

  private async ensureSpecialists(
    teamId: number,
    project: Project,
    demo: DemoProject,
    coordinator: OrgAgent | null,
  ): Promise<Map<string, Agent>> {
    const byTemplate = new Map<string, Agent>();
    let agents = await this.api<Agent[]>('GET', `/teams/${teamId}/ai-agents`);
    for (const handle of demo.specialists) {
      const template = agents.find((a) => a.template && a.username.toLowerCase() === handle);
      if (!template) {
        this.warn(`pool template @${handle} is missing; ${project.key} gets no copy of it`);
        continue;
      }
      let copy = agents.find(
        (a) => a.sourceTemplateId === template.id && a.projects.some((p) => p.id === project.id),
      );
      if (!copy) {
        const created = await this.write(`copy template @${handle} into ${project.key}`, () =>
          this.api<{ agent: Agent }>('POST', `/teams/${teamId}/ai-agents/${template.id}/copy`, {
            projectId: project.id,
          }),
        );
        if (!created) continue;
        agents = await this.api<Agent[]>('GET', `/teams/${teamId}/ai-agents`);
        copy = agents.find((a) => a.id === created.agent.id) ?? created.agent;
      } else {
        this.log(`[OK] ${project.key} specialist @${copy.username}`);
      }
      byTemplate.set(handle, copy);
      if (coordinator) await this.reportTo(teamId, copy, coordinator);
    }
    return byTemplate;
  }

  private async reportTo(teamId: number, agent: Agent, coordinator: OrgAgent): Promise<void> {
    const org = await this.api<{ agents: OrgAgent[] }>('GET', `/teams/${teamId}/organization`);
    const current = org.agents.find((a) => a.id === agent.id);
    if (current?.reportsToAgentId === coordinator.id && current.role === 'specialist') return;
    await this.write(`let @${agent.username} report to @${coordinator.username}`, () =>
      this.api('PUT', `/teams/${teamId}/organization/agents/${agent.id}`, {
        reportsToAgentId: coordinator.id,
        role: 'specialist',
      }),
    );
  }

  private async ensureTasks(
    project: Project,
    demo: DemoProject,
    specialists: Map<string, Agent>,
  ): Promise<void> {
    // The full project view carries the columns (there is no list route of its own).
    const view = await this.api<{ columns?: { id: number; stateType?: string }[] }>(
      'GET',
      `/projects/${project.key}`,
    );
    const columns = view.columns ?? [];
    const column = columns.find((c) => c.stateType === 'unstarted') ?? columns[0];
    if (!column) {
      this.warn(`project ${project.key} has no columns`);
      return;
    }
    const existing = list<{ title: string }>(
      await this.api('GET', `/projects/${project.key}/issues?includeArchived=true`),
    );
    const first = specialists.values().next().value as Agent | undefined;
    for (const [index, task] of demo.tasks.entries()) {
      if (existing.some((issue) => issue.title === task.title)) {
        this.log(`[OK] ${project.key} task "${task.title}"`);
        continue;
      }
      const assign = this.opts.startWork && index === 0 && first?.userId;
      await this.write(
        `create ${project.key} task "${task.title}"${assign ? ` for @${first!.username}` : ''}`,
        () =>
          this.api('POST', `/projects/${project.key}/issues`, {
            columnId: column.id,
            title: task.title,
            description: task.description,
            ...(assign ? { assigneeUserId: first!.userId } : {}),
          }),
      );
    }
  }

  private async ensureRoutine(teamId: number): Promise<void> {
    const key = DEMO_ROUTINE.projectKey;
    const org = await this.api<{ agents: OrgAgent[] }>('GET', `/teams/${teamId}/organization`);
    const coordinator = org.agents.find(
      (a) => a.username.toLowerCase() === `hermes-${key.toLowerCase()}-coordinator`,
    );
    if (!coordinator) {
      this.warn(`no coordinator in ${key}; the routine is left out`);
      return;
    }
    try {
      const routines = list<{ title: string }>(await this.api('GET', `/projects/${key}/routines`));
      if (routines.some((r) => r.title === DEMO_ROUTINE.title)) {
        this.log(`[OK] ${key} routine "${DEMO_ROUTINE.title}"`);
        return;
      }
      await this.write(`create ${key} routine "${DEMO_ROUTINE.title}" (${DEMO_ROUTINE.cron})`, () =>
        this.api('POST', `/projects/${key}/routines`, {
          idempotencyKey: DEMO_ROUTINE.idempotencyKey,
          agentId: coordinator.id,
          title: DEMO_ROUTINE.title,
          instructions: DEMO_ROUTINE.instructions,
          mode: 'new',
          cron: DEMO_ROUTINE.cron,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }),
      );
    } catch (error) {
      // Routines need the scheduler; an instance without one refuses them.
      this.warn(`routine not created: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async ensureWorkflow(): Promise<void> {
    const key = DEMO_WORKFLOW.projectKey;
    type Listed = { pipeline: { id: number; name: string }; enabled: boolean };
    try {
      const listed = list<Listed>(await this.api('GET', `/projects/${key}/pipelines`));
      let entry = listed.find((p) => p.pipeline?.name === DEMO_WORKFLOW.name);
      if (entry) {
        this.log(`[OK] ${key} workflow "${DEMO_WORKFLOW.name}"`);
      } else {
        const created = await this.write(`create ${key} workflow "${DEMO_WORKFLOW.name}"`, () =>
          this.api<{ id: number; name: string }>('POST', `/projects/${key}/pipelines`, {
            name: DEMO_WORKFLOW.name,
            description: DEMO_WORKFLOW.description,
            definition: DEMO_WORKFLOW.definition,
          }),
        );
        if (!created) return;
        entry = { pipeline: created, enabled: false };
      }
      if (!entry.enabled) {
        // The roles are left to their own rule: each capability names one specialist.
        await this.write(`enable ${key} workflow "${DEMO_WORKFLOW.name}"`, () =>
          this.api('PUT', `/projects/${key}/pipelines/${entry!.pipeline.id}`, {
            enabled: true,
            roles: {},
          }),
        );
      }
    } catch (error) {
      this.warn(`workflow not complete: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Helena limits a key to 100 requests per window of one second, and the window only
// restarts after a second without any request (better-auth's API key limiter). A seed
// against localhost runs into it after a hundred quick requests, and the API then answers
// 500 instead of 429. So the wrapper pauses after every 90 requests, and retries a GET that
// failed with a 500 once the window has passed.
export function throttled(send: Transport, burst = 90): Transport {
  let sincePause = 0;
  const pause = async () => {
    await Bun.sleep(1100);
    sincePause = 0;
  };
  return async (method, path, body) => {
    if (sincePause >= burst) await pause();
    sincePause += 1;
    const res = await send(method, path, body);
    if (res.ok || method !== 'GET' || (res.status !== 500 && res.status !== 429)) return res;
    await pause();
    sincePause += 1;
    return send(method, path, body);
  };
}

export async function runDemoSeed(
  options: DemoOptions,
  send: Transport,
  echo: (line: string) => void = () => {},
): Promise<{ lines: string[]; written: number; warnings: number }> {
  const seed = new DemoSeed(throttled(send), options, echo);
  seed.log(`Helena demo seed — ${options.dryRun ? 'DRY RUN (no writes)' : 'LIVE (writes)'}`);
  await seed.run();
  return { lines: seed.lines, written: seed.written, warnings: seed.warnings };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const apiKey = process.env.HELENA_API_KEY;
  if (!apiKey) {
    console.error(
      'HELENA_API_KEY is not set. Create a personal API key in Helena (Account → API keys).',
    );
    process.exit(1);
  }
  const teamId = value('team-id');
  const result = await runDemoSeed(
    {
      dryRun: args.includes('--dry-run'),
      withSkills: args.includes('--with-skills'),
      startWork: args.includes('--start-work'),
      teamId: teamId ? Number(teamId) : undefined,
    },
    keyTransport(value('base-url') ?? 'http://localhost:3000', apiKey),
    (line) => console.log(line),
  );
  if (result.warnings > 0) process.exitCode = 2;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('\nhelena demo seed failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
