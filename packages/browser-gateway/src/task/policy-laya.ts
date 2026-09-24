// The "Laya" policy (docs/helena-decisions/browser-task.md §3.1) for a small local decision model:
// the browser-tuned Laya checkpoint (cklxx/laya-browser, Apache-2.0) was trained on jev-ultrafast's
// request format ("v3": page text ≤1,200 characters, the elements as the options of the target
// questions, the recent actions), so this policy sends exactly that, and lets code do what code is
// good at (laya-browser-agent, Apache-2.0, © Chenney Zhuang): at most 25 elements, grounded in the
// goal; a value is matched to a field by its name before a model is asked; no status questions a
// small model answers poorly. The operation and target questions are jev-ultrafast's (MIT,
// © Browser Use). See NOTICE.

import {
  NEXT_ACTION,
  OPERATION_LABELS,
  TARGET,
  brief,
  describe,
  operationsFor,
  scope,
  targetsFor,
  words,
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

export const LAYA_SCOPE = 25;
const TEXT_CHARS = 1200;

// jev-ultrafast's target heads: operation.lower() + "_target".
const HEADS = {
  CLICK: 'click_target',
  TYPE_TEXT: 'type_text_target',
  SELECT: 'select_target',
} as const;

function criterion(element: PageElement, option?: string) {
  const label =
    element.label || element.text || element.placeholder || element.name || element.role;
  return {
    element: `[${element.i}] ${option ? `${label} → ${option}` : label}`,
    current_value: element.value ?? '',
    role: element.role,
    ...(element.checked !== undefined ? { checked: String(element.checked) } : {}),
    ...(element.expanded !== undefined ? { expanded: String(element.expanded) } : {}),
    ...(element.active ? { selected: 'true' } : {}),
  };
}

// jev-ultrafast's goals carry their data in the words ("from Zurich to London"); the values an
// agent passes are added the same way, so the goal reads as the checkpoint knows it.
export function layaGoal(goal: string, values: Record<string, string>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return goal;
  return `${goal}\nValues to use: ${entries.map(([key, value]) => `${key}: ${value.slice(0, 200)}`).join('; ')}`;
}

export function layaRound(input: RoundInput) {
  const { observation, values, mode } = input;
  const goal = layaGoal(input.goal, values);
  const hasValues = Object.keys(values).length > 0;
  const all = targetsFor(observation, mode, hasValues, input.excluded);
  const union = [...new Set([...all.CLICK, ...all.TYPE_TEXT, ...all.SELECT])];
  const kept = new Set(scope(union, input.goal, values, LAYA_SCOPE));
  const targets = {
    CLICK: all.CLICK.filter((element) => kept.has(element)),
    TYPE_TEXT: all.TYPE_TEXT.filter((element) => kept.has(element)),
    SELECT: all.SELECT.filter((element) => kept.has(element)),
    PRESS_ENTER: [] as PageElement[],
  };
  const ops = operationsFor(observation, targets);
  const questions: Record<string, Question> = {
    operation: {
      type: 'choice',
      instructions: { goal, rules: NEXT_ACTION },
      criteria: Object.fromEntries(ops.map((op) => [op, OPERATION_LABELS[op]])),
    },
  };
  const selectOptions = new Map<string, { element: PageElement; option: string }>();
  for (const [op, head] of Object.entries(HEADS) as [keyof typeof HEADS, string][]) {
    const list = targets[op];
    if (list.length === 0) continue;
    const criteria: Record<string, unknown> = {};
    for (const element of list) {
      if (op === 'SELECT') {
        (element.options ?? []).forEach((option, k) => {
          if (option === element.value) return;
          const key = `${element.i}:${k + 1}`;
          selectOptions.set(key, { element, option });
          criteria[key] = criterion(element, option);
        });
      } else {
        criteria[String(element.i)] = criterion(element);
      }
    }
    // A single option is not a question; round() takes it as it is.
    if (Object.keys(criteria).length < 2) continue;
    questions[head] = {
      type: 'choice',
      instructions: { goal, operation: op, rules: [NEXT_ACTION, TARGET] },
      criteria,
    };
  }
  const state = {
    page: {
      url: observation.url,
      title: observation.title,
      text: observation.text.slice(0, TEXT_CHARS),
    },
    recent_actions: input.history
      .filter((entry) => entry.action)
      .slice(-10)
      .map((entry) => ({
        action: entry.element ?? entry.action,
        kind: entry.action,
        text: entry.text ?? null,
        page_changed: entry.page_changed ?? null,
      })),
  };
  return { request: { state, questions }, targets, ops, selectOptions };
}

// The value whose key names the field best ("postal_code" for "Postal Code"), or null when none
// or several fit equally.
export function valueForField(element: PageElement, values: Record<string, string>): string | null {
  const keys = Object.keys(values);
  if (keys.length === 1) return keys[0]!;
  const field = new Set(
    words(
      [element.label, element.placeholder, element.name, element.near].filter(Boolean).join(' '),
    ),
  );
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  for (const key of keys) {
    const score = words(key.replace(/[_-]+/g, ' ')).filter((word) => field.has(word)).length;
    if (score > bestScore) {
      best = key;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }
  return bestScore > 0 && !tie ? best : null;
}

export const layaPolicy: DecisionPolicy = {
  kind: 'laya',
  // laya-browser-agent's confidence gate: a local model fired a submit at p = 0.06.
  minTarget: 0.15,

  async round(input: RoundInput, ask: Ask): Promise<RoundAnswer> {
    const { request, targets, selectOptions } = layaRound(input);
    const q = request.questions;
    const reply = await ask(request);
    const operation = answerOf(reply, 'operation', q.operation!, 'choice');
    const op = operation.choice as Operation;
    let element: PageElement | null = null;
    let option: string | undefined;
    let targetProbability = 1;
    let candidates: RoundAnswer['candidates'] = [];
    const head = (HEADS as Record<string, string>)[op];
    if (head) {
      const byKey = (key: string) =>
        selectOptions.get(key)?.element ??
        input.observation.elements.find((e) => String(e.i) === key);
      if (q[head]) {
        const target = answerOf(reply, head, q[head]!, 'choice');
        element = byKey(target.choice) ?? null;
        option = selectOptions.get(target.choice)?.option;
        targetProbability = target.probabilities[target.choice] ?? 0;
        candidates = topCandidates(target.probabilities, byKey, brief);
      } else {
        element = targets[op as keyof typeof HEADS][0] ?? null;
        if (op === 'SELECT' && element)
          option = [...selectOptions.values()].find((o) => o.element === element)?.option;
      }
    }
    return {
      operation: op,
      element,
      option,
      operationProbability: operation.probabilities[op] ?? 0,
      operationConfidence: operation.confidence,
      targetProbability,
      done: operation.probabilities.DONE ?? null,
      error: null,
      login: null,
      blocked: operation.probabilities.BLOCKED ?? null,
      irreversible: null,
      candidates,
    };
  },

  async confirmDone(): Promise<number | null> {
    // A small model's yes/no on "is everything done" is not trustworthy; the loop reports
    // likely_done instead of done when it cannot confirm.
    return null;
  },

  async pickOption(input: RoundInput, element: PageElement): Promise<string | null> {
    return optionFromValues(element, input.values);
  },

  async pickValue(input: RoundInput, element: PageElement, ask: Ask): Promise<string | null> {
    const byName = valueForField(element, input.values);
    if (byName) return byName;
    const keys = Object.keys(input.values);
    if (keys.length < 2) return keys[0] ?? null;
    const request = {
      state: { goal: input.goal, field: describe(element) },
      questions: {
        value: {
          type: 'choice' as const,
          instructions: 'Which value belongs into `field` for `goal`?',
          criteria: Object.fromEntries(
            Object.entries(input.values).map(([k, v]) => [k, `${k}: ${v.slice(0, 60)}`]),
          ),
        },
      },
    };
    const reply = await ask(request);
    return answerOf(reply, 'value', request.questions.value, 'choice').choice;
  },
};
