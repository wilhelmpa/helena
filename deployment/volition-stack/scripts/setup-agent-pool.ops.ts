// The owner's agent pool on this installation: the bundle import (bundles/agent-pool,
// public and generic) plus steps that only make sense here, because they name the
// running agents and projects of this team. Every step is opt-in by section name;
// without sections only the bundle is imported and the templates reported.
//
// Fs-free, so the browser build (setup-agent-pool.browser.ts) can run it with the
// signed-in session; setup-agent-pool.ts runs it with an API key.

import type { TemplateBundle } from '../../../scripts/helena-bundle.ts';
import { validateBundle } from '../../../scripts/helena-bundle.ts';
import {
  addAgentMcpServers,
  addAgentSkills,
  byHandle,
  importBundle,
  reportTemplates,
  resolveTeam,
  SyncLog,
  teamMcpServerIds,
  teamSkillIds,
  type AgentRow,
  type Organization,
  type Transport,
} from '../../../scripts/helena-bundle-sync.ts';
import { POOL_COORDINATOR_SKILLS, POOL_COPIES } from './setup-agent-pool.copies.ts';

export const SECTIONS = ['bundle', 'agents', 'copies', 'org', 'goals', 'report'] as const;
export type Section = (typeof SECTIONS)[number];
export const DEFAULT_SECTIONS: Section[] = ['bundle', 'report'];

// agents: skills and MCP servers the owner approved for the running agents
// (2026-09-24). Only added; nothing else on them changes.
const CODER_ADDITIONS = ['find-bugs', 'bug-reproduction', 'owasp-security', 'code-review-and-quality'];
const RUNNING_AGENTS: { handle: string; skills: string[]; mcpServers: string[] }[] = [
  { handle: 'coder-vol', skills: [...CODER_ADDITIONS, 'astro-best-practices'], mcpServers: [] },
  { handle: 'coder-verve', skills: [...CODER_ADDITIONS, 'shopify-expert'], mcpServers: ['shopify-dev'] },
  {
    handle: 'content-vol',
    skills: [
      'seo-technical',
      'seo-content',
      'copywriting',
      'schema',
      'content-strategy',
      'astro-content',
      'astro-seo',
    ],
    mcpServers: [],
  },
];

// org: the coordinator skills (setup-agent-pool.copies.ts) and the department of FAM and PRIV.
const FAMILY_DEPARTMENT = {
  name: 'Familie & Privat',
  description: 'FAM und PRIV: Familie und private Organisation, ohne Kundenbezug.',
};

// goals: the roadmap phases as organization goals.
const ROADMAP_GOALS: { title: string; description: string }[] = [
  {
    title: 'Phase 0 — Fundament: Sicherheit, natives Hosting, Backup',
    description:
      'Der Server ist sicher, lokal vollständig nativ erreichbar, gesichert und reproduzierbar; der Internetzugang ist vorbereitet.',
  },
  {
    title: 'Phase 1 — Projekt-Lebenszyklus und Secrets',
    description:
      'Ein neues Projekt richtet alles ein, ein gelöschtes entfernt alles; ein Speicher für Maschinen-Secrets statt acht.',
  },
  {
    title: 'Phase 2 — Arbeitsplatz: Navigation, Panel, Terminal, Browser',
    description:
      'Eine Navigation, ein geteiltes Werkzeug-Panel, echte Terminal-Tabs, ein reparierter Browser.',
  },
  {
    title: 'Phase 3 — Hermes vollständig integrieren',
    description:
      'Chat mit Kontext, Freigaben und Rückfragen; eine Agent-Seite statt vier; Hermes als einzige Laufzeit.',
  },
  {
    title: 'Phase 4 — Orga, Orchestrierung, wiederkehrende Aufgaben',
    description:
      'Org-Chart als echte Grafik, Agent-Teams sichtbar und steuerbar, ein Motor für fachliche Zeitpläne.',
  },
  {
    title: 'Phase 5 — Mail',
    description:
      'IMAP/SMTP, ein schneller Posteingang, Verfassen im geteilten Panel, Agenten schreiben nur Entwürfe.',
  },
  {
    title: 'Phase 6 — Planung: Bereiche, Projekt-Einstellungen, Home',
    description:
      'Bereiche mit eigenen Boards, Einstellungen strikt pro Projekt, Home als konsolidierte Übersicht.',
  },
];

async function ensureRunningAgents(log: SyncLog, teamId: number): Promise<void> {
  log.log('\n== Running agents: approved skill and MCP additions ==');
  const agents = await log.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  const skillIds = await teamSkillIds(log, teamId);
  const serverIds = await teamMcpServerIds(log, teamId);
  for (const entry of RUNNING_AGENTS) {
    const agent = byHandle(agents, entry.handle);
    if (!agent || agent.template) {
      log.warn(`@${entry.handle} is not a running agent of this team`);
      continue;
    }
    await addAgentSkills(log, teamId, agent, entry.skills, skillIds);
    await addAgentMcpServers(log, teamId, agent, entry.mcpServers, serverIds);
  }
}

async function ensureCopies(log: SyncLog, teamId: number): Promise<void> {
  log.log('\n== Project copies ==');
  const projects = await log.api<{ id: number; key: string; teamId: number }[]>('GET', '/projects');
  const agents = await log.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  for (const copy of POOL_COPIES) {
    const template = byHandle(agents, copy.template);
    const project = projects.find((p) => p.key === copy.projectKey && p.teamId === teamId);
    if (!template?.template || !project) {
      log.warn(`copy of @${copy.template} into ${copy.projectKey}: template or project missing`);
      continue;
    }
    const suffix = `-${copy.projectKey.toLowerCase()}`;
    const handle = `${template.username.slice(0, 64 - suffix.length)}${suffix}`;
    if (byHandle(agents, handle)) {
      log.ok(`copy @${handle}`);
      continue;
    }
    await log.write(`copy @${copy.template} into ${copy.projectKey} (@${handle})`, () =>
      log.api('POST', `/teams/${teamId}/ai-agents/${template.id}/copy`, { projectId: project.id }),
    );
  }
}

async function ensureOrg(log: SyncLog, teamId: number): Promise<void> {
  log.log('\n== Coordinator skills and the family department ==');
  const agents = await log.api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
  const skillIds = await teamSkillIds(log, teamId);
  for (const coordinator of agents.filter((a) => /^[a-z0-9][a-z0-9_-]*-koordinator$/i.test(a.username))) {
    await addAgentSkills(log, teamId, coordinator, [...POOL_COORDINATOR_SKILLS], skillIds);
  }
  const org = await log.api<Organization>('GET', `/teams/${teamId}/organization`);
  let department = org.departments.find((d) => d.name === FAMILY_DEPARTMENT.name);
  if (department) log.ok(`department "${department.name}"`);
  else {
    department =
      (await log.write(`create department "${FAMILY_DEPARTMENT.name}"`, () =>
        log.api<{ id: number; name: string }>(
          'POST',
          `/teams/${teamId}/organization/departments`,
          FAMILY_DEPARTMENT,
        ),
      )) ?? undefined;
    if (!department) return;
  }
  for (const handle of ['fam-koordinator', 'priv-koordinator']) {
    const current = org.agents.find((a) => a.username === handle);
    if (!current) {
      log.warn(`${handle} not found`);
      continue;
    }
    if (current.departmentId === department.id) {
      log.ok(`${handle} in "${department.name}"`);
      continue;
    }
    // The PUT overwrites department, reporting line, role title and runtime reference,
    // so every field goes back as it is.
    await log.write(`assign ${handle} to "${department.name}"`, () =>
      log.api('PUT', `/teams/${teamId}/organization/agents/${current.id}`, {
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

async function ensureGoals(log: SyncLog, teamId: number): Promise<void> {
  log.log('\n== Roadmap goals ==');
  const org = await log.api<Organization>('GET', `/teams/${teamId}/organization`);
  const department = org.departments[0];
  for (const goal of ROADMAP_GOALS) {
    if (org.goals.some((g) => g.title === goal.title)) {
      log.ok(`goal "${goal.title}"`);
      continue;
    }
    await log.write(`create goal "${goal.title}"`, () =>
      log.api('POST', `/teams/${teamId}/organization/goals`, {
        title: goal.title,
        description: goal.description,
        departmentId: department?.id ?? null,
        status: 'active',
      }),
    );
  }
}

export interface PoolRunOptions {
  bundle: TemplateBundle;
  dryRun?: boolean;
  update?: boolean;
  sections?: Section[];
  teamId?: number;
}

export async function runAgentPool(
  options: PoolRunOptions,
  send: Transport,
  echo: (line: string) => void = () => {},
): Promise<{ lines: string[]; written: number; drift: number; warnings: number }> {
  const sections = new Set<Section>(options.sections ?? DEFAULT_SECTIONS);
  for (const section of sections) {
    if (!SECTIONS.includes(section)) throw new Error(`Unknown section "${section}"`);
  }
  const problems = validateBundle(options.bundle);
  if (problems.length > 0) throw new Error(`Invalid bundle:\n- ${problems.join('\n- ')}`);
  const log = new SyncLog(send, { dryRun: !!options.dryRun, update: !!options.update }, echo);
  log.log(
    `Helena agent pool — ${log.opts.dryRun ? 'DRY RUN (no writes)' : 'LIVE (writes)'}` +
      `${log.opts.update ? ', update' : ''}; sections: ${[...sections].join(', ')}`,
  );
  const teamId = await resolveTeam(log, options.teamId);
  if (sections.has('bundle')) await importBundle(log, teamId, options.bundle);
  if (sections.has('agents')) await ensureRunningAgents(log, teamId);
  if (sections.has('copies')) await ensureCopies(log, teamId);
  if (sections.has('org')) await ensureOrg(log, teamId);
  if (sections.has('goals')) await ensureGoals(log, teamId);
  if (sections.has('report')) await reportTemplates(log, teamId);
  log.log(`\n== Summary ==\n${log.summary()}`);
  return { lines: log.lines, written: log.written, drift: log.drift, warnings: log.warnings };
}
