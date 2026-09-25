// The browser_task loop (docs/helena-decisions/browser-task.md §3.1): observe → decide → guards →
// Helena's policy → act, until the goal is reached or something only the calling agent (or the
// owner) can resolve comes up. The statuses and their thresholds are jev-browser's (MIT, © Ying-Kai
// Liao; NOTES.md rules 5, 9, 11–16, 22–24), the freshness and occlusion guards jev-ultrafast's
// (MIT, © Browser Use), the confidence gate and toggle guard laya-browser-agent's (Apache-2.0,
// © Chenney Zhuang). See NOTICE.
//
// Pure logic over injected dependencies: the browser (TaskPage), the decision backend
// (DecisionClient), Helena's policy (authorize) and the control lock (holdsControl), so every
// status is provable without a browser or a backend.

import type { ActionCategory } from '../agent-tool.ts';
import { pageDiff } from './page-diff.ts';
import { brief, categoryOfStep, wantsOff } from './policy-common.ts';
import {
  optionFromValues,
  type Ask,
  type DecisionPolicy,
  type HistoryEntry,
  type RoundAnswer,
  type RoundInput,
} from './policy.ts';
import { DecisionError, type DecisionClient } from './systemone.ts';
import type {
  Operation,
  PageElement,
  PageObservation,
  TaskInput,
  TaskResult,
  TaskStatus,
  TaskStep,
  TaskUsage,
} from './types.ts';

export class TaskActError extends Error {
  // stale: the page changed under the decision; covered/hidden/gone/disabled/offscreen: the
  // element cannot take the input right now; dialog: the page opened a JavaScript dialog;
  // refused: a gateway rule (a credential field); failed: anything else.
  code:
    | 'stale'
    | 'covered'
    | 'hidden'
    | 'gone'
    | 'disabled'
    | 'offscreen'
    | 'dialog'
    | 'refused'
    | 'failed';
  constructor(code: TaskActError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface TaskActInput {
  operation: Operation;
  element: PageElement | null;
  text?: string;
  option?: string;
}

// The browser side of the loop (session.ts implements it on the project browser; the tests fake it).
export interface TaskPage {
  observe(): Promise<PageObservation>;
  // Whether the page (and the element, for a click or a selection) is still what the decision
  // was made on.
  fresh(observation: PageObservation, element: PageElement | null): Promise<boolean>;
  act(input: TaskActInput): Promise<void>;
}

export type Authorization =
  | { effect: 'allow' }
  | { effect: 'needs-approval'; reason: string; approvalId: number | null }
  | { effect: 'deny'; reason: string };

export interface TaskProgress {
  step: TaskStep;
  usage: TaskUsage;
}

export interface TaskDeps {
  page: TaskPage;
  client: DecisionClient;
  policy: DecisionPolicy;
  authorize(step: {
    operation: Operation;
    element: PageElement | null;
    category: ActionCategory;
    origin: string;
  }): Promise<Authorization>;
  // False once someone else (the owner's "Übernehmen") holds the browser.
  holdsControl(): boolean;
  onProgress?(progress: TaskProgress): void;
  signal?: AbortSignal;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

const IRREVERSIBLE_AT = 0.6;

// The operations a read-only task may carry out: they never change the page.
const READ_OPERATIONS: ReadonlySet<Operation> = new Set(['SCROLL_DOWN', 'SCROLL_UP', 'WAIT']);

// The page a task in mode `read` works on: it observes like any other, and refuses every
// operation that could change the page, whatever a policy or a model proposes. The loop checks
// the category before this is ever reached; this is the gateway's own backstop.
export function readOnlyPage(page: TaskPage): TaskPage {
  return {
    observe: () => page.observe(),
    fresh: (observation, element) => page.fresh(observation, element),
    act: async (input) => {
      if (!READ_OPERATIONS.has(input.operation)) {
        throw new TaskActError(
          'refused',
          `Read mode never changes the page: ${input.operation} was not done.`,
        );
      }
      await page.act(input);
    },
  };
}
const MAX_WAITS = 6;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.slice(0, 100);
  }
}

// true if the last `times * k` entries of seq are one k-long block repeated `times` times.
export function repeatsBlock(seq: string[], k: number, times: number): boolean {
  if (seq.length < k * times) return false;
  const tail = seq.slice(-k * times);
  const block = tail.slice(0, k).join('\n');
  if (k > 1 && new Set(tail.slice(0, k)).size === 1) return false;
  for (let n = 1; n < times; n++)
    if (tail.slice(n * k, (n + 1) * k).join('\n') !== block) return false;
  return true;
}

const TOGGLES = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);

export async function runTask(input: TaskInput, deps: TaskDeps): Promise<TaskResult> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? realSleep;
  const started = now();
  const { policy, page } = deps;
  const maxSteps = Math.max(1, Math.min(60, Math.floor(input.maxSteps)));
  const decisionBudget = maxSteps * 2 + 2;
  const steps: TaskStep[] = [];
  const history: HistoryEntry[] = [];
  const usage: TaskUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    decisionMs: 0,
    model: null,
  };
  const excluded = new Set<number>();
  const seen = new Map<string, number>();
  const sequence: string[] = [];
  let waits = 0;
  let retriedEmpty = false;
  let lowConfidence = 0;
  let round = 0;
  let previous: PageObservation | null = null;
  let last: RoundAnswer | null = null;
  let observation: PageObservation = {
    url: '',
    title: '',
    text: '',
    dialogs: [],
    metrics: { scrollY: 0, pageHeight: 0, viewportHeight: 0, textLength: 0, elements: 0 },
    elements: [],
    omitted: 0,
    keys: [],
    jsDialog: null,
  };

  const ask: Ask = async (request) => {
    if (usage.calls >= decisionBudget) throw new DecisionError('budget', 'decision budget used up');
    const reply = await deps.client.decide(request, deps.signal);
    usage.calls += 1;
    usage.inputTokens += reply.inputTokens;
    usage.outputTokens += reply.outputTokens;
    usage.decisionMs += reply.latencyMs;
    usage.model = reply.model ?? usage.model;
    return reply;
  };

  const finish = (
    status: TaskStatus,
    summary: string,
    extra: Partial<TaskResult> = {},
  ): TaskResult => ({
    status,
    summary,
    url: observation.url,
    title: observation.title,
    steps,
    usage,
    durationMs: now() - started,
    confidence: last ? Math.round(last.operationConfidence * 100) / 100 : null,
    doneScore: last?.done != null ? Math.round(last.done * 100) / 100 : null,
    ...(status !== 'done'
      ? {
          candidates: last?.candidates ?? [],
          pageText: observation.text.slice(0, 600),
        }
      : {}),
    ...extra,
  });

  const observe = async () => {
    observation = await page.observe();
    return observation;
  };

  try {
    await observe();
  } catch (error) {
    return finish(
      'error',
      `The page could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const record = (
    operation: Operation,
    element: PageElement | null,
    answer: RoundAnswer | null,
    decisionMs: number,
    actionMs: number,
    category: ActionCategory,
    outcome: string,
    extra: { valueKey?: string; option?: string } = {},
  ): TaskStep => {
    const step: TaskStep = {
      n: steps.length + 1,
      operation,
      element: element ? brief(element) : null,
      ...(extra.valueKey ? { valueKey: extra.valueKey } : {}),
      ...(extra.option ? { option: extra.option } : {}),
      probability: answer
        ? Math.round((element ? answer.targetProbability : answer.operationProbability) * 100) / 100
        : 1,
      confidence: answer ? Math.round(answer.operationConfidence * 100) / 100 : 1,
      decisionMs,
      actionMs,
      category,
      url: observation.url,
      outcome,
    };
    steps.push(step);
    deps.onProgress?.({ step, usage: { ...usage } });
    return step;
  };

  for (;;) {
    if (deps.signal?.aborted) return finish('cancelled', 'The task was cancelled.');
    if (!deps.holdsControl()) {
      return finish(
        'owner_took_over',
        'The owner took over the browser; the task stopped before its next action.',
      );
    }
    if (observation.jsDialog) {
      return finish(
        'needs_agent',
        `The page shows a dialog ("${observation.jsDialog.slice(0, 120)}"); answer it with browser_handle_dialog.`,
      );
    }
    if (steps.length >= maxSteps)
      return finish('max_steps', `Stopped after ${maxSteps} steps without reaching the goal.`);
    if (usage.calls >= decisionBudget) {
      return finish(
        'max_steps',
        `Stopped after ${usage.calls} decisions without reaching the goal.`,
      );
    }

    const roundInput: RoundInput = {
      observation,
      goal: input.goal,
      values: input.values,
      mode: input.mode,
      round,
      history,
      lastChange: round > 0 ? pageDiff(previous, observation) : undefined,
      excluded,
    };
    const decisionStart = now();
    let answer: RoundAnswer;
    try {
      answer = await policy.round(roundInput, ask);
    } catch (error) {
      if (error instanceof DecisionError && error.code === 'budget') {
        return finish(
          'max_steps',
          `Stopped after ${usage.calls} decisions without reaching the goal.`,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      return finish('backend_error', `The decision backend failed: ${message.slice(0, 300)}`);
    }
    const decisionMs = now() - decisionStart;
    last = answer;
    const hasValues = Object.keys(input.values).length > 0;
    const op = answer.operation;
    const done = answer.done;
    const guarded = op === 'CLICK' || op === 'PRESS_ENTER';
    round += 1;

    // Is the goal reached? (jev-browser rules 5, 13, 22.)
    if (policy.kind === 'jev' && done !== null) {
      if (round > 1 && done >= 0.5 && done < 0.85 && op !== 'DONE') {
        let confirm: number | null = null;
        try {
          confirm = await policy.confirmDone(roundInput, ask);
        } catch {
          confirm = null;
        }
        if (confirm !== null && confirm >= 0.65) return finish('done', `Done: ${input.goal}`);
        if (confirm !== null && confirm >= 0.45) {
          return finish(
            'likely_done',
            'The page looks done but the model is unsure; verify with browser_check or browser_snapshot.',
          );
        }
        if ((answer.irreversible ?? 0) >= IRREVERSIBLE_AT && guarded) {
          return finish(
            'done',
            'Done; stopped before an action that looks irreversible and may go beyond this goal.',
            {
              pending: {
                operation: op,
                element: brief(answer.element),
                category: categoryOfStep(op, answer.element),
              },
            },
          );
        }
      } else if (
        done >= (round > 1 ? 0.5 : 0.9) &&
        (done >= 0.85 || op === 'DONE' || round === 1)
      ) {
        return finish('done', `Done: ${input.goal}`);
      }
    }
    // A small model calls a sign-in wall done; its policy reports the wall (policy-laya.ts).
    if (policy.kind === 'laya' && (answer.login ?? 0) >= 0.7 && !hasValues) {
      return finish(
        'needs_login',
        'The page wants a sign-in. Use browser_login (a login granted in Zugänge) or browser_handover, then call browser_task again.',
      );
    }
    if (policy.kind === 'laya' && op === 'DONE') {
      return answer.operationProbability >= 0.8 && round > 1
        ? finish('done', `Done: ${input.goal}`)
        : finish(
            'likely_done',
            'The model sees nothing left to do; verify with browser_check or browser_snapshot.',
          );
    }
    if ((answer.login ?? 0) >= 0.7 && !hasValues) {
      return finish(
        'needs_login',
        'The page wants a sign-in. Use browser_login (a login granted in Zugänge) or browser_handover, then call browser_task again.',
      );
    }
    if (round > 1 && (answer.error ?? 0) >= 0.7) {
      return finish('error', 'The page shows an error after the last action.');
    }
    if (op === 'DONE') {
      if (round === 1 && !retriedEmpty) {
        // Content that appears late (a modal, a slow render): look once more before giving up.
        retriedEmpty = true;
        round = 0;
        await sleep(1500);
        await observe();
        continue;
      }
      if (
        round > 1 &&
        (done ?? 0) >= 0.35 &&
        (answer.error ?? 0) < 0.5 &&
        (answer.blocked ?? 0) < 0.5
      ) {
        return finish(
          'likely_done',
          'No further action seems needed but the model is unsure the goal is met; verify with browser_check.',
        );
      }
      return (answer.blocked ?? 0) >= 0.5
        ? finish(
            'blocked',
            'Something on the page stops progress (a captcha, access denied or an error page).',
          )
        : finish(
            'stuck',
            'Nothing on this page seems to lead toward the goal; continue with the step tools.',
          );
    }
    if (op === 'BLOCKED' || (answer.blocked ?? 0) >= 0.85) {
      return (answer.blocked ?? 0) >= 0.5 || policy.kind === 'laya'
        ? finish(
            'blocked',
            'Something on the page stops progress (a captcha, access denied or an error page). browser_handover asks the owner.',
          )
        : finish(
            'stuck',
            'No supported operation makes progress here; continue with the step tools.',
          );
    }
    if (op === 'WAIT') {
      waits += 1;
      if (waits > MAX_WAITS) return finish('stuck', 'The page never finished loading.');
      await sleep(600);
      record('WAIT', null, answer, decisionMs, 600, 'read', 'waited');
      history.push({ action: 'wait' });
      previous = observation;
      await observe();
      continue;
    }

    const element = answer.element;
    // Mode `read` never carries out anything above `read`, whatever the policy offered or the
    // model answered (a click, typing, selecting, Enter).
    if (input.mode === 'read' && categoryOfStep(op, element) !== 'read') {
      return finish(
        'denied',
        `Read mode never changes the page: the model proposed ${op}${element ? ` on ${brief(element)}` : ''}, which was not done. Call browser_task with mode "act" (or use the step tools) if that is wanted.`,
        {
          pending: {
            operation: op,
            element: brief(element),
            category: categoryOfStep(op, element),
          },
        },
      );
    }
    const targeted =
      op === 'CLICK' || op === 'TYPE_TEXT' || op === 'SELECT' || op === 'PRESS_ENTER';
    if (targeted && !element)
      return finish('stuck', `The model chose ${op} but no element for it.`);
    if (targeted && answer.targetProbability < policy.minTarget) {
      lowConfidence += 1;
      if (policy.kind === 'jev' || lowConfidence >= 2) {
        return finish(
          'needs_agent',
          'The model is not sure which element to use; pick one of the candidates with the step tools.',
        );
      }
      await observe();
      continue;
    }
    if (
      op === 'CLICK' &&
      element &&
      TOGGLES.has(element.role) &&
      element.checked === true &&
      !wantsOff(input.goal)
    ) {
      // laya-browser-agent's toggle guard: a click on a control already in the requested state
      // would undo it.
      excluded.add(element.i);
      history.push({ event: `left ${brief(element)} as it is: already checked` });
      continue;
    }

    // Loop guards (jev-browser rule 16).
    let valueKey: string | undefined;
    let option: string | undefined;
    if (op === 'TYPE_TEXT' && element) {
      valueKey =
        answer.valueKey && input.values[answer.valueKey] !== undefined
          ? answer.valueKey
          : undefined;
      if (!valueKey) {
        try {
          valueKey = (await policy.pickValue(roundInput, element, ask)) ?? undefined;
        } catch {
          valueKey = undefined;
        }
      }
      if (!valueKey) {
        return finish(
          'needs_agent',
          `${brief(element)} needs text that was not given; pass it in values (e.g. {"${(
            element.label ||
            element.placeholder ||
            'text'
          )
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .slice(0, 30)}": "…"}) or type it with browser_type.`,
        );
      }
    }
    if (op === 'SELECT' && element) {
      option =
        answer.option ??
        (answer.valueKey && input.values[answer.valueKey] !== undefined
          ? (optionFromValues(element, { [answer.valueKey]: input.values[answer.valueKey]! }) ??
            undefined)
          : undefined);
      if (!option) {
        try {
          option = (await policy.pickOption(roundInput, element, ask)) ?? undefined;
        } catch {
          option = undefined;
        }
      }
      if (!option)
        return finish(
          'needs_agent',
          `Which option of ${brief(element)} to choose is not clear; use browser_select_option.`,
        );
    }
    const seenKey = [
      op,
      brief(element),
      valueKey ?? option ?? '',
      observation.url,
      observation.keys.join('|'),
    ].join('\u0001');
    seen.set(seenKey, (seen.get(seenKey) ?? 0) + 1);
    if ((seen.get(seenKey) ?? 0) >= 3) {
      return finish(
        'stuck',
        'The same action on the same page did not make progress; the goal may already be done — check the page.',
      );
    }
    sequence.push(`${op}|${brief(element)}|${valueKey ?? option ?? ''}`);
    if (
      repeatsBlock(sequence, 2, 3) ||
      repeatsBlock(sequence, 3, 3) ||
      repeatsBlock(sequence, 1, 8)
    ) {
      return finish(
        'stuck',
        'The task repeats the same actions; the goal may already be done — check the page.',
      );
    }

    if (guarded && !input.allowIrreversible && (answer.irreversible ?? 0) >= IRREVERSIBLE_AT) {
      return finish(
        'needs_confirmation',
        'The next action looks hard to undo (order, payment, message, deletion, publication). Call again with allowIrreversible if that is wanted.',
        {
          pending: {
            operation: op,
            element: brief(element),
            category: categoryOfStep(op, element),
          },
        },
      );
    }

    const category = categoryOfStep(op, element);
    if (!(await page.fresh(observation, element))) {
      history.push({ event: 'the page changed before the action; observed it again' });
      await observe();
      continue;
    }
    if (category !== 'read') {
      const decision = await deps.authorize({
        operation: op,
        element,
        category,
        origin: originOf(observation.url),
      });
      if (decision.effect === 'needs-approval') {
        return finish(
          'needs_approval',
          `This ${category} action needs the owner's approval first (${decision.reason})${decision.approvalId ? `, Freigaben #${decision.approvalId}` : ''}. Stop here; once it is decided, a new run tells you.`,
          {
            approvalId: decision.approvalId,
            pending: { operation: op, element: brief(element), category },
          },
        );
      }
      if (decision.effect === 'deny') {
        return finish('denied', `Not allowed for you here: ${decision.reason}.`, {
          pending: { operation: op, element: brief(element), category },
        });
      }
    }
    if (!deps.holdsControl()) {
      return finish(
        'owner_took_over',
        'The owner took over the browser; the task stopped before its next action.',
      );
    }

    const actStart = now();
    let outcome = 'done';
    try {
      await page.act({
        operation: op,
        element,
        ...(valueKey ? { text: input.values[valueKey] } : {}),
        ...(option ? { option } : {}),
      });
    } catch (error) {
      if (error instanceof TaskActError) {
        if (error.code === 'dialog') {
          record(op, element, answer, decisionMs, now() - actStart, category, 'opened a dialog', {
            valueKey,
            option,
          });
          previous = observation;
          await observe();
          continue;
        }
        if (error.code === 'refused') return finish('needs_agent', error.message);
        outcome = error.code === 'stale' ? 'the page changed first' : `not done: ${error.code}`;
      } else {
        outcome = `failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 160)}`;
      }
    }
    record(op, element, answer, decisionMs, now() - actStart, category, outcome, {
      valueKey,
      option,
    });
    history.push({
      action: op.toLowerCase(),
      element: brief(element),
      ...(valueKey ? { value: valueKey, text: input.values[valueKey] } : {}),
      ...(option ? { option } : {}),
      ...(outcome !== 'done' ? { outcome } : {}),
    });
    previous = observation;
    await observe();
    const entry = history[history.length - 1];
    if (entry && previous)
      entry.page_changed =
        previous.keys.join('|') !== observation.keys.join('|') || previous.url !== observation.url;
  }
}
