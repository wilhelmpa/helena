import {
  agentChatMessage,
  agentUsage,
  aiAgent,
  browserGatewayEvent,
  db,
  helenaBrowserTaskRun,
  integrationCredential,
  user,
} from '@repo/db';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { HOME_SLUG, projectSlug } from '#shared/agent-socket';
import { isHomeAgent } from '#modules/agents/core/home-agent';
import { getAgentInProject, isTriggerableBy, listAgents } from '#modules/agents/core/service';
import { sendMessage } from '#modules/agents/chat/service';
import { priceRows } from '#modules/agents/usage/service';
import { browserGatewayEnabledForAgent } from '#modules/agent-browser-gateway/service';
import { loadConnection } from './connection';
import { effectiveBrowserControl } from './settings';
import {
  expireStaleTasks,
  newTaskToken,
  taskCostEur,
  TASK_TOKEN_TTL_MS,
  type TaskRow,
} from './runs';
import { postToRouter } from './router-client';

// Browser 2.0 (docs/helena-decisions/browser-task.md §3.5): the owner's test area. A run is a
// row of helena_browser_task_run with source 'lab':
// - 'decision': the gateway runs browser_task on the project browser, as the chosen agent (its
//   lock name, Autopilot level and approvals), with the connection the owner picked;
// - 'standard': the goal goes to the chosen agent as a chat message and it works with the step
//   tools as always — the baseline "wie bisher";
// - 'jev-browser': the unchanged jev-browser harness in a throwaway browser, its System One calls
//   through Helena's proxy.

export interface LabScope {
  teamId: number;
  // Null for Home's own browser.
  project: { id: number; key: string } | null;
}

export type LabBackend = 'decision' | 'standard' | 'jev-browser';

export interface LabRunInput {
  backend: LabBackend;
  agentId: number;
  credentialId?: number | null;
  policy?: 'auto' | 'jev' | 'laya';
  goal: string;
  values?: Record<string, string>;
  startUrl?: string | null;
  mode?: 'read' | 'act';
  maxSteps?: number;
}

export interface LabRunView {
  id: number;
  source: string;
  kind: string;
  backend: string;
  backendLabel: string;
  provider: string | null;
  policy: string | null;
  modelConfigured: string | null;
  modelReported: string | null;
  goal: string;
  mode: string;
  maxSteps: number;
  startUrl: string | null;
  valueKeys: string[];
  status: string;
  summary: string | null;
  steps: unknown[];
  result: Record<string, unknown> | null;
  decisions: number;
  inputTokens: number;
  outputTokens: number;
  decisionMs: number;
  durationMs: number | null;
  costEur: number | null;
  agentId: number | null;
  agentName: string | null;
  chatThreadId: string | null;
  finalFrame: string | null;
  createdAt: string;
  finishedAt: string | null;
}

function slugOf(scope: LabScope): string {
  return scope.project ? projectSlug(scope.project.key) : HOME_SLUG;
}

function scopeWhere(scope: LabScope) {
  return and(
    eq(helenaBrowserTaskRun.teamId, scope.teamId),
    scope.project
      ? eq(helenaBrowserTaskRun.projectId, scope.project.id)
      : isNull(helenaBrowserTaskRun.projectId),
  );
}

// The agents a test may run as: the project's agents that have the project browser; for Home's
// browser the Home-Master.
export async function labAgents(
  scope: LabScope,
): Promise<{ id: number; name: string; username: string }[]> {
  const agents = scope.project
    ? await listAgents(scope.teamId, scope.project.id)
    : (await listAgents(scope.teamId)).filter((agent) => isHomeAgent(agent.username));
  const out: { id: number; name: string; username: string }[] = [];
  for (const agent of agents) {
    if (await browserGatewayEnabledForAgent(agent.id, agent.teamId)) {
      out.push({ id: agent.id, name: agent.name, username: agent.username });
    }
  }
  return out;
}

// The decision model connections usable here: the team's, for the whole team or this project.
export async function labConnections(scope: LabScope) {
  const rows = await db
    .select({
      id: integrationCredential.id,
      label: integrationCredential.label,
      projectId: integrationCredential.projectId,
      redacted: integrationCredential.redacted,
      status: integrationCredential.status,
    })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, scope.teamId),
        eq(integrationCredential.integrationKey, 'decision_model'),
        scope.project
          ? or(
              isNull(integrationCredential.projectId),
              eq(integrationCredential.projectId, scope.project.id),
            )
          : isNull(integrationCredential.projectId),
      ),
    )
    .orderBy(integrationCredential.label);
  return rows.map((row) => {
    const readable = (row.redacted ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      label: row.label ?? '',
      provider: typeof readable.provider === 'string' ? readable.provider : null,
      model: typeof readable.model === 'string' ? readable.model : null,
      baseUrl: typeof readable.baseUrl === 'string' ? readable.baseUrl : null,
      keySource: readable.keySource === 'local-laya' ? 'local-laya' : 'stored',
      hasKey: readable.value === true || readable.keySource === 'local-laya',
      status: row.status,
    };
  });
}

function valuesOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    if (!key.trim() || key.length > 60 || typeof item !== 'string' || item.length > 2000) {
      throw new HttpError(
        400,
        'Every value needs a short name and a text of at most 2000 characters.',
      );
    }
    out[key.trim()] = item;
  }
  return out;
}

function standardPrompt(input: LabRunInput, values: Record<string, string>): string {
  const lines = [
    'Browser-Test aus Browser 2.0 (Vergleich „Standard wie bisher“):',
    'Erledige im Projekt-Browser diese Aufgabe Schritt für Schritt mit den Einzelschritt-Werkzeugen',
    '(browser_snapshot, browser_click, browser_type …), nicht mit browser_task:',
    '',
    input.goal.trim(),
  ];
  if (input.startUrl) lines.push('', `Start-Adresse: ${input.startUrl}`);
  const entries = Object.entries(values);
  if (entries.length)
    lines.push('', 'Werte:', ...entries.map(([key, value]) => `- ${key}: ${value}`));
  if (input.mode === 'read') lines.push('', 'Nur ansehen: nichts eintippen, nichts absenden.');
  lines.push(
    '',
    'Antworte am Ende in einem Satz, ob es geklappt hat und wo der Browser jetzt steht.',
  );
  return lines.join('\n');
}

export async function startLabRun(
  caller: { id: string },
  scope: LabScope,
  input: LabRunInput,
): Promise<LabRunView> {
  const goal = input.goal?.trim();
  if (!goal || goal.length > 1000)
    throw new HttpError(400, 'Describe the task (at most 1000 characters).');
  const values = valuesOf(input.values);
  const mode = input.mode === 'read' ? 'read' : 'act';
  const maxSteps = Math.max(1, Math.min(60, Math.floor(input.maxSteps ?? 20)));
  const agents = await labAgents(scope);
  const chosen = agents.find((agent) => agent.id === input.agentId);
  if (!chosen)
    throw new HttpError(400, 'Choose an agent of this project that has the project browser.');
  const startUrl = input.startUrl?.trim() || null;
  if (startUrl && !/^https?:\/\//i.test(startUrl))
    throw new HttpError(400, 'The start address must be http(s).');

  const base = {
    teamId: scope.teamId,
    projectId: scope.project?.id ?? null,
    agentId: chosen.id,
    source: 'lab' as const,
    kind: 'task' as const,
    goal,
    mode,
    maxSteps,
    startUrl,
    valueKeys: Object.keys(values),
    createdBy: caller.id,
  };

  if (input.backend === 'standard') {
    if (!scope.project)
      throw new HttpError(400, "Standard runs go through a project agent's chat.");
    const agent = await getAgentInProject(chosen.id, scope.project.id);
    if (!agent) throw new HttpError(400, 'The agent does not work in this project.');
    if (!isTriggerableBy(agent, caller.id))
      throw new HttpError(403, 'This agent only takes tasks from its owner.');
    const sent = await sendMessage({
      agentId: agent.id,
      userId: caller.id,
      projectId: scope.project.id,
      prompt: standardPrompt({ ...input, goal, mode }, values),
      maxConcurrentChats: agent.maxConcurrentChats,
    });
    if (!sent) throw new HttpError(409, 'The chat message could not be sent.');
    const [row] = await db
      .insert(helenaBrowserTaskRun)
      .values({
        ...base,
        backend: 'standard',
        backendLabel: `Standard (${chosen.name})`,
        modelConfigured: agent.model,
        status: 'running',
        chatMessageId: sent.messageId,
        chatThreadId: sent.threadId,
        startedAt: new Date(),
      })
      .returning();
    return view(row!, chosen.name);
  }

  const control = await effectiveBrowserControl({
    teamId: scope.teamId,
    projectId: scope.project?.id ?? null,
  });
  const credentialId = input.credentialId ?? control.connection?.credentialId ?? null;
  if (!credentialId) throw new HttpError(409, 'no_connection');
  const connection = await loadConnection(credentialId);
  if (
    !connection ||
    connection.teamId !== scope.teamId ||
    (connection.projectId !== null && connection.projectId !== (scope.project?.id ?? -1))
  ) {
    throw new HttpError(400, 'That decision model connection is not one of this project.');
  }
  const policy = input.policy && input.policy !== 'auto' ? input.policy : connection.backend.policy;
  const { token, hash } = newTaskToken();
  const [row] = await db
    .insert(helenaBrowserTaskRun)
    .values({
      ...base,
      backend: input.backend === 'jev-browser' ? 'jev-browser' : 'decision',
      credentialId: connection.credentialId,
      backendLabel:
        input.backend === 'jev-browser'
          ? `jev-browser · ${connection.label}`
          : connection.label || connection.backend.id,
      provider: connection.backend.providerName,
      policy: input.backend === 'jev-browser' ? null : policy,
      modelConfigured: connection.model,
      status: 'queued',
      tokenHash: hash,
      tokenExpiresAt: new Date(Date.now() + TASK_TOKEN_TTL_MS),
    })
    .returning();
  try {
    if (input.backend === 'jev-browser') {
      await postToRouter('/internal/gateway/jev-browser', {
        slug: slugOf(scope),
        token,
        model: connection.model,
        goal,
        values,
        startUrl,
        maxSteps,
        allowIrreversible: false,
      });
    } else {
      await postToRouter('/internal/gateway/lab', {
        slug: slugOf(scope),
        labKey: `lab:${token}`,
        args: { goal, values, ...(startUrl ? { startUrl } : {}), maxSteps, mode },
      });
    }
  } catch (error) {
    const [failed] = await db
      .update(helenaBrowserTaskRun)
      .set({
        status: 'error',
        summary:
          error instanceof Error
            ? error.message.slice(0, 300)
            : 'The browser router did not start the run.',
        finishedAt: new Date(),
        tokenExpiresAt: new Date(),
      })
      .where(eq(helenaBrowserTaskRun.id, row!.id))
      .returning();
    return view(failed!, chosen.name);
  }
  return view(row!, chosen.name);
}

// A Standard run follows its chat answer: done when the agent answered, with the browser actions
// it took meanwhile and the tokens its answer cost.
async function syncStandard(row: TaskRow): Promise<TaskRow> {
  if (row.backend !== 'standard' || row.finishedAt || !row.chatMessageId) return row;
  const [message] = await db
    .select({
      status: agentChatMessage.status,
      content: agentChatMessage.content,
      finishedAt: agentChatMessage.finishedAt,
    })
    .from(agentChatMessage)
    .where(eq(agentChatMessage.id, row.chatMessageId));
  if (!message) return row;
  const until = message.finishedAt ?? new Date();
  const events = row.agentId
    ? await db
        .select({
          tool: browserGatewayEvent.tool,
          target: browserGatewayEvent.target,
          category: browserGatewayEvent.category,
        })
        .from(browserGatewayEvent)
        .where(
          and(
            eq(browserGatewayEvent.agentId, row.agentId),
            row.projectId
              ? eq(browserGatewayEvent.projectId, row.projectId)
              : isNull(browserGatewayEvent.projectId),
            gte(browserGatewayEvent.createdAt, row.createdAt),
            lte(browserGatewayEvent.createdAt, until),
          ),
        )
        .orderBy(browserGatewayEvent.id)
        .limit(80)
    : [];
  const steps = events.map((event, index) => ({
    n: index + 1,
    operation: event.tool.replace(/^browser_/, '').toUpperCase(),
    element: event.target,
    category: event.category,
    outcome: 'done',
  }));
  const usage = await db
    .select({
      model: agentUsage.model,
      provider: agentUsage.provider,
      inputTokens: sql<number>`sum(${agentUsage.inputTokens})::bigint`,
      outputTokens: sql<number>`sum(${agentUsage.outputTokens})::bigint`,
    })
    .from(agentUsage)
    .where(
      and(
        eq(agentUsage.chatMessageId, row.chatMessageId),
        inArray(agentUsage.kind, ['chat', 'tool']),
      ),
    )
    .groupBy(agentUsage.model, agentUsage.provider);
  const finished = ['success', 'failed', 'canceled'].includes(message.status);
  const [updated] = await db
    .update(helenaBrowserTaskRun)
    .set({
      steps,
      inputTokens: usage.reduce((sum, u) => sum + Number(u.inputTokens ?? 0), 0),
      outputTokens: usage.reduce((sum, u) => sum + Number(u.outputTokens ?? 0), 0),
      modelReported: usage[0]?.model ?? row.modelReported,
      provider: usage[0]?.provider ?? row.provider,
      ...(finished
        ? {
            status:
              message.status === 'success'
                ? 'likely_done'
                : message.status === 'failed'
                  ? 'error'
                  : 'cancelled',
            summary: message.content.trim().slice(0, 500) || null,
            durationMs: until.getTime() - row.createdAt.getTime(),
            finishedAt: until,
          }
        : {}),
    })
    .where(eq(helenaBrowserTaskRun.id, row.id))
    .returning();
  return updated ?? row;
}

async function standardCost(row: TaskRow): Promise<number | null> {
  if (!row.chatMessageId) return null;
  const rows = await db
    .select({
      model: agentUsage.model,
      provider: agentUsage.provider,
      inputTokens: agentUsage.inputTokens,
      outputTokens: agentUsage.outputTokens,
      cacheReadTokens: agentUsage.cacheReadTokens,
      cacheWriteTokens: agentUsage.cacheWriteTokens,
      reasoningTokens: agentUsage.reasoningTokens,
    })
    .from(agentUsage)
    .where(eq(agentUsage.chatMessageId, row.chatMessageId));
  if (rows.length === 0) return null;
  const priced = await priceRows(rows);
  if (priced.some((entry) => entry.costEur === null)) return null;
  return priced.reduce((sum, entry) => sum + (entry.costEur ?? 0), 0);
}

async function view(
  row: TaskRow,
  agentName?: string | null,
  withFrame = false,
): Promise<LabRunView> {
  let name = agentName ?? null;
  if (name === undefined || name === null) {
    if (row.agentId) {
      const [agent] = await db
        .select({ name: user.name })
        .from(aiAgent)
        .innerJoin(user, eq(user.id, aiAgent.userId))
        .where(eq(aiAgent.id, row.agentId));
      name = agent?.name ?? null;
    }
  }
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    backend: row.backend,
    backendLabel: row.backendLabel,
    provider: row.provider,
    policy: row.policy,
    modelConfigured: row.modelConfigured,
    modelReported: row.modelReported,
    goal: row.goal,
    mode: row.mode,
    maxSteps: row.maxSteps,
    startUrl: row.startUrl,
    valueKeys: row.valueKeys ?? [],
    status: row.status,
    summary: row.summary,
    steps: row.steps ?? [],
    result: (row.result as Record<string, unknown> | null) ?? null,
    decisions: row.decisions,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    decisionMs: row.decisionMs,
    durationMs: row.durationMs,
    costEur: row.backend === 'standard' ? await standardCost(row) : await taskCostEur(row),
    agentId: row.agentId,
    agentName: name,
    chatThreadId: row.chatThreadId,
    finalFrame: withFrame ? row.finalFrame : null,
    createdAt: iso(row.createdAt),
    finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
  };
}

export async function listLabRuns(scope: LabScope, limit = 30): Promise<LabRunView[]> {
  await expireStaleTasks();
  const rows = await db
    .select()
    .from(helenaBrowserTaskRun)
    .where(and(scopeWhere(scope), eq(helenaBrowserTaskRun.kind, 'task')))
    .orderBy(desc(helenaBrowserTaskRun.id))
    .limit(Math.max(1, Math.min(100, limit)));
  const synced = await Promise.all(rows.map(syncStandard));
  return Promise.all(synced.map((row) => view(row)));
}

export async function getLabRun(scope: LabScope, id: number): Promise<LabRunView> {
  const [row] = await db
    .select()
    .from(helenaBrowserTaskRun)
    .where(and(scopeWhere(scope), eq(helenaBrowserTaskRun.id, id)));
  if (!row) throw new HttpError(404, 'Run not found');
  return view(await syncStandard(row), null, true);
}

export async function cancelLabRun(scope: LabScope, id: number): Promise<LabRunView> {
  const [row] = await db
    .update(helenaBrowserTaskRun)
    .set({ cancelledAt: new Date() })
    .where(
      and(
        scopeWhere(scope),
        eq(helenaBrowserTaskRun.id, id),
        isNull(helenaBrowserTaskRun.finishedAt),
      ),
    )
    .returning();
  if (!row) return getLabRun(scope, id);
  if (row.backend === 'standard' || row.status === 'queued') {
    const [ended] = await db
      .update(helenaBrowserTaskRun)
      .set({ status: 'cancelled', finishedAt: new Date(), tokenExpiresAt: new Date() })
      .where(eq(helenaBrowserTaskRun.id, row.id))
      .returning();
    return view(ended!);
  }
  return view(row);
}
