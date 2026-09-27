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
  wantsOff,
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
// laya-browser-agent's confidence gate: a local model fired a submit at p = 0.06.
const MIN_TARGET = 0.15;
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
  // An element under an overlay cannot be used (the loop refuses it); the checkpoint picks it
  // anyway, again and again, instead of the overlay's own buttons.
  const found = targetsFor(observation, mode, hasValues, input.excluded);
  const open = (list: PageElement[]) => list.filter((element) => !element.covered);
  // A dropdown that already shows what the goal asks for is done (the toggle guard's rule for
  // dropdowns): offered, the checkpoint picks it again and so has to choose another option.
  const asked = new Set(words(`${input.goal} ${Object.values(values).join(' ')}`));
  const settled = (element: PageElement) => {
    const shown = words(element.value ?? '');
    return shown.length > 0 && shown.every((word) => asked.has(word));
  };
  const all = {
    CLICK: open(found.CLICK),
    TYPE_TEXT: open(found.TYPE_TEXT),
    SELECT: open(found.SELECT).filter((element) => !settled(element)),
  };
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
  const selectOptions = new Map<
    string,
    { element: PageElement; option: string; optionIndex: number }
  >();
  for (const [op, head] of Object.entries(HEADS) as [keyof typeof HEADS, string][]) {
    const list = targets[op];
    if (list.length === 0) continue;
    const criteria: Record<string, unknown> = {};
    for (const element of list) {
      if (op === 'SELECT') {
        (element.options ?? []).forEach((option, k) => {
          if ((element.optionIndices?.[k] ?? k) === element.selectedIndex) return;
          const key = `${element.i}:${k + 1}`;
          selectOptions.set(key, { element, option, optionIndex: element.optionIndices?.[k] ?? k });
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
// or several fit equally. The field's own label, placeholder and name count first; the text near
// it (often the previous field's label) only when they name no value.
export function valueForField(element: PageElement, values: Record<string, string>): string | null {
  const keys = Object.keys(values);
  if (keys.length === 1) return keys[0]!;
  const best = (texts: (string | undefined)[]) => {
    const field = new Set(words(texts.filter(Boolean).join(' ')));
    let found: string | null = null;
    let top = 0;
    let tie = false;
    for (const key of keys) {
      const score = words(key.replace(/[_-]+/g, ' ')).filter((word) => field.has(word)).length;
      if (score > top) {
        found = key;
        top = score;
        tie = false;
      } else if (score === top && score > 0) {
        tie = true;
      }
    }
    return { key: top > 0 && !tie ? found : null, matched: top > 0 };
  };
  const own = best([element.label, element.placeholder, element.name]);
  if (own.matched) return own.key;
  return best([element.near]).key;
}

// The texts a goal quotes („Alle Neuigkeiten geladen“, "Order placed").
export function quotedTexts(goal: string): string[] {
  const out: string[] = [];
  for (const match of goal.matchAll(/[„“"«»]([^„“”"«»]{2,80})[“”"«»]/gu)) {
    const text = match[1]!.trim();
    if (text) out.push(text);
  }
  return out;
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

// DONE needs visible evidence: a text the goal quotes that the page shows nowhere (text, element
// labels or field values) is not reached yet. The checkpoint says DONE after one "load more".
export function missingEvidence(input: RoundInput): boolean {
  const quoted = quotedTexts(input.goal);
  if (quoted.length === 0) return false;
  const { observation } = input;
  const seen = squash(
    [
      observation.title,
      observation.text,
      ...observation.elements.flatMap((element) => [element.label, element.text, element.value]),
    ]
      .filter(Boolean)
      .join(' \n '),
  );
  return quoted.some((text) => !seen.includes(squash(text)));
}

const lastAction = (input: RoundInput) =>
  [...input.history].reverse().find((entry) => entry.action);

// Typed but not sent: DONE right after typing, while the goal asks to submit, search, send or save
// and the page has a control that submits, is not done yet.
const SUBMIT_WORDS =
  /(submit|send|absend|abschick|sende|speicher|save|bestätig|confirm|search|such)/i;

export function unsubmitted(input: RoundInput, clickable: PageElement[]): boolean {
  if (!SUBMIT_WORDS.test(input.goal)) return false;
  if (lastAction(input)?.action !== 'type_text') return false;
  return clickable.some((element) => element.submits);
}

// The goal's evidence is all there after an action that changed the page: every quoted text shows
// outside a field (and not as a link still to open), every value was typed. Then the task is
// likely done even if the checkpoint wanders on (it toggles the todo it just added).
export function evidenceComplete(input: RoundInput): boolean {
  const quoted = quotedTexts(input.goal);
  if (quoted.length === 0) return false;
  const last = lastAction(input);
  if (!last || last.action === 'type_text' || !last.page_changed) return false;
  const typed = typedKeys(input);
  if (Object.keys(input.values).some((key) => !typed.has(key))) return false;
  const { observation } = input;
  const shown = squash(`${observation.title} \n ${observation.text}`);
  const links = observation.elements
    .filter((element) => element.role === 'link')
    .map((element) => squash(element.label || element.text || ''));
  return quoted.every((text) => {
    const wanted = squash(text);
    return shown.includes(wanted) && !links.some((link) => link.includes(wanted));
  });
}

// A sign-in wall: a password field on screen. The fast path never types into one, and a small
// model calls such a page done.
export function showsLogin(input: RoundInput): boolean {
  return input.observation.elements.some(
    (element) => element.credential && !element.offscreen && !element.covered,
  );
}

// Actions that are hard to undo, by word stem, in the languages of the owner's pages. The Jev policy
// asks the model (jev-browser's `irreversible`); a small local model is not asked, code decides: a
// click on such a control pauses the task (needs_confirmation) unless the goal itself asks for
// that kind of action ("sende es ab" allows "Senden").
const HARD_TO_UNDO: string[][] = [
  ['kauf', 'buy', 'purchase', 'bestell', 'order'],
  ['bezahl', 'zahlungspflichtig', 'pay', 'überweis', 'transfer'],
  ['lösch', 'delete', 'entfern', 'remove'],
  ['send', 'absend', 'abschick'],
  ['veröffentlich', 'publish', 'posten'],
  ['kündig', 'unsubscribe'],
];

export function hardToUndo(goal: string, element: PageElement | null): boolean {
  if (!element) return false;
  const label = (element.label || element.text || '').toLowerCase();
  const wanted = goal.toLowerCase();
  return HARD_TO_UNDO.some(
    (family) =>
      family.some((stem) => label.includes(stem)) && !family.some((stem) => wanted.includes(stem)),
  );
}

// The keys of the values typed so far in this task.
function typedKeys(input: RoundInput): Set<string> {
  return new Set(
    input.history
      .filter((entry) => entry.action === 'type_text' && entry.value)
      .map((entry) => entry.value!),
  );
}

// laya-browser-agent's "code does what code is good at", for two mistakes the small checkpoint
// makes on search and contact forms (eval, 2026-09-24): it submits before filling ("Fill required
// fields before submitting"), and after a search it submits the now empty form again instead of
// opening a result ("Do not repeat satisfied steps").
//
// Fill first: a submit while a field in scope is empty and one of the caller's values names it
// and was not typed yet becomes typing that value into that field.
export function fillBeforeSubmit(
  input: RoundInput,
  element: PageElement | null,
  fields: PageElement[],
): { element: PageElement; valueKey: string } | null {
  if (!element?.submits) return null;
  const typed = typedKeys(input);
  for (const field of fields) {
    if (field.credential || (field.value ?? '') !== '') continue;
    const key = valueForField(field, input.values);
    if (key && !typed.has(key)) return { element: field, valueKey: key };
  }
  return null;
}

// Type, not click: a click into a text field that one of the caller's values names, and that does
// not hold that value yet, is typing the value there (the checkpoint often clicks a field first).
export function clickIntoField(
  input: RoundInput,
  element: PageElement | null,
): { element: PageElement; valueKey: string } | null {
  if (!element?.editable || element.credential || element.selectable) return null;
  const key = valueForField(element, input.values);
  if (!key || (element.value ?? '') === input.values[key]) return null;
  return { element, valueKey: key };
}

// Tick first: a submit while an unticked checkbox in scope is named by the goal (most of its words)
// ("Ich akzeptiere die AGB" for "akzeptiere die AGB") is clicking that checkbox ("Set every
// requested filter/control"). Not when the goal asks to switch something off.
export function tickBeforeSubmit(
  input: RoundInput,
  element: PageElement | null,
  clickable: PageElement[],
): PageElement | null {
  if (!element?.submits || wantsOff(input.goal)) return null;
  const asked = new Set(words(input.goal));
  return (
    clickable.find((box) => {
      if (box.checked !== false || (box.role !== 'checkbox' && box.role !== 'switch')) return false;
      const named = words(box.label || box.text || '');
      const matched = named.filter((word) => asked.has(word)).length;
      return matched >= 2 && matched / named.length >= 0.6;
    }) ?? null
  );
}

// Enter, not click: a click into the text field the last action typed into, which holds that
// value, is confirming the entry (a todo list, a search without a button). The checkpoint knows no
// PRESS_ENTER.
export function confirmsEntry(input: RoundInput, element: PageElement | null): boolean {
  if (!element?.editable || element.credential || element.selectable) return false;
  const last = [...input.history].reverse().find((entry) => entry.action);
  if (!last || last.action !== 'type_text' || last.element !== brief(element)) return false;
  return !!last.value && (element.value ?? '') === input.values[last.value];
}

// No second submit: the same submit as the last action, which changed the page, while a field in
// scope is empty again and nothing was typed since, submits an empty form.
export function repeatsSubmit(
  input: RoundInput,
  element: PageElement | null,
  fields: PageElement[],
): boolean {
  if (!element?.submits) return false;
  const last = [...input.history].reverse().find((entry) => entry.action);
  if (!last || last.action !== 'click' || !last.page_changed) return false;
  if (last.element !== brief(element)) return false;
  return fields.some((field) => !field.credential && (field.value ?? '') === '');
}

export const layaPolicy: DecisionPolicy = {
  kind: 'laya',
  minTarget: MIN_TARGET,

  async round(input: RoundInput, ask: Ask): Promise<RoundAnswer> {
    const { request, targets, selectOptions } = layaRound(input);
    const q = request.questions;
    const reply = await ask(request);
    const operation = answerOf(reply, 'operation', q.operation!, 'choice');
    let op = operation.choice as Operation;
    let operationProbability = operation.probabilities[op] ?? 0;
    if (op !== 'DONE' && op !== 'BLOCKED' && evidenceComplete(input)) {
      op = 'DONE';
      operationProbability = 0.5;
    }
    // Typed but not sent: the submit is the next step.
    const submitNext = op === 'DONE' && unsubmitted(input, targets.CLICK);
    if (submitNext) {
      op = 'CLICK';
      operationProbability = operation.probabilities.CLICK ?? 0;
    } else if (op === 'DONE' && missingEvidence(input)) {
      // The next best operation instead, given that DONE is ruled out.
      const next = Object.entries(operation.probabilities)
        .filter(([key]) => key !== 'DONE' && key !== 'BLOCKED')
        .sort((a, b) => b[1] - a[1])[0];
      if (next) {
        op = next[0] as Operation;
        operationProbability = operationProbability < 1 ? next[1] / (1 - operationProbability) : 0;
      }
    }
    let element: PageElement | null = null;
    let option: string | undefined;
    let optionIndex: number | undefined;
    let targetProbability = 1;
    let candidates: RoundAnswer['candidates'] = [];
    const head = (HEADS as Record<string, string>)[op];
    if (head) {
      const byKey = (key: string) =>
        selectOptions.get(key)?.element ??
        input.observation.elements.find((e) => String(e.i) === key);
      if (q[head]) {
        const target = answerOf(reply, head, q[head]!, 'choice');
        let choice = target.choice;
        element = byKey(choice) ?? null;
        targetProbability = target.probabilities[choice] ?? 0;
        if (op === 'CLICK' && repeatsSubmit(input, element, targets.TYPE_TEXT)) {
          // The next best target instead, if any is left, with its probability given that the
          // repeated submit is ruled out.
          const ruledOut = targetProbability;
          const next = Object.entries(target.probabilities)
            .filter(([key]) => key !== choice)
            .sort((a, b) => b[1] - a[1])[0];
          if (next) {
            choice = next[0];
            element = byKey(choice) ?? null;
            targetProbability = ruledOut < 1 ? next[1] / (1 - ruledOut) : 0;
          }
        }
        if (submitNext && !element?.submits) {
          // The likeliest control that submits.
          const best = Object.entries(target.probabilities)
            .filter(([key]) => byKey(key)?.submits)
            .sort((a, b) => b[1] - a[1])[0];
          if (best) {
            choice = best[0];
            element = byKey(choice) ?? null;
            targetProbability = Math.max(best[1], MIN_TARGET);
          }
        }
        option = selectOptions.get(choice)?.option;
        optionIndex = selectOptions.get(choice)?.optionIndex;
        candidates = topCandidates(target.probabilities, byKey, brief);
      } else {
        element = targets[op as keyof typeof HEADS][0] ?? null;
        if (op === 'SELECT' && element) {
          const selected = [...selectOptions.values()].find((o) => o.element === element);
          option = selected?.option;
          optionIndex = selected?.optionIndex;
        }
      }
    }
    if (op === 'CLICK' && confirmsEntry(input, element)) {
      return {
        operation: 'PRESS_ENTER',
        element,
        operationProbability,
        operationConfidence: operation.confidence,
        targetProbability: 1,
        done: operation.probabilities.DONE ?? null,
        error: null,
        login: showsLogin(input) ? 0.9 : null,
        blocked: operation.probabilities.BLOCKED ?? null,
        irreversible: hardToUndo(input.goal, element) ? 0.9 : null,
        candidates,
      };
    }
    const tick = op === 'CLICK' ? tickBeforeSubmit(input, element, targets.CLICK) : null;
    if (tick) {
      element = tick;
      targetProbability = 1;
    }
    const fill =
      op === 'CLICK' && !tick
        ? (clickIntoField(input, element) ?? fillBeforeSubmit(input, element, targets.TYPE_TEXT))
        : null;
    if (fill) {
      return {
        operation: 'TYPE_TEXT',
        element: fill.element,
        valueKey: fill.valueKey,
        operationProbability,
        operationConfidence: operation.confidence,
        targetProbability: 1,
        done: operation.probabilities.DONE ?? null,
        error: null,
        login: showsLogin(input) ? 0.9 : null,
        blocked: operation.probabilities.BLOCKED ?? null,
        irreversible: null,
        candidates,
      };
    }
    return {
      operation: op,
      element,
      option,
      optionIndex,
      operationProbability,
      operationConfidence: operation.confidence,
      targetProbability,
      done: operation.probabilities.DONE ?? null,
      error: null,
      login: showsLogin(input) ? 0.9 : null,
      blocked: operation.probabilities.BLOCKED ?? null,
      irreversible: hardToUndo(input.goal, element) ? 0.9 : null,
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
