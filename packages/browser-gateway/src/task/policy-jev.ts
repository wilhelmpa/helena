// The "Jev" policy (docs/helena-decisions/browser-task.md §3.1): one request per round that asks,
// all at once, which operation comes next (jev-ultrafast's operation question with one speculative
// target head per operation) and the status questions jev-browser learned to ask in the same
// fan-out: done (two wordings), error, sign-in wall, blocked, and whether the next step is hard to
// undo; plus which of the caller's values the next step uses. Elements live once in the state, in
// page order; the target options are their numbers. Ported from jev-ultrafast (MIT, © Browser Use)
// and jev-browser (MIT, © Ying-Kai Liao), see NOTICE.

import {
  NEXT_ACTION,
  OPERATION_LABELS,
  TARGET,
  brief,
  describe,
  operationsFor,
  scope,
  targetsFor,
} from './policy-common.ts';
import {
  optionFromValues,
  topCandidates,
  type Ask,
  type DecisionPolicy,
  type RoundAnswer,
  type RoundInput,
} from './policy.ts';
import { answerOf } from './systemone.ts';
import type { Operation, PageElement, Question } from './types.ts';

// Choice questions accept at most 255 options; the state is capped too (32k tokens for the state
// and the longest question).
const MAX_TARGETS = 240;
const MAX_STATE_ELEMENTS = 300;

const HEADS = {
  CLICK: 'click_target',
  TYPE_TEXT: 'type_target',
  SELECT: 'select_target',
  PRESS_ENTER: 'enter_target',
} as const;

function stateOf(input: RoundInput, elements: PageElement[]) {
  const { observation, goal, values, history, lastChange } = input;
  const hasValues = Object.keys(values).length > 0;
  return {
    page: {
      url: observation.url,
      title: observation.title,
      text: observation.text,
      ...(observation.dialogs.length ? { dialogs: observation.dialogs } : {}),
      ...(observation.jsDialog ? { browser_dialog: observation.jsDialog } : {}),
      metrics: observation.metrics,
      elements: elements.map(describe),
      ...(observation.repeated ? { repeated_elements: observation.repeated } : {}),
    },
    task: {
      goal,
      ...(hasValues
        ? {
            values: Object.fromEntries(
              Object.entries(values).map(([k, v]) => [k, v.slice(0, 200)]),
            ),
          }
        : {}),
      // The typed values themselves stay out; the history names their keys.
      history: history.slice(-12).map(({ text: _text, ...entry }) => entry),
      ...(lastChange ? { last_change: lastChange } : {}),
    },
  };
}

export function jevRound(input: RoundInput) {
  const { observation, goal, values, mode, round } = input;
  const hasValues = Object.keys(values).length > 0;
  const targets = targetsFor(observation, mode, hasValues, input.excluded);
  for (const op of Object.keys(targets) as (keyof typeof targets)[]) {
    targets[op] = scope(targets[op], goal, values, MAX_TARGETS);
  }
  const offered = new Set(Object.values(targets).flat());
  const context = observation.elements.filter((element) => !offered.has(element));
  const stateElements = [
    ...offered,
    ...scope(context, goal, values, Math.max(0, MAX_STATE_ELEMENTS - offered.size)),
  ].sort((a, b) => a.i - b.i);
  const ops = operationsFor(observation, targets);
  const withValues = hasValues ? ', with the given `task.values`' : '';
  const questions: Record<string, Question> = {
    operation: {
      type: 'choice',
      instructions: {
        question:
          'Which operation advances `task.goal` from the current `page` next, given what `task.history` already did?',
        rules: NEXT_ACTION,
      },
      criteria: Object.fromEntries(ops.map((op) => [op, OPERATION_LABELS[op]])),
    },
    done: {
      type: 'noul',
      instructions: `Does \`page\` show that \`task.goal\` has been achieved${withValues}? Judge from \`page.text\` and \`page.elements\`.`,
    },
    login: {
      type: 'noul',
      instructions:
        'Is `page` a sign-in or sign-up screen, or asking the user to log in, before `task.goal` can continue?',
    },
    blocked: {
      type: 'noul',
      instructions:
        'Is there something on `page` that stops progress on `task.goal` and cannot be handled by clicking or typing (captcha, access denied, error page)?',
    },
  };
  if (round > 0) {
    questions.done_change = {
      type: 'noul',
      instructions: `Does \`page\` show that \`task.goal\` has been achieved${withValues}? Judge from \`page.text\`, \`page.elements\` and \`task.last_change\` (what the last action changed).`,
    };
    questions.error = {
      type: 'noul',
      instructions:
        'Does `page` show an error or rejection message (e.g. invalid credentials, a validation error, not found) caused by the actions in `task.history`?',
    };
  }
  if (mode === 'act') {
    questions.irreversible = {
      type: 'noul',
      instructions:
        'Would the next action toward `task.goal` on `page` have an effect outside this browser that is hard to undo, such as placing an order, paying, sending a message, deleting data or publishing?',
    };
  }
  if (hasValues) {
    questions.value = {
      type: 'choice',
      instructions:
        'If the next action toward `task.goal` types or selects something, which of `task.values` should it use? Prefer values not yet entered on `page`.',
      criteria: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.slice(0, 200)])),
    };
  }
  for (const [op, head] of Object.entries(HEADS) as [keyof typeof HEADS, string][]) {
    // A choice needs two options to be a question; a single target is taken as it is.
    if (targets[op].length < 2) continue;
    questions[head] = {
      type: 'choice',
      instructions: {
        question: `If the next operation is ${op}, which entry of \`page.elements\` (by its \`i\`) should it act on?`,
        rules: TARGET,
      },
      criteria: Object.fromEntries(targets[op].map((element) => [String(element.i), null])),
    };
  }
  return { request: { state: stateOf(input, stateElements), questions }, targets, ops };
}

export const jevPolicy: DecisionPolicy = {
  kind: 'jev',
  minTarget: 0.3,

  async round(input: RoundInput, ask: Ask): Promise<RoundAnswer> {
    const { request, targets } = jevRound(input);
    const reply = await ask(request);
    const q = request.questions;
    const operation = answerOf(reply, 'operation', q.operation!, 'choice');
    const noul = (id: string) => (q[id] ? answerOf(reply, id, q[id]!, 'noul').noul : null);
    const op = operation.choice as Operation;
    let element: PageElement | null = null;
    let targetProbability = 1;
    let candidates: RoundAnswer['candidates'] = [];
    const head = (HEADS as Record<string, string>)[op];
    if (head) {
      const list = targets[op as keyof typeof HEADS];
      if (list.length === 1) {
        element = list[0]!;
      } else if (q[head]) {
        const target = answerOf(reply, head, q[head]!, 'choice');
        const byKey = (key: string) => input.observation.elements.find((e) => String(e.i) === key);
        element = byKey(target.choice) ?? null;
        targetProbability = target.probabilities[target.choice] ?? 0;
        candidates = topCandidates(target.probabilities, byKey, brief);
      }
    }
    const value = q.value ? answerOf(reply, 'value', q.value, 'choice').choice : undefined;
    const done = Math.max(noul('done') ?? 0, noul('done_change') ?? 0);
    return {
      operation: op,
      element,
      valueKey: value,
      operationProbability: operation.probabilities[op] ?? 0,
      operationConfidence: operation.confidence,
      targetProbability,
      done,
      error: noul('error'),
      login: noul('login'),
      blocked: noul('blocked'),
      irreversible: noul('irreversible'),
      candidates,
    };
  },

  async confirmDone(input: RoundInput, ask: Ask): Promise<number | null> {
    const { observation, goal, history } = input;
    const request = {
      state: {
        page: {
          url: observation.url,
          title: observation.title,
          text: observation.text,
          elements: observation.elements.slice(0, 150).map(describe),
        },
        task: { goal, history: history.slice(-12).map(({ text: _text, ...entry }) => entry) },
      },
      questions: {
        complete: {
          type: 'noul' as const,
          instructions:
            'Is everything `task.goal` asks for already finished on `page`, so that no further action (such as pressing a submit, search or continue button) is needed?',
        },
      },
    };
    const reply = await ask(request);
    return answerOf(reply, 'complete', request.questions.complete, 'noul').noul;
  },

  async pickOption(input: RoundInput, element: PageElement, ask: Ask): Promise<string | null> {
    const fromValues = optionFromValues(element, input.values);
    if (fromValues) return fromValues;
    const options = element.options ?? [];
    if (options.length === 0) return null;
    if (options.length === 1) return options[0]!;
    const criteria = Object.fromEntries(options.map((option, index) => [String(index), option]));
    const request = {
      state: { task: { goal: input.goal }, dropdown: describe(element) },
      questions: {
        option: {
          type: 'choice' as const,
          instructions: 'Which option of `dropdown.options` should be chosen for `task.goal`?',
          criteria,
        },
      },
    };
    const reply = await ask(request);
    const answer = answerOf(reply, 'option', request.questions.option, 'choice');
    return options[Number(answer.choice)] ?? null;
  },

  async pickValue(input: RoundInput, element: PageElement, ask: Ask): Promise<string | null> {
    const keys = Object.keys(input.values);
    if (keys.length === 0) return null;
    if (keys.length === 1) return keys[0]!;
    const request = {
      state: { task: { goal: input.goal }, field: describe(element) },
      questions: {
        value: {
          type: 'choice' as const,
          instructions: 'Which of the values belongs into `field` for `task.goal`?',
          criteria: Object.fromEntries(
            Object.entries(input.values).map(([k, v]) => [k, v.slice(0, 200)]),
          ),
        },
      },
    };
    const reply = await ask(request);
    return answerOf(reply, 'value', request.questions.value, 'choice').choice;
  },
};
