// The gateway side of browser_task, browser_check and browser_choose (docs/helena-decisions/
// browser-task.md §3.2): opens the task in Helena (which holds the backend and its key), runs the
// loop on the project browser, decides every action with Helena's policy exactly like the step
// tool it stands for, reports each step, and hands the agent a result it can continue from.

import type { ActionCategory } from '../agent-tool.ts';
import {
  HelenaApiError,
  type HelenaClient,
  type ResolveResult,
  type TaskStartResult,
} from '../helena-client.ts';
import type { GatewaySession, ToolOutput } from '../session-types.ts';
import { taskSuccess } from './success.ts';
import { brief, describe } from './policy-common.ts';
import { jevPolicy } from './policy-jev.ts';
import { readOnlyPage, runTask, runTaskPlan, type Authorization, type TaskDeps } from './loop.ts';
import {
  answerOf,
  DecisionError,
  type DecisionClient,
  type DecisionReply,
  type DecisionRequest,
} from './systemone.ts';
import type { DecisionPolicy } from './policy.ts';
import type { PageElement, PolicyKind, TaskMode, TaskPlanStep, TaskResult } from './types.ts';

// The snapshot an agent continues from after a hand-back (refs, capped).
export const HANDBACK_SNAPSHOT_CHARS = 12_000;
const MAX_VALUES = 30;

export function taskPlan(value: unknown): TaskPlanStep[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 12)
    throw new Error('plan needs 1–12 verified steps.');
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Each plan step needs goal and success.');
    const step = entry as Record<string, unknown>;
    if (
      Object.keys(step).some((key) => !['goal', 'success'].includes(key)) ||
      typeof step.goal !== 'string' ||
      !step.goal.trim() ||
      step.goal.length > 1000
    )
      throw new Error('Each plan step needs a short goal.');
    const success = taskSuccess(step.success);
    if (!success) throw new Error('Each plan step needs independent success criteria.');
    return { goal: step.goal.trim(), success };
  });
}

export class HelenaDecisionClient implements DecisionClient {
  #helena: HelenaClient;
  #token: string;
  constructor(helena: HelenaClient, token: string) {
    this.#helena = helena;
    this.#token = token;
  }
  async decide(request: DecisionRequest): Promise<DecisionReply> {
    try {
      return await this.#helena.systemOne({
        taskToken: this.#token,
        state: request.state,
        questions: request.questions,
      });
    } catch (error) {
      if (error instanceof HelenaApiError)
        throw new DecisionError(`http_${error.status}`, error.message);
      throw new DecisionError('unreachable', 'Ava did not answer.');
    }
  }
}

export function policyOf(_kind: PolicyKind, minConfidence: number | null): DecisionPolicy {
  const base = jevPolicy;
  return minConfidence !== null && minConfidence > 0 && minConfidence < 1
    ? { ...base, minTarget: minConfidence }
    : base;
}

export interface TaskRequest {
  tool: string;
  args: Record<string, unknown>;
  agentKey: string;
  runId?: number;
  messageId?: number;
}

export interface TaskContext {
  request: TaskRequest;
  slug: string;
  via: string;
  session: GatewaySession;
  helena: HelenaClient;
  resolved: ResolveResult;
  // The agent still holds the browser (touching its lock), false once the owner took over.
  holdsControl(): boolean;
  // Navigates to startUrl the way browser_navigate would (checks and policy done by the caller).
  navigate?(url: string): Promise<void>;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

export function taskValues(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('values must be an object of strings.');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_VALUES) throw new Error(`At most ${MAX_VALUES} values.`);
  const out: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!key.trim() || key.length > 60)
      throw new Error('Every value needs a short key (at most 60 characters).');
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      throw new Error(`values.${key.slice(0, 40)} must be a string.`);
    }
    const text = String(item);
    if (text.length > 2000)
      throw new Error(`values.${key.slice(0, 40)} is longer than 2000 characters.`);
    out[key.trim()] = text;
  }
  return out;
}

async function start(
  ctx: TaskContext,
  kind: 'task' | 'check' | 'choose',
  goal: string,
  mode: TaskMode,
  maxSteps: number,
) {
  try {
    return await ctx.helena.taskStart({
      agentKey: ctx.request.agentKey,
      projectSlug: ctx.slug,
      via: ctx.via,
      kind,
      goal,
      mode,
      maxSteps,
      startUrl: str(ctx.request.args, 'startUrl') ?? null,
      runId: ctx.request.runId,
      messageId: ctx.request.messageId,
    });
  } catch (error) {
    if (error instanceof HelenaApiError) throw new Error(error.message);
    throw new Error('Could not reach Ava.');
  }
}

function authorizer(ctx: TaskContext, taskToken?: string) {
  return async (step: {
    operation: string;
    element: PageElement | null;
    category: ActionCategory;
    origin: string;
    pagePath: string | null;
  }): Promise<Authorization> => {
    const target = `${step.operation}${step.element ? ` ${brief(step.element)}` : ''}`.slice(
      0,
      300,
    );
    try {
      const answer = await ctx.helena.decide({
        agentKey: ctx.request.agentKey,
        projectSlug: ctx.slug,
        via: ctx.via,
        tool: 'browser_task',
        taskToken,
        category: step.category,
        context: {
          origin: step.origin,
          target,
          element: step.element ? brief(step.element) : null,
          formAction: null,
          groundedElement:
            [step.element?.label, step.element?.text].filter(Boolean).join(' ') || null,
          pagePath: step.pagePath,
        },
        runId: ctx.request.runId,
        messageId: ctx.request.messageId,
      });
      if (answer.effect === 'allow') return { effect: 'allow' };
      if (answer.effect === 'needs-approval') {
        return {
          effect: 'needs-approval',
          reason: answer.reason ?? 'approval needed',
          approvalId: answer.approvalId ?? null,
        };
      }
      return { effect: 'deny', reason: answer.reason ?? `${step.category} actions` };
    } catch (error) {
      return {
        effect: 'deny',
        reason: error instanceof HelenaApiError ? error.message : 'Ava did not answer',
      };
    }
  };
}

const STATUS_LINE: Record<TaskResult['status'], string> = {
  done: 'done',
  likely_done: 'likely done — verify',
  needs_agent: 'handed back to you',
  needs_login: 'needs a sign-in',
  needs_confirmation: 'needs your confirmation',
  needs_approval: "needs the owner's approval",
  denied: 'not allowed',
  blocked: 'blocked',
  error: 'the page shows an error',
  stuck: 'stuck — handed back to you',
  max_steps: 'step budget used up',
  owner_took_over: 'the owner took over',
  backend_error: 'the decision backend failed',
  cancelled: 'cancelled',
};

export function formatTaskResult(
  result: TaskResult,
  backend: { label: string; model: string },
  snapshot: string,
): string {
  const seconds = (result.durationMs / 1000).toFixed(1);
  const lines = [
    '### Result',
    `- Status: ${result.status} (${STATUS_LINE[result.status]})`,
    `- ${result.summary}`,
    `- Steps: ${result.steps.length} in ${seconds} s; ${result.usage.calls} decisions by ${backend.label} (${result.usage.model ?? backend.model}), ${result.usage.inputTokens} input tokens`,
    `- Page: ${result.url}${result.title ? ` — "${result.title.slice(0, 120)}"` : ''}`,
  ];
  if (result.approvalId) lines.push(`- Freigaben #${result.approvalId}`);
  if (result.pending)
    lines.push(
      `- Stopped before: ${result.pending.operation} ${result.pending.element ?? ''}`.trimEnd(),
    );
  if (result.completedPlanSteps !== undefined)
    lines.push(
      `- Verified plan steps: ${result.completedPlanSteps}; failed attempts: ${result.failedAttempts ?? 0}${result.handoffWholeTask ? '; standard agent handles the whole task' : ''}`,
    );
  if (result.steps.length) {
    lines.push('### Steps');
    for (const step of result.steps) {
      const what = [
        step.operation,
        step.element,
        step.valueKey ? `← values.${step.valueKey}` : '',
        step.option ? `→ "${step.option}"` : '',
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(
        `${step.n}. ${what} (p ${step.probability}, ${step.decisionMs} ms) ${step.outcome === 'done' ? '' : `— ${step.outcome}`}`.trimEnd(),
      );
    }
  }
  if (result.status !== 'done' && result.candidates?.length) {
    lines.push(
      '### Candidates',
      ...result.candidates.map((c) => `- ${c.element} (p ${c.probability})`),
    );
  }
  if (result.status !== 'done' && snapshot) {
    lines.push(
      '### Snapshot',
      'Continue with the step tools on these refs:',
      '```yaml',
      snapshot,
      '```',
    );
  }
  return lines.join('\n');
}

// Accounting must not hold the browser handback when Helena or its transport stalls.
const TASK_WRITE_TIMEOUT_MS = 1000;
async function boundedTaskWrite<T>(
  write: (signal: AbortSignal) => Promise<T>,
  controller = new AbortController(),
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => write(controller.signal))
        .catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, TASK_WRITE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runTaskTool(ctx: TaskContext): Promise<ToolOutput> {
  const args = ctx.request.args;
  const goal = (str(args, 'goal') ?? '').trim().slice(0, 1000);
  if (!goal) throw new Error('goal is required: the outcome, in plain words.');
  const values = taskValues(args.values);
  const success = taskSuccess(args.success);
  const plan = taskPlan(args.plan);
  const failedAttempts =
    typeof args.failedAttempts === 'number' &&
    Number.isInteger(args.failedAttempts) &&
    args.failedAttempts >= 0 &&
    args.failedAttempts <= 1
      ? args.failedAttempts
      : 0;
  const mode: TaskMode = str(args, 'mode') === 'read' ? 'read' : 'act';
  const rawSteps =
    typeof args.maxSteps === 'number' && Number.isFinite(args.maxSteps) ? args.maxSteps : 20;
  const maxSteps = Math.max(1, Math.min(60, Math.floor(rawSteps)));
  const allowIrreversible = args.allowIrreversible === true;
  const opened: TaskStartResult = await start(ctx, 'task', goal, mode, maxSteps);
  const controller = new AbortController();
  const progressController = new AbortController();
  let progressWrites = Promise.resolve();
  let result: TaskResult;
  try {
    const startUrl = str(args, 'startUrl');
    if (startUrl && ctx.navigate) await ctx.navigate(startUrl);
    const taskInput = { goal, values, mode, maxSteps, allowIrreversible, success };
    const taskDeps: TaskDeps = {
      page: mode === 'read' ? readOnlyPage(ctx.session.taskPage()) : ctx.session.taskPage(),
      client: new HelenaDecisionClient(ctx.helena, opened.taskToken),
      policy: policyOf(opened.policy, opened.minConfidence),
      authorize: authorizer(ctx, opened.taskToken),
      holdsControl: ctx.holdsControl,
      signal: controller.signal,
      onProgress: (progress) => {
        progressWrites = progressWrites.then(async () => {
          if (progressController.signal.aborted) return;
          const answer = await ctx.helena
            .taskProgress(
              {
                taskToken: opened.taskToken,
                step: progress.step,
                usage: progress.usage,
              },
              progressController.signal,
            )
            .catch(() => null);
          if (answer?.cancelled) controller.abort();
        });
      },
    };
    result = plan
      ? await runTaskPlan({ ...taskInput, plan, failedAttempts }, taskDeps)
      : await runTask(taskInput, taskDeps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      status: 'error',
      summary: message.split('\n')[0]!.slice(0, 300),
      url: '',
      title: '',
      steps: [],
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, decisionMs: 0, model: null },
      durationMs: 0,
      confidence: null,
      doneScore: null,
    };
  }
  // Give queued step records a bounded chance to finish, then abort/skip outstanding
  // writes. The full local history still accompanies finish and the handback.
  await boundedTaskWrite(() => progressWrites, progressController);
  if (result.status === 'done') {
    const final = await boundedTaskWrite((signal) =>
      ctx.helena.taskProgress(
        { taskToken: opened.taskToken, step: null, usage: result.usage },
        signal,
      ),
    );
    if (!final || final.cancelled)
      result = {
        ...result,
        status: 'cancelled',
        summary:
          'The task was cancelled before completion was accepted. Inspect the current page before continuing.',
      };
  }
  const snapshot =
    result.status === 'done'
      ? ''
      : await ctx.session.agentSnapshot(HANDBACK_SNAPSHOT_CHARS).catch(() => '');
  await boundedTaskWrite((signal) =>
    ctx.helena.taskFinish({ taskToken: opened.taskToken, result }, signal),
  );
  return { text: formatTaskResult(result, opened, snapshot) };
}

async function pageState(ctx: TaskContext) {
  const observation = await ctx.session.taskPage().observe();
  return {
    page: {
      url: observation.url,
      title: observation.title,
      text: observation.text,
      ...(observation.dialogs.length ? { dialogs: observation.dialogs } : {}),
      elements: observation.elements.slice(0, 200).map(describe),
      ...(observation.repeated ? { repeated_elements: observation.repeated } : {}),
    },
  };
}

export async function runCheckTool(ctx: TaskContext): Promise<ToolOutput> {
  const question = (str(ctx.request.args, 'question') ?? '').trim().slice(0, 1000);
  if (!question) throw new Error('question is required.');
  const opened = await start(ctx, 'check', question, 'read', 1);
  const started = Date.now();
  const client = new HelenaDecisionClient(ctx.helena, opened.taskToken);
  const request = {
    state: await pageState(ctx),
    questions: { q: { type: 'noul' as const, instructions: `Answer about \`page\`: ${question}` } },
  };
  let reply: DecisionReply;
  try {
    reply = await client.decide(request);
  } catch (error) {
    await ctx.helena
      .taskFinish({ taskToken: opened.taskToken, result: { status: 'backend_error' } })
      .catch(() => {});
    throw error;
  }
  const p = answerOf(reply, 'q', request.questions.q, 'noul').noul;
  await ctx.helena
    .taskFinish({
      taskToken: opened.taskToken,
      result: {
        status: 'done',
        summary: `P(yes) = ${p.toFixed(2)}`,
        steps: [],
        usage: {
          calls: 1,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          decisionMs: reply.latencyMs,
          model: reply.model,
        },
        durationMs: Date.now() - started,
      },
    })
    .catch(() => {});
  return {
    text: [
      '### Result',
      `- P(yes) = ${p.toFixed(2)} — ${p >= 0.8 ? 'yes' : p <= 0.2 ? 'no' : 'unsure'}`,
      `- ${opened.label} (${reply.model ?? opened.model}), ${reply.latencyMs} ms`,
    ].join('\n'),
  };
}

export async function runChooseTool(ctx: TaskContext): Promise<ToolOutput> {
  const question = (str(ctx.request.args, 'question') ?? '').trim().slice(0, 1000);
  const raw = ctx.request.args.options;
  if (!question) throw new Error('question is required.');
  if (
    !Array.isArray(raw) ||
    raw.length < 2 ||
    raw.length > 50 ||
    raw.some((o) => typeof o !== 'string' || !o.trim())
  ) {
    throw new Error('options is required: 2 to 50 non-empty strings.');
  }
  const options = [...new Set((raw as string[]).map((o) => o.trim().slice(0, 200)))];
  if (options.length < 2) throw new Error('options must hold at least two different strings.');
  const opened = await start(ctx, 'choose', question, 'read', 1);
  const started = Date.now();
  const client = new HelenaDecisionClient(ctx.helena, opened.taskToken);
  const request = {
    state: await pageState(ctx),
    questions: {
      q: {
        type: 'choice' as const,
        instructions: `Answer about \`page\`: ${question}`,
        criteria: Object.fromEntries(options.map((option, index) => [String(index), option])),
      },
    },
  };
  let reply: DecisionReply;
  try {
    reply = await client.decide(request);
  } catch (error) {
    await ctx.helena
      .taskFinish({ taskToken: opened.taskToken, result: { status: 'backend_error' } })
      .catch(() => {});
    throw error;
  }
  const answer = answerOf(reply, 'q', request.questions.q, 'choice');
  const chosen = options[Number(answer.choice)]!;
  await ctx.helena
    .taskFinish({
      taskToken: opened.taskToken,
      result: {
        status: 'done',
        summary: chosen,
        steps: [],
        usage: {
          calls: 1,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          decisionMs: reply.latencyMs,
          model: reply.model,
        },
        durationMs: Date.now() - started,
      },
    })
    .catch(() => {});
  const ranked = Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([key, p]) => `- ${options[Number(key)]}: ${p.toFixed(2)}`);
  return {
    text: [
      '### Result',
      `- Chosen: ${chosen} (confidence ${answer.confidence.toFixed(2)})`,
      '### Probabilities',
      ...ranked,
    ].join('\n'),
  };
}
