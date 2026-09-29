// The practice test "Flash als Home" (docs/plan-lokal-halogen.md, Phase 1 point 7), reproducible:
// Qwen3.8-Flash-Next on Halogen acts as Helena's Home agent through Helena's MCP tools and sets
// up a test project from the owner's written spec (scenario.ts): project, agents, goals, tasks
// delegated to the agents, a routine; it checks the runs, fires the routine once and reports.
// Then the script checks what was created, counts tool errors, loops and time, removes the test
// project and its agents again, and writes a report.
//
// ONLY against a private test database: it empties the database first (resetDb, which refuses
// anything but NODE_ENV=test and a database whose name contains "test"). The Helena API runs in
// this process (no port, no runner); the model is reached over HTTP.
//
//   ~/agent-work/halogen1-dbrun.sh bun apps/api/src/scripts/flash-home/run.ts \
//     [--base http://127.0.0.1:8731/v1] [--model halogen-qwen3.8-flash-next] \
//     [--reasoning low] [--max-turns 40] [--minutes 20] [--json out.json] [--keep]
import { writeFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { auth } from '@repo/auth';
import {
  agentRun,
  aiAgent,
  db,
  helenaSchedule,
  initiative,
  issue,
  project,
  projectMember,
  user,
} from '@repo/db';
import { projectCoordinatorUsername } from '@repo/agent-naming';
import { app, authedApi } from '../../__tests__/helpers/app';
import { signUpTestUser } from '../../__tests__/helpers/auth';
import { resetDb } from '../../__tests__/helpers/db';
import { runToolLoop, toOpenAiTools, type Completion, type McpTool } from './loop';
import {
  HOME_SYSTEM,
  SCENARIO,
  checkScenario,
  scenarioPrompt,
  type ScenarioFacts,
} from './scenario';

// The tools a Home agent needs for this work, out of Helena's ~210: all of them together are
// ~680 KB of schemas, far more than a prompt should carry ("wenige gute Werkzeuge").
export const HOME_TOOLS = [
  'list_teams',
  'list_projects',
  'create_project',
  'get_project',
  'list_members',
  'list_roles',
  'list_role_options',
  'list_ai_agents',
  'get_ai_agent',
  'create_ai_agent',
  'update_ai_agent',
  'set_ai_agent_projects',
  'list_initiatives',
  'create_initiative',
  'list_goals',
  'link_project_goal',
  'create_issue',
  'update_issue',
  'list_issues',
  'get_issue_by_number',
  'add_comment',
  'list_routines',
  'create_routine',
  'run_routine',
  'list_routine_runs',
  'list_agent_runs',
  'get_agent_workload',
  'get_project_pulse',
] as const;

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? (process.argv[index + 1] ?? null) : null;
}

async function rpc(apiKey: string, method: string, params: Record<string, unknown> = {}) {
  const response = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const text = await response.text();
  const body = JSON.parse(text.includes('data: ') ? text.slice(text.indexOf('data: ') + 6) : text);
  if (body.error) throw new Error(`MCP ${method}: ${body.error.message ?? 'error'}`);
  return body.result;
}

async function readFacts(routineStarted = false): Promise<ScenarioFacts> {
  const [row] = await db
    .select({ id: project.id, key: project.key, name: project.name })
    .from(project)
    .where(eq(project.key, SCENARIO.project.key));
  const usernames = SCENARIO.agents.map((agent) => agent.username) as string[];
  // The project's agents, and any agent of the spec's names wherever it landed.
  const members = row
    ? (
        await db
          .select({ userId: projectMember.userId })
          .from(projectMember)
          .where(eq(projectMember.projectId, row.id))
      ).map((entry) => entry.userId)
    : [];
  const agentRows = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId, username: aiAgent.username, name: user.name })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId));
  // Helena gives every new project its own coordinator: not one of the model's.
  const coordinator = projectCoordinatorUsername(SCENARIO.project.key);
  const agents = [];
  for (const agent of agentRows) {
    if (agent.username === coordinator) continue;
    if (!members.includes(agent.userId) && !usernames.includes(agent.username)) continue;
    const projects = await db
      .select({ key: project.key })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .where(eq(projectMember.userId, agent.userId));
    agents.push({
      username: agent.username,
      name: agent.name,
      userId: agent.userId,
      projectKeys: projects.map((entry) => entry.key),
    });
  }
  const byUser = new Map(agents.map((agent) => [agent.userId, agent.username]));
  const byAgentId = new Map(agentRows.map((agent) => [agent.id, agent.username]));
  const goals = row
    ? (
        await db
          .select({ title: initiative.title })
          .from(initiative)
          .where(eq(initiative.projectId, row.id))
      ).map((entry) => entry.title)
    : [];
  const issues = row
    ? await db
        .select({ title: issue.title, delegate: issue.delegateUserId })
        .from(issue)
        .where(eq(issue.projectId, row.id))
    : [];
  const routines = row
    ? await db
        .select({
          title: helenaSchedule.title,
          cron: helenaSchedule.cron,
          timezone: helenaSchedule.timezone,
          agentId: helenaSchedule.agentId,
        })
        .from(helenaSchedule)
        .where(and(eq(helenaSchedule.projectId, row.id), eq(helenaSchedule.kind, 'routine')))
    : [];
  const routineTitles = routines.map((entry) => entry.title.toLowerCase());
  const runs = row
    ? await db.select({ id: agentRun.id }).from(agentRun).where(eq(agentRun.projectId, row.id))
    : [];
  return {
    project: row ?? null,
    agents,
    goals,
    // A routine's fire creates a task titled after the routine: that one is the fire.
    tasks: issues
      .filter((entry) => !routineTitles.includes(entry.title.toLowerCase()))
      .map((entry) => ({
        title: entry.title,
        delegateUsername: entry.delegate ? (byUser.get(entry.delegate) ?? null) : null,
      })),
    routines: routines.map((entry) => ({
      title: entry.title,
      cron: entry.cron,
      timezone: entry.timezone,
      agentUsername: entry.agentId ? (byAgentId.get(entry.agentId) ?? null) : null,
    })),
    runs: runs.length,
    // The fire's task, or (the engine does not run in this process) the fire started.
    routineFired:
      routineStarted || issues.some((entry) => routineTitles.includes(entry.title.toLowerCase())),
  };
}

// Removes the test project and the agents made for it, through the API as the owner would,
// and says whether anything is left.
async function removeTestProject(cookie: string): Promise<{ removed: boolean; left: string[] }> {
  const api = authedApi(cookie);
  const facts = await readFacts();
  const left: string[] = [];
  for (const agent of facts.agents) {
    const [row] = await db
      .select({ id: aiAgent.id, teamId: aiAgent.teamId })
      .from(aiAgent)
      .where(eq(aiAgent.userId, agent.userId));
    if (!row) continue;
    const deleted = await api
      .teams({ teamId: row.teamId })
      ['ai-agents']({ agentId: row.id })
      .delete();
    if (deleted.status >= 300) left.push(`agent ${agent.username}: HTTP ${deleted.status}`);
  }
  if (facts.project) {
    const deleted = await api.projects({ projectKey: facts.project.key }).delete();
    if (deleted.status >= 300) left.push(`project ${facts.project.key}: HTTP ${deleted.status}`);
  }
  const after = await readFacts();
  if (after.project) left.push(`project ${after.project.key} still there`);
  const agentsLeft = await db
    .select({ username: aiAgent.username })
    .from(aiAgent)
    .where(inArray(aiAgent.username, SCENARIO.agents.map((agent) => agent.username) as string[]));
  for (const agent of agentsLeft) left.push(`agent ${agent.username} still there`);
  return { removed: left.length === 0, left };
}

async function main() {
  const base = (arg('base') ?? 'http://127.0.0.1:8731/v1').replace(/\/+$/, '');
  const model = arg('model') ?? 'halogen-qwen3.8-flash-next';
  const reasoning = arg('reasoning') ?? 'low';
  const maxTurns = Number(arg('max-turns') ?? 40);
  const minutes = Number(arg('minutes') ?? 20);
  const out = arg('json');

  // Refuses anything but a test database (NODE_ENV=test, a name with "test").
  await resetDb();
  const owner = await signUpTestUser({ name: 'Inhaber Praxistest' });
  const key = await auth.api.createApiKey({ body: { userId: owner.userId, name: 'flash-home' } });
  const listed = (await rpc(key.key, 'tools/list')).tools as McpTool[];
  const wanted = new Set<string>(HOME_TOOLS);
  const tools = toOpenAiTools(listed.filter((tool) => wanted.has(tool.name)));
  const missing = HOME_TOOLS.filter((name) => !listed.some((tool) => tool.name === name));
  console.log(
    `Helena MCP: ${listed.length} tools, the Home test offers ${tools.length}` +
      ` (${Math.round(JSON.stringify(tools).length / 1024)} KB)${missing.length ? `; missing ${missing.join(', ')}` : ''}`,
  );

  const result = await runToolLoop({
    system: HOME_SYSTEM,
    prompt: scenarioPrompt(),
    tools,
    maxTurns,
    deadlineMs: minutes * 60_000,
    request: { model, temperature: 0, max_tokens: 4096, reasoning_effort: reasoning },
    async post(body) {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return (await response.json()) as Completion;
    },
    async callTool(name, args) {
      const answer = await rpc(key.key, 'tools/call', { name, arguments: args });
      const text = (answer.content ?? [])
        .map((part: { type?: string; text?: string }) => (part.type === 'text' ? part.text : ''))
        .join('\n');
      return { text, isError: answer.isError === true };
    },
  });

  const facts = await readFacts(
    result.toolCalls.some((entry) => entry.name === 'run_routine' && entry.ok),
  );
  const checks = checkScenario(facts, result.answer);
  const passed = checks.filter((check) => check.passed).length;
  const errors = result.toolCalls.filter((call) => !call.ok);
  const cleanup = process.argv.includes('--keep')
    ? { removed: false, left: ['kept (--keep)'] }
    : await removeTestProject(owner.cookie);

  console.log(
    `\n${model} as Home: ${passed}/${checks.length} checks, ${result.turns} turns, ` +
      `${result.toolCalls.length} tool calls (${errors.length} errors, ${result.loops} repeats), ` +
      `${Math.round(result.durationMs / 1000)} s, ${result.inputTokens} in / ${result.outputTokens} out tokens, ` +
      `stopped: ${result.stopped}${result.error ? ` (${result.error})` : ''}`,
  );
  for (const check of checks)
    console.log(`  ${check.passed ? 'ok  ' : 'FAIL'} ${check.id}: ${check.detail}`);
  for (const call of errors)
    console.log(`  tool error turn ${call.turn} ${call.name}: ${call.error}`);
  console.log(`  runs in the project: ${facts.runs}`);
  console.log(
    `  test project removed: ${cleanup.removed ? 'yes' : `no (${cleanup.left.join('; ')})`}`,
  );
  console.log(`\nStatusbericht:\n${result.answer}`);
  if (out) {
    await writeFile(
      out,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          model,
          base,
          reasoning,
          checks,
          facts,
          loop: result,
          cleanup,
        },
        null,
        2,
      ),
    );
  }
  process.exit(0);
}

await main();
