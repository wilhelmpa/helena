#!/usr/bin/env bun
/**
 * setup-agent-pool.ts — configuration as code for Helena's agent pool.
 *
 * Sets up, through Helena's own HTTP API (never the database directly): the curated
 * skills of docs/volition-agent-pool-research.md Section A, the 10 agent templates of
 * Section B, the project copies that close the gaps of Section C, the "Familie &
 * Privat" department, the Shopify Dev MCP server (read-only, no mutations) on
 * coder-verve, and goals for volition-hub-plan.md's roadmap phases.
 *
 * Idempotent: every step reads the current state first and only writes what is
 * missing or different. Running it twice in a row produces "already …" on the second
 * run, nothing more. `--dry-run` performs no write at all — it only prints what it
 * would do.
 *
 * Auth: a *personal* API key (Settings → your account → API keys in Helena), passed as
 * HELENA_API_KEY. This is the mechanism better-auth's apiKey plugin already exposes
 * (enableSessionForAPIKeys): the key resolves to the owner's own session, so every
 * call runs with the owner's permissions — no separate service-account concept is
 * needed and none is invented here. The key is read once, sent as the x-api-key
 * header, and never printed.
 *
 * Usage:
 *   HELENA_API_KEY=itp_... bun deployment/volition-stack/scripts/setup-agent-pool.ts [--dry-run] [--base-url=http://localhost:3000] [--team-key=PRIV]
 *
 * The script works on the first team the caller belongs to unless --team-key selects
 * a project whose team to use instead (handy when an account has more than one team,
 * not the case on the live single-team instance today).
 */

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const baseUrlArg = args.find((a) => a.startsWith('--base-url='));
const BASE_URL = (baseUrlArg ? baseUrlArg.slice('--base-url='.length) : 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const teamKeyArg = args.find((a) => a.startsWith('--team-key='));
const TEAM_PROJECT_KEY = teamKeyArg ? teamKeyArg.slice('--team-key='.length) : null;

const API_KEY = process.env.HELENA_API_KEY;
if (!API_KEY) {
  console.error(
    'HELENA_API_KEY is not set. Create a personal API key in Helena (Settings → your ' +
      'account → API keys) and pass it as HELENA_API_KEY. Refusing to run without it.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Small HTTP client and console reporting
// ---------------------------------------------------------------------------

let created = 0;
let updated = 0;
let skipped = 0;

function log(line: string): void {
  console.log(line);
}

function plan(line: string): void {
  console.log(`${DRY_RUN ? '[DRY-RUN] would' : '[DOING]'} ${line}`);
}

function already(line: string): void {
  skipped += 1;
  console.log(`[OK] already ${line}`);
}

async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'x-api-key': API_KEY!,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// A write the caller only performs when not in --dry-run. Always returns the id it
// would act on (or did act on), so the rest of the script can keep going in dry-run
// mode as if the write had happened — every "ensure" below reads that id back from a
// GET afterwards only when it is not in dry-run, and otherwise assumes -1 (unused,
// since nothing downstream needs the real id of a thing dry-run only pretended to
// create).
async function write<T>(description: string, fn: () => Promise<T>): Promise<T | null> {
  plan(description);
  if (DRY_RUN) return null;
  const result = await fn();
  created += 1;
  return result;
}

// ---------------------------------------------------------------------------
// Team and project discovery
// ---------------------------------------------------------------------------

interface ProjectSummary {
  id: number;
  key: string;
  name: string;
  teamId: number;
}

async function resolveTeamAndProjects(): Promise<{ teamId: number; projects: ProjectSummary[] }> {
  const projects = await api<ProjectSummary[]>('GET', '/projects');
  if (projects.length === 0) {
    throw new Error(
      'No projects visible to this API key. Create PRIV/FAM/VOL/VERVE first, or check the key.',
    );
  }
  const teamId = TEAM_PROJECT_KEY
    ? projects.find((p) => p.key === TEAM_PROJECT_KEY)?.teamId
    : projects[0]!.teamId;
  if (teamId == null) throw new Error(`--team-key=${TEAM_PROJECT_KEY} matches no project`);
  return { teamId, projects: projects.filter((p) => p.teamId === teamId) };
}

function projectId(projects: ProjectSummary[], key: string): number {
  const project = projects.find((p) => p.key === key);
  if (!project) throw new Error(`Project ${key} not found in this team — create it first`);
  return project.id;
}

// ---------------------------------------------------------------------------
// Section A: curated skills
// ---------------------------------------------------------------------------

// One row per skill this script wants present. `key` is a short handle used only in
// this script's own template tables below; `name`/`sourceUrl` are what Helena's skill
// library actually stores (matched by sourceUrl, since GitHub source is unambiguous
// and survives a SKILL.md rename). Every entry here has a clear license and needs no
// script to be useful, matching the research doc's Section A recommendations and the
// "Ja" verdicts: the existing 15 obra/superpowers skills (already live, listed so the
// template tables below can reference them) plus 7 new ones. Only skill folders, never
// whole-repo installs — Helena's importer only reads SKILL.md and the markdown it
// references; scripts a folder ships are skipped automatically.
interface SkillSeed {
  key: string;
  sourceUrl: string;
  license: string;
}

const SUPERPOWERS_COMMIT = '5bf4e78011075bcfc0dc295f0724994cd123ee71';
const superpowers = (skill: string): string =>
  `https://github.com/obra/superpowers/tree/${SUPERPOWERS_COMMIT}/skills/${skill}`;

const EXISTING_SKILLS: SkillSeed[] = [
  'brainstorming',
  'diagnosing-superpowers',
  'dispatching-parallel-agents',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'systematic-debugging',
  'using-superpowers',
  'writing-skills',
  'executing-plans',
  'test-driven-development',
  'using-git-worktrees',
  'verification-before-completion',
  'writing-plans',
  'subagent-driven-development',
].map((skill) => ({ key: skill, sourceUrl: superpowers(skill), license: 'MIT' }));

// Pinned to the commit read while researching this (34040c9, 23.09.2026): both folders
// carry their own LICENSE.txt (Apache-2.0), confirmed by fetching it directly — the
// repo's docx/pdf/pptx/xlsx skills are proprietary/source-available and are
// deliberately left out.
const ANTHROPIC_SKILLS_COMMIT = '34040c9c568585f6929bedeaad110ad08f079624';
const NEW_SKILLS: SkillSeed[] = [
  {
    key: 'skill-creator',
    sourceUrl: `https://github.com/anthropics/skills/tree/${ANTHROPIC_SKILLS_COMMIT}/skills/skill-creator`,
    license: 'Apache-2.0',
  },
  {
    key: 'webapp-testing',
    sourceUrl: `https://github.com/anthropics/skills/tree/${ANTHROPIC_SKILLS_COMMIT}/skills/webapp-testing`,
    license: 'Apache-2.0',
  },
  // petrkindlmann/qa-skills, MIT (confirmed via GitHub license API). Not pinned to a
  // commit — the owner can pin it once GitHub's rate limit allows resolving a SHA;
  // functionally identical, since Helena's importer follows the ref in the URL as-is.
  {
    key: 'playwright-automation',
    sourceUrl: 'https://github.com/petrkindlmann/qa-skills/tree/main/skills/playwright-automation',
    license: 'MIT',
  },
  {
    key: 'test-strategy',
    sourceUrl: 'https://github.com/petrkindlmann/qa-skills/tree/main/skills/test-strategy',
    license: 'MIT',
  },
  // AgriciDaniel/claude-seo, MIT. Core package only — the crawling extensions
  // (seo-dataforseo, seo-backlinks, …) are left out on purpose (Section A: "Ja als
  // Kernpaket ohne Crawling-Extensions").
  {
    key: 'seo-technical',
    sourceUrl: 'https://github.com/AgriciDaniel/claude-seo/tree/main/skills/seo-technical',
    license: 'MIT',
  },
  {
    key: 'seo-content',
    sourceUrl: 'https://github.com/AgriciDaniel/claude-seo/tree/main/skills/seo-content',
    license: 'MIT',
  },
  // nimrodfisher/data-analytics-skills, MIT — the "Datenanalyse" gap the research
  // doc's Section A did not yet cover; verified during this task's own research.
  {
    key: 'ab-test-analysis',
    sourceUrl:
      'https://github.com/nimrodfisher/data-analytics-skills/tree/main/03-data-analysis-investigation/ab-test-analysis',
    license: 'MIT',
  },
];

const ALL_SKILLS = [...EXISTING_SKILLS, ...NEW_SKILLS];

interface SkillRow {
  id: number;
  name: string;
  sourceUrl: string | null;
}

async function ensureSkills(teamId: number): Promise<Map<string, number>> {
  log('\n== Skills ==');
  const existing = await api<SkillRow[]>('GET', `/teams/${teamId}/agent-skills/options`);
  const byUrl = new Map(existing.filter((s) => s.sourceUrl).map((s) => [s.sourceUrl as string, s]));
  const ids = new Map<string, number>();
  for (const skill of ALL_SKILLS) {
    const found = byUrl.get(skill.sourceUrl);
    if (found) {
      already(`skill "${found.name}" (${skill.key}, ${skill.license})`);
      ids.set(skill.key, found.id);
      continue;
    }
    const result = await write(
      `import skill "${skill.key}" from ${skill.sourceUrl} (${skill.license})`,
      () =>
        api<{ id: number }>('POST', `/teams/${teamId}/agent-skills`, {
          source: 'github',
          sourceUrl: skill.sourceUrl,
        }),
    );
    if (result) ids.set(skill.key, result.id);
  }
  return ids;
}

// Adds skills to an agent's enabled set without ever removing one the owner already
// turned on by hand — the PUT route replaces the whole set, so this always reads
// first and only writes when the union differs from what is already there.
async function ensureAgentSkills(
  teamId: number,
  agentId: number,
  agentLabel: string,
  wantKeys: string[],
  skillIds: Map<string, number>,
): Promise<void> {
  const current = await api<{ id: number; name: string }[]>(
    'GET',
    `/teams/${teamId}/ai-agents/${agentId}/skills`,
  );
  const currentIds = new Set(current.map((s) => s.id));
  const wanted = wantKeys.map((key) => {
    const id = skillIds.get(key);
    if (id == null) throw new Error(`Skill "${key}" was not imported`);
    return id;
  });
  const missing = wanted.filter((id) => !currentIds.has(id));
  if (missing.length === 0) {
    already(`has every wanted skill: ${agentLabel}`);
    return;
  }
  const union = [...new Set([...currentIds, ...missing])];
  await write(`add ${missing.length} skill(s) to ${agentLabel}`, () =>
    api('PUT', `/teams/${teamId}/ai-agents/${agentId}/skills`, { skillIds: union }),
  );
}

// ---------------------------------------------------------------------------
// Agents: lookup, templates, copies
// ---------------------------------------------------------------------------

interface AgentRow {
  id: number;
  username: string;
  template: boolean;
  sourceTemplateId: number | null;
  dailyTokenCeiling: number | null;
  monthlyTokenCeiling: number | null;
}

async function listAgents(teamId: number): Promise<AgentRow[]> {
  return api<AgentRow[]>('GET', `/teams/${teamId}/ai-agents`);
}

function byUsername(agents: AgentRow[], username: string): AgentRow | undefined {
  return agents.find((a) => a.username.toLowerCase() === username.toLowerCase());
}

interface TemplateSeed {
  key: string;
  username: string;
  name: string;
  roleTitle: string;
  capabilities: string[];
  skills: string[];
  instructions?: string;
  dailyTokenCeiling?: number;
}

// The five templates the research doc's Section B/E lists as missing from the pool
// today (coder and content already exist live and are left alone — the script only
// creates what is missing, never overwrites a template the owner may have already
// hand-tuned). Model/reasoning are deliberately left unset: every agent in the live
// team has model = NULL today (checked read-only against a copy of the live metadata),
// relying on "Agent default"; this script follows that existing practice rather than
// inventing a model choice the owner has not made anywhere else.
const NEW_TEMPLATES: TemplateSeed[] = [
  {
    key: 'qa-tester',
    username: 'qa-tester',
    name: 'QA/Tester',
    roleTitle: 'QA/Tester',
    capabilities: ['qa', 'testing'],
    skills: [
      'test-driven-development',
      'systematic-debugging',
      'verification-before-completion',
      'webapp-testing',
      'playwright-automation',
      'test-strategy',
    ],
  },
  {
    key: 'research',
    username: 'research',
    name: 'Research',
    roleTitle: 'Research',
    capabilities: ['research'],
    skills: [
      'brainstorming',
      'dispatching-parallel-agents',
      'writing-plans',
      'verification-before-completion',
      'skill-creator',
      'ab-test-analysis',
    ],
  },
  {
    key: 'finance',
    username: 'finance',
    name: 'Finanzen/Belege',
    roleTitle: 'Finanzen/Belege',
    capabilities: ['finance', 'bookkeeping'],
    skills: [],
    instructions:
      'Liest Belege/Rechnungen aus den Projektdateien und legt Buchungsvorschläge als Notiz ' +
      'oder Ticket ab. Bucht und übermittelt nie selbst — jede Übermittlung oder Zahlung ' +
      'braucht eine Freigabe des Owners (kind "pay"). Kein Zugriff auf ELSTER-Zertifikat oder ' +
      'Bank-Zugangsdaten.',
    dailyTokenCeiling: 50_000,
  },
  {
    key: 'assistant',
    username: 'assistant',
    name: 'Persönlicher Assistent',
    roleTitle: 'Persönlicher Assistent',
    capabilities: ['assistant', 'personal'],
    skills: [],
    instructions:
      'Kalender, Mail-Entwürfe und private/familiäre Organisation. Mails werden nur als ' +
      'Entwurf vorbereitet, nie gesendet — Versand braucht immer eine Freigabe des Owners ' +
      '(kind "send").',
    dailyTokenCeiling: 50_000,
  },
  {
    key: 'browser-operator',
    username: 'browser-operator',
    name: 'Browser-Operator',
    roleTitle: 'Browser-Operator',
    capabilities: ['browser-operator'],
    skills: [],
    instructions:
      'Browser-lastige Aufgaben außerhalb von Coding-Sessions: Partner-Dashboards prüfen, ' +
      'Konkurrenzseiten ansehen, Formulare ausfüllen, Social-Entwürfe vorbereiten. Läuft erst ' +
      'produktiv, sobald der Projekt-Browser-Gateway (hub/agent-browser-mcp) live ist — bis ' +
      'dahin bewusst nur als Vorlage ohne aktive Kopie.',
  },
];

// id: -1 is a --dry-run placeholder for a template this run would create but has not
// (nothing calls the API with it) — it lets ensureCopies still report the copies that
// depend on it instead of silently skipping them because the id does not exist yet.
interface TemplateRef {
  id: number;
  username: string;
}

async function ensureTemplates(
  teamId: number,
  skillIds: Map<string, number>,
): Promise<Map<string, TemplateRef>> {
  log('\n== Templates ==');
  const refs = new Map<string, TemplateRef>();
  for (const key of ['coder', 'content']) {
    const agents = await listAgents(teamId);
    const found = byUsername(agents, key);
    if (found?.template) {
      already(`template "${key}" (existing, left untouched)`);
      refs.set(key, { id: found.id, username: found.username });
    } else {
      log(`[WARN] template "${key}" not found — expected it to exist already, skipping`);
    }
  }
  for (const seed of NEW_TEMPLATES) {
    const agents = await listAgents(teamId);
    const found = byUsername(agents, seed.username);
    if (found) {
      already(`template "${seed.username}"`);
      refs.set(seed.key, { id: found.id, username: found.username });
      if (!DRY_RUN) {
        await ensureAgentSkills(teamId, found.id, seed.username, seed.skills, skillIds);
      }
      continue;
    }
    const result = await write(
      `create template "${seed.username}" (${seed.name}): capabilities ${JSON.stringify(seed.capabilities)}, ${seed.skills.length} skill(s)`,
      async () => {
        const createdAgent = await api<{ agent: { id: number } }>(
          'POST',
          `/teams/${teamId}/ai-agents`,
          {
            name: seed.name,
            username: seed.username,
            kind: 'external',
            template: true,
            instructions: seed.instructions,
          },
        );
        const agentId = createdAgent.agent.id;
        // A template joins no project, so its organization role/capabilities are set
        // directly (setAgentAssignment), the same way copyTemplateIntoProject reads
        // them back off the template to seed a copy.
        await api('PUT', `/teams/${teamId}/organization/agents/${agentId}`, {
          role: 'specialist',
          roleTitle: seed.roleTitle,
          capabilities: seed.capabilities,
        });
        if (seed.skills.length > 0) {
          const skillIdList = seed.skills.map((k) => {
            const id = skillIds.get(k);
            if (id == null) throw new Error(`Skill "${k}" was not imported`);
            return id;
          });
          await api('PUT', `/teams/${teamId}/ai-agents/${agentId}/skills`, {
            skillIds: skillIdList,
          });
        }
        if (seed.dailyTokenCeiling != null) {
          await api('PUT', `/teams/${teamId}/organization/agents/${agentId}/token-ceilings`, {
            daily: seed.dailyTokenCeiling,
            monthly: null,
          });
        }
        return agentId;
      },
    );
    refs.set(seed.key, { id: result ?? -1, username: seed.username });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Section C: copies that close the gaps
// ---------------------------------------------------------------------------

interface CopySeed {
  templateKey: string;
  projectKey: string;
  // Why this project houses the copy, for the --dry-run output and the report —
  // named explicitly where the research doc left the choice to the owner.
  note?: string;
}

// VOL stands in for "Volition"/"team-weit" below: the data model has no project row
// for the company as a whole or for Home, only PRIV/FAM/VOL/VERVE, so a copy that the
// research doc scoped to "Volition" or "team-weit" needs a concrete project to attach
// to. This is an explicit choice the owner should confirm (see the report) — moving
// either copy to VERVE later is a one-click "reassign project" in the agent editor,
// nothing here depends on the choice being final.
const COPIES: CopySeed[] = [
  { templateKey: 'content', projectKey: 'VERVE' },
  { templateKey: 'qa-tester', projectKey: 'VOL' },
  { templateKey: 'qa-tester', projectKey: 'VERVE' },
  { templateKey: 'assistant', projectKey: 'FAM' },
  { templateKey: 'assistant', projectKey: 'PRIV' },
  { templateKey: 'finance', projectKey: 'PRIV' },
  {
    templateKey: 'finance',
    projectKey: 'VOL',
    note: "stands in for \"Volition\" company-wide — confirm or move to VERVE",
  },
  {
    templateKey: 'research',
    projectKey: 'VOL',
    note: 'stands in for "team-weit" — confirm or move, or copy into more projects later',
  },
  // browser-operator: template only, no copy — the Gateway (hub/agent-browser-mcp)
  // is not live yet, exactly as instructed.
];

async function ensureCopies(
  teamId: number,
  projects: ProjectSummary[],
  templates: Map<string, TemplateRef>,
): Promise<void> {
  log('\n== Project copies (closing the Section C gaps) ==');
  for (const copy of COPIES) {
    const template = templates.get(copy.templateKey);
    if (!template) {
      log(`[WARN] template "${copy.templateKey}" not available, skipping its ${copy.projectKey} copy`);
      continue;
    }
    const pid = projectId(projects, copy.projectKey);
    // The exact copy for *this* project: copyTemplateIntoProject's deterministic
    // username (template username + "-" + project key) tells copies of the same
    // template in different projects apart. sourceTemplateId (template-sync.ts) would
    // also identify "a copy of this template", but not which project it is in, so the
    // username is the check that actually answers "is VOL covered".
    const suffix = `-${copy.projectKey.toLowerCase()}`;
    const copyUsername = `${template.username.slice(0, 64 - suffix.length)}${suffix}`;
    const noteSuffix = copy.note ? ` — ${copy.note}` : '';
    if (template.id === -1) {
      // The template itself is only a --dry-run promise (id -1, not created yet), so
      // there is nothing to list or copy against; still report the copy that would
      // follow once it exists, which is the whole point of a dry run.
      plan(`copy "${copy.templateKey}" into ${copy.projectKey}${noteSuffix} (${copyUsername})`);
      continue;
    }
    const agents = await listAgents(teamId);
    const existingCopy = byUsername(agents, copyUsername);
    if (existingCopy) {
      already(`copy of "${copy.templateKey}" in ${copy.projectKey} (${copyUsername})`);
      continue;
    }
    await write(`copy "${copy.templateKey}" into ${copy.projectKey}${noteSuffix}`, () =>
      api('POST', `/teams/${teamId}/ai-agents/${template.id}/copy`, { projectId: pid }),
    );
  }
}

// ---------------------------------------------------------------------------
// Coordinators: additive skills, and the "Familie & Privat" department
// ---------------------------------------------------------------------------

async function ensureCoordinatorSkills(teamId: number, skillIds: Map<string, number>): Promise<void> {
  log('\n== Coordinator skills (additive, per Section B #2) ==');
  const wanted = [
    'brainstorming',
    'dispatching-parallel-agents',
    'writing-plans',
    'receiving-code-review',
    'requesting-code-review',
    'verification-before-completion',
  ];
  const agents = await listAgents(teamId);
  const coordinators = agents.filter((a) => /^hermes-.+-coordinator$/i.test(a.username));
  for (const coordinator of coordinators) {
    if (DRY_RUN) {
      plan(`add missing Section-B-#2 skills to ${coordinator.username} (checked in a real run)`);
      continue;
    }
    await ensureAgentSkills(teamId, coordinator.id, coordinator.username, wanted, skillIds);
  }
}

interface OrgAgentAssignment {
  departmentId: number | null;
  reportsToAgentId: number | null;
  roleTitle: string;
  role: string | null;
  capabilities: string[];
  runtimeAgentId: string | null;
}

async function ensureDepartment(teamId: number): Promise<void> {
  log('\n== "Familie & Privat" department ==');
  interface Department {
    id: number;
    name: string;
  }
  interface Organization {
    departments: Department[];
    agents: (AgentRow & OrgAgentAssignment)[];
  }
  const org = await api<Organization>('GET', `/teams/${teamId}/organization`);
  let department = org.departments.find((d) => d.name === 'Familie & Privat');
  if (department) {
    already('department "Familie & Privat"');
  } else {
    const result = await write('create department "Familie & Privat"', () =>
      api<Department>('POST', `/teams/${teamId}/organization/departments`, {
        name: 'Familie & Privat',
        description: 'FAM und PRIV: Familie und private Organisation, ohne Kundenbezug.',
      }),
    );
    if (!result) return; // dry-run: nothing to assign coordinators to yet
    department = result;
  }
  if (!department) return;
  for (const username of ['hermes-fam-coordinator', 'hermes-priv-coordinator']) {
    const current = org.agents.find((a) => a.username === username);
    if (!current) {
      log(`[WARN] ${username} not found, skipping department assignment`);
      continue;
    }
    if (current.departmentId === department.id) {
      already(`${username} already in "Familie & Privat"`);
      continue;
    }
    // setAgentAssignment overwrites departmentId/reportsToAgentId/roleTitle/
    // runtimeAgentId unconditionally (only role/capabilities are kept when omitted),
    // so every field is sent back to avoid silently clearing the others.
    await write(`assign ${username} to "Familie & Privat"`, () =>
      api('PUT', `/teams/${teamId}/organization/agents/${current.id}`, {
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

// ---------------------------------------------------------------------------
// Shopify Dev MCP -> coder-verve
// ---------------------------------------------------------------------------

async function ensureShopifyMcp(teamId: number): Promise<void> {
  log('\n== Shopify Dev MCP (read-only, no mutations) on coder-verve ==');
  interface McpServer {
    id: number;
    name: string;
  }
  const servers = await api<McpServer[]>('GET', `/teams/${teamId}/mcp-servers`);
  let server = servers.find((s) => s.name === 'shopify-dev-mcp');
  if (server) {
    already('MCP server "shopify-dev-mcp"');
  } else {
    const result = await write(
      'create team MCP server "shopify-dev-mcp" (npx @shopify/dev-mcp@latest, no --allow-mutations)',
      () =>
        api<McpServer>('POST', `/teams/${teamId}/mcp-servers`, {
          name: 'shopify-dev-mcp',
          description:
            'Durchsucht Shopify-Doku/API-Schemas, prüft GraphQL/Liquid/Extension-Code. Kein ' +
            'Schreibzugriff auf einen Store (kein --allow-mutations).',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@shopify/dev-mcp@latest'],
        }),
    );
    if (!result) return;
    server = result;
  }
  if (!server) return;
  const agents = await listAgents(teamId);
  const coderVerve = byUsername(agents, 'coder-verve');
  if (!coderVerve) {
    log('[WARN] coder-verve not found, skipping MCP assignment');
    return;
  }
  const current = await api<{ id: number }[]>(
    'GET',
    `/teams/${teamId}/ai-agents/${coderVerve.id}/mcp-servers`,
  );
  if (current.some((s) => s.id === server!.id)) {
    already('shopify-dev-mcp enabled on coder-verve');
    return;
  }
  const union = [...new Set([...current.map((s) => s.id), server.id])];
  await write('enable shopify-dev-mcp on coder-verve', () =>
    api('PUT', `/teams/${teamId}/ai-agents/${coderVerve.id}/mcp-servers`, { mcpServerIds: union }),
  );
}

// ---------------------------------------------------------------------------
// Goals from the volition-hub-plan.md roadmap phases
// ---------------------------------------------------------------------------

interface GoalSeed {
  title: string;
  description: string;
}

const ROADMAP_GOALS: GoalSeed[] = [
  {
    title: 'Phase 0 — Fundament: Sicherheit, natives Hosting, Backup',
    description:
      'kingston ist sicher, lokal vollständig nativ erreichbar, gesichert und reproduzierbar; ' +
      'der Internetzugang ist vorbereitet.',
  },
  {
    title: 'Phase 1 — Projekt-Lebenszyklus und Secrets',
    description:
      'Ein neues Projekt richtet alles ein, ein gelöschtes entfernt alles; ein Speicher für ' +
      'Maschinen-Secrets statt acht.',
  },
  {
    title: 'Phase 2 — Arbeitsplatz: Navigation, Panel, Terminal, Browser',
    description: 'Eine Navigation, ein geteiltes Werkzeug-Panel, echte Terminal-Tabs, ein reparierter Browser.',
  },
  {
    title: 'Phase 3 — Hermes vollständig integrieren',
    description: 'Chat mit Kontext, Freigaben und Rückfragen; eine Agent-Seite statt vier; Hermes als einzige Laufzeit.',
  },
  {
    title: 'Phase 4 — Orga, Orchestrierung, wiederkehrende Aufgaben',
    description:
      'Org-Chart als echte Grafik, agent-team sichtbar und steuerbar, Mastra als einziger ' +
      'Scheduler für fachliche Aufgaben.',
  },
  {
    title: 'Phase 5 — Mail',
    description: 'IMAP/SMTP, ein schneller Posteingang, Compose im geteilten Panel, Agenten schreiben nur Entwürfe.',
  },
  {
    title: 'Phase 6 — Planung: Bereiche, Projekt-Einstellungen, Home',
    description: 'Bereiche mit eigenen Boards, Einstellungen strikt pro Projekt, Home als konsolidierte Übersicht.',
  },
];

async function ensureGoals(teamId: number): Promise<void> {
  log('\n== Goals (volition-hub-plan.md roadmap phases) ==');
  interface Department {
    id: number;
    name: string;
  }
  interface Goal {
    id: number;
    title: string;
  }
  const org = await api<{ departments: Department[]; goals: Goal[] }>(
    'GET',
    `/teams/${teamId}/organization`,
  );
  const department = org.departments.find((d) => d.name === 'Volition');
  for (const goal of ROADMAP_GOALS) {
    if (org.goals.some((g) => g.title === goal.title)) {
      already(`goal "${goal.title}"`);
      continue;
    }
    await write(`create goal "${goal.title}"`, () =>
      api('POST', `/teams/${teamId}/organization/goals`, {
        title: goal.title,
        description: goal.description,
        departmentId: department?.id ?? null,
        status: 'active',
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`Helena agent pool setup — ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write)'}`);
  log(`Base URL: ${BASE_URL}`);

  const { teamId, projects } = await resolveTeamAndProjects();
  log(`Team ${teamId}, projects: ${projects.map((p) => p.key).join(', ')}`);

  const skillIds = await ensureSkills(teamId);
  const templateIds = await ensureTemplates(teamId, skillIds);
  await ensureCopies(teamId, projects, templateIds);
  await ensureCoordinatorSkills(teamId, skillIds);
  await ensureDepartment(teamId);
  await ensureShopifyMcp(teamId);
  await ensureGoals(teamId);

  log('\n== Summary ==');
  log(`${created} step(s) ${DRY_RUN ? 'would run' : 'ran'}, ${skipped} already in place.`);
  if (DRY_RUN) {
    log('Nothing was written. Re-run without --dry-run to apply.');
  }
}

main().catch((err) => {
  console.error('\nsetup-agent-pool failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
