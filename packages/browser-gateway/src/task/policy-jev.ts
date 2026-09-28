// The "Jev" policy (docs/helena-decisions/browser-task.md §3.1): one request per round that asks,
// all at once, which operation comes next (jev-ultrafast's operation question with one speculative
// target head per operation) and the status questions jev-browser learned to ask in the same
// fan-out: done (two wordings), error, sign-in wall, blocked, and whether the next step is hard to
// undo; plus which of the caller's values the next step uses. Elements live once in the state, in
// page order; the target options are their numbers. Ported from jev-ultrafast (MIT, © Browser Use)
// and jev-browser (MIT, © Ying-Kai Liao), see NOTICE.

import {
  NEXT_ACTION,
  ACTION_RULES,
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

// Keep the decision state close to 1.5–3k tokens, including the target table.
const MAX_TARGETS = 40;

const HEADS = {
  CLICK: 'click_target',
  TYPE_TEXT: 'type_target',
  SELECT: 'select_target',
  PRESS_ENTER: 'enter_target',
} as const;

function stateOf(input: RoundInput, elements: PageElement[]) {
  const { observation, goal, values, history, lastChange, success } = input;
  const hasValues = Object.keys(values).length > 0;
  return {
    page: {
      url: observation.url,
      title: observation.title,
      text: observation.text.slice(0, 1800),
      ...(observation.dialogs.length
        ? { dialogs: observation.dialogs.slice(0, 2).map((d) => d.slice(0, 300)) }
        : {}),
      ...(observation.jsDialog ? { browser_dialog: observation.jsDialog } : {}),
      elements: elements.map((e) => ({
        i: e.i,
        role: e.role,
        label: (e.label || e.text || e.placeholder || e.name || e.near || '').slice(0, 60),
        ...(e.value !== undefined && !e.credential ? { value: e.value.slice(0, 60) } : {}),
        ...(e.options ? { options: e.options.slice(0, 4).map((v) => v.slice(0, 30)) } : {}),
        ...(e.checked !== undefined ? { checked: e.checked } : {}),
        ...(e.disabled ? { disabled: true } : {}),
      })),
    },
    task: {
      goal: goal.slice(0, 500),
      ...(success
        ? {
            success: {
              ...(success.url ? { url: success.url.slice(0, 200) } : {}),
              ...(success.textIncludes
                ? { textIncludes: success.textIncludes.map((s) => s.slice(0, 100)) }
                : {}),
              ...(success.fields
                ? {
                    fields: success.fields.map((f) => ({
                      label: f.label.slice(0, 80),
                      ...(f.value !== undefined ? { value: f.value.slice(0, 80) } : {}),
                      ...(f.checked !== undefined ? { checked: f.checked } : {}),
                    })),
                  }
                : {}),
            },
          }
        : {}),
      ...(hasValues
        ? {
            values: Object.fromEntries(
              Object.entries(values)
                .slice(0, 12)
                .map(([k, v]) => [k, v.slice(0, 80)]),
            ),
          }
        : {}),
      // The typed values themselves stay out; the history names their keys.
      history: history.slice(-4).map(({ text: _text, ...entry }) => entry),
      ...(lastChange ? { last_change: JSON.stringify(lastChange).slice(0, 300) } : {}),
    },
  };
}

export function jevRound(input: RoundInput) {
  const { observation, goal, values, mode, round } = input;
  const hasValues = Object.keys(values).length > 0;
  const visible = observation.elements.filter((e) => !e.covered && !e.offscreen);
  const shortlist = scope(visible, goal, values, MAX_TARGETS);
  const targets = targetsFor(
    { ...observation, elements: shortlist },
    mode,
    hasValues,
    input.excluded,
  );
  for (const op of Object.keys(targets) as (keyof typeof targets)[]) {
    targets[op] = scope(targets[op], goal, values, MAX_TARGETS);
  }
  targets.SELECT = targets.SELECT.filter((element) =>
    element.options?.some((_, k) => (element.optionIndices?.[k] ?? k) !== element.selectedIndex),
  );
  const stateElements = shortlist.sort((a, b) => a.i - b.i);
  const ops = operationsFor(observation, targets);
  const withValues = hasValues ? ', with the given `task.values`' : '';
  const questions: Record<string, Question> = {
    operation: {
      type: 'choice',
      instructions: {
        question:
          'Which operation advances `task.goal` from the current `page` next, given what `task.history` already did?',
        rules: ACTION_RULES,
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
  if (Object.keys(values).length > 1) {
    questions.value = {
      type: 'choice',
      instructions: {
        question:
          'If the next operation is TYPE_TEXT, which of task.values belongs in the selected field? Prefer values not yet entered.',
        rules: ACTION_RULES,
      },
      criteria: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.slice(0, 200)])),
    };
  }
  const choices: Record<
    string,
    Map<string, { element: PageElement; option?: string; optionIndex?: number }>
  > = {};
  for (const [op, head] of Object.entries(HEADS) as [keyof typeof HEADS, string][]) {
    const options = new Map<
      string,
      { element: PageElement; option?: string; optionIndex?: number }
    >();
    const criteria: Record<string, unknown> = {};
    for (const element of targets[op]) {
      if (op === 'SELECT') {
        for (const [k, option] of (element.options ?? []).entries()) {
          const optionIndex = element.optionIndices?.[k] ?? k;
          if (optionIndex === element.selectedIndex || options.size >= MAX_TARGETS) continue;
          const key = `${element.i}:${optionIndex}`;
          options.set(key, { element, option, optionIndex });
          criteria[key] = {
            element: element.i,
            role: element.role,
            label: brief(element),
            option: option.slice(0, 60),
          };
        }
      } else {
        options.set(String(element.i), { element });
        criteria[String(element.i)] = { role: element.role, label: brief(element) };
      }
    }
    choices[op] = options;
    if (options.size < 2) continue;
    questions[head] = {
      type: 'choice',
      instructions: {
        question: `If the next operation is ${op}, which offered target advances task.goal next? SELECT keys identify an element and its native option index.`,
        rules: [NEXT_ACTION, TARGET],
      },
      criteria,
    };
  }
  return { request: { state: stateOf(input, stateElements), questions }, targets, choices, ops };
}

export const jevPolicy: DecisionPolicy = {
  kind: 'jev',
  minTarget: 0.3,

  async round(input: RoundInput, ask: Ask): Promise<RoundAnswer> {
    const { request, choices } = jevRound(input);
    const reply = await ask(request);
    const q = request.questions;
    const operation = answerOf(reply, 'operation', q.operation!, 'choice');
    const noul = (id: string) => (q[id] ? answerOf(reply, id, q[id]!, 'noul').noul : null);
    const op = operation.choice as Operation;
    let element: PageElement | null = null;
    let option: string | undefined;
    let optionIndex: number | undefined;
    let targetProbability = 1;
    let candidates: RoundAnswer['candidates'] = [];
    const head = (HEADS as Record<string, string>)[op];
    if (head) {
      const options = choices[op]!;
      let selected: { element: PageElement; option?: string; optionIndex?: number } | undefined;
      if (options.size === 1) {
        selected = options.values().next().value;
      } else if (q[head]) {
        const target = answerOf(reply, head, q[head]!, 'choice');
        selected = options.get(target.choice);
        targetProbability = target.probabilities[target.choice] ?? 0;
        candidates = topCandidates(target.probabilities, (key) => options.get(key)?.element, brief);
      }
      element = selected?.element ?? null;
      option = selected?.option;
      optionIndex = selected?.optionIndex;
    }
    // Only the chosen operation consumes its speculative heads.
    const value =
      op === 'TYPE_TEXT'
        ? q.value
          ? answerOf(reply, 'value', q.value, 'choice').choice
          : Object.keys(input.values)[0]
        : undefined;
    const done = Math.max(noul('done') ?? 0, noul('done_change') ?? 0);
    return {
      operation: op,
      element,
      valueKey: value,
      option,
      optionIndex,
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
