// A stand-in System One model for tests, the eval harness and a first end-to-end check without a
// key (docs/helena-decisions/browser-task.md §3.7). It answers every question of the wire format
// from simple word overlap: the element whose words share most with the goal, the operation that
// fills an empty field while there are values left, submits once they are in, and DONE once the
// page shows a success message. Deterministic, calibrated only in shape (probabilities sum to 1).
// It is not a model and is never offered as a backend in production.

import type { Question, SystemOneResponse } from './types.ts';
import { words } from './policy-common.ts';

const DONE_WORDS =
  /\b(erfolg|erfolgreich|success|successful|gesendet|sent|danke|thank you|done|fertig|gespeichert|saved)\b/i;
const ERROR_WORDS = /\b(fehler|error|invalid|ungültig|failed|fehlgeschlagen|not found)\b/i;
const LOGIN_WORDS = /\b(anmelden|einloggen|sign in|log in|login|passwort|password)\b/i;
const SUBMIT_WORDS =
  /\b(senden|absenden|abschicken|send|submit|suchen|search|weiter|continue|speichern|save|go|los|ok)\b/i;

interface StateLike {
  page?: { text?: string; title?: string; elements?: Record<string, unknown>[]; url?: string };
  task?: { goal?: string; values?: Record<string, string>; history?: { action?: string }[] };
  goal?: string;
  recent_actions?: unknown[];
}

// "Gespeichert" is a success, "Noch nicht gespeichert" is not.
function succeeded(text: string): boolean {
  const cleaned = text.replace(/\b(noch nicht|nicht|not yet|not)\s+\p{L}+/giu, ' ');
  return DONE_WORDS.test(cleaned);
}

// After at least one action, a page whose title is what the goal asks to open counts as done.
function openedTarget(state: StateLike, goal: string): boolean {
  const acted =
    (state.task?.history?.some((entry) => entry.action) ?? false) ||
    (state.recent_actions?.length ?? 0) > 0;
  if (!acted) return false;
  // What is to be opened: the words after the last "öffne"/"open".
  const object = goal
    .split(/(?:^|\s)(?:öffne|open|go to|gehe zu|zeige)(?=\s)/i)
    .slice(1)
    .pop();
  // Only a goal that is nothing but opening something (no "and then …").
  if (!object || /,|\s(und|and|dann|then)\s/i.test(object)) return false;
  const title = words(state.page?.title ?? '');
  const url = state.page?.url ?? '';
  if (/[?&]q=/.test(url)) return false;
  return words(object).some(
    (word) =>
      word.length > 4 &&
      title.some((t) => t.length > 4 && (word.startsWith(t) || t.startsWith(word))),
  );
}

function textOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(' ');
  return Object.values(value as Record<string, unknown>)
    .map(textOf)
    .join(' ');
}

function goalOf(state: StateLike, question: Question): string {
  const instructions = question.instructions as { goal?: string } | string | undefined;
  if (state.task?.goal) return state.task.goal;
  if (state.goal) return state.goal;
  if (instructions && typeof instructions === 'object' && typeof instructions.goal === 'string')
    return instructions.goal.replace(/\nValues to use:[\s\S]*$/, '');
  return textOf(instructions);
}

function softmax(scores: Record<string, number>, temperature = 0.35): Record<string, number> {
  const keys = Object.keys(scores);
  const max = Math.max(...keys.map((key) => scores[key]!));
  const exps = keys.map((key) => Math.exp((scores[key]! - max) / temperature));
  const sum = exps.reduce((total, value) => total + value, 0);
  const out: Record<string, number> = {};
  let assigned = 0;
  keys.forEach((key, index) => {
    const value = Math.round((exps[index]! / sum) * 10_000) / 10_000;
    out[key] = value;
    assigned += value;
  });
  // Rounding: the largest takes the remainder, so the sum is exactly 1.
  const top = keys.reduce((best, key) => (out[key]! > out[best]! ? key : best), keys[0]!);
  out[top] = Math.round((out[top]! + 1 - assigned) * 10_000) / 10_000;
  return out;
}

function choice(scores: Record<string, number>) {
  const probabilities = softmax(scores);
  const chosen = Object.keys(probabilities).reduce((best, key) =>
    probabilities[key]! > probabilities[best]! ? key : best,
  );
  return { type: 'choice', choice: chosen, probabilities, confidence: probabilities[chosen]! };
}

function overlap(a: string, b: Set<string>): number {
  let score = 0;
  for (const word of new Set(words(a))) {
    if (b.has(word)) score += 1;
    else if (
      [...b].some(
        (other) =>
          other.length > 3 && word.length > 3 && (word.startsWith(other) || other.startsWith(word)),
      )
    )
      score += 0.6;
  }
  return score;
}

// The element an option key names: Jev keeps elements in the state and uses their number.
function elementText(
  state: StateLike,
  key: string,
  criterion: unknown,
): { text: string; element: Record<string, unknown> | null } {
  const element =
    state.page?.elements?.find((entry) => String(entry.i) === key.split(':')[0]) ?? null;
  // What a field already holds is not what it is about.
  const { current_value: _value, ...about } = (criterion ?? {}) as Record<string, unknown>;
  const { value: _held, ...described } = element ?? {};
  return {
    text: `${textOf(typeof criterion === 'object' ? about : criterion)} ${element ? textOf(described) : ''}`,
    element,
  };
}

function emptyField(element: Record<string, unknown> | null, criterion: unknown): boolean {
  if (element) return element.value === undefined || element.value === '';
  const current = (criterion as { current_value?: string } | null)?.current_value;
  return !current;
}

export function mockAnswers(body: {
  state?: unknown;
  questions?: Record<string, Question>;
  model?: string;
}): SystemOneResponse {
  const state = (body.state ?? {}) as StateLike;
  const questions = body.questions ?? {};
  const pageText = `${state.page?.text ?? ''}`;
  const values: Record<string, string> = state.task?.values ?? {};
  const typedAlready = new Set(
    [
      ...(state.page?.elements ?? []).map((element) => String(element.value ?? '')),
      ...Object.values(questions)
        .filter((question) => question.type === 'choice')
        .flatMap((question) =>
          Object.values((question as { criteria: Record<string, unknown> }).criteria).map(
            (criterion) =>
              String((criterion as { current_value?: string } | null)?.current_value ?? ''),
          ),
        ),
    ].filter(Boolean),
  );
  const valuesLeft = Object.entries(values).filter(
    ([, value]) => !typedAlready.has(value.slice(0, 60)),
  );
  // The options of the page's dropdowns: a value that names one is selected, not typed.
  const optionTexts = new Set(
    [
      ...(state.page?.elements ?? []).flatMap((element) =>
        Array.isArray(element.options) ? (element.options as string[]) : [],
      ),
      ...Object.values(
        questions.select_target?.type === 'choice' ? questions.select_target.criteria : {},
      ).map(
        (criterion) =>
          String((criterion as { element?: string }).element ?? '').split(' → ')[1] ?? '',
      ),
    ]
      .filter(Boolean)
      .map((option) => option.toLowerCase()),
  );
  const typedLeft = valuesLeft.filter(([, value]) => !optionTexts.has(value.toLowerCase()));
  const answers: Record<string, unknown> = {};

  for (const [id, question] of Object.entries(questions)) {
    const goal = goalOf(state, question);
    const goalWords = new Set(words(goal));
    if (question.type === 'noul') {
      let p = 0.05;
      if (
        /^(done|done_change|complete)$/.test(id) &&
        (succeeded(pageText) || openedTarget(state, goal))
      )
        p = 0.95;
      if (id === 'error' && ERROR_WORDS.test(pageText)) p = 0.9;
      if (
        id === 'login' &&
        LOGIN_WORDS.test(pageText) &&
        textOf(state.page?.elements).includes('credential')
      )
        p = 0.9;
      if (id === 'q') p = overlap(pageText, goalWords) > 0 ? 0.9 : 0.1;
      answers[id] = { type: 'noul', noul: p };
      continue;
    }
    if (question.type === 'score') {
      const levels = question.criteria.length;
      answers[id] = {
        type: 'score',
        score: 0,
        legend: Object.fromEntries(
          question.criteria.map((level, index) => [String(index), textOf(level)]),
        ),
        probabilities: Object.fromEntries(
          question.criteria.map((_, index) => [String(index), index === 0 ? 1 : 0]),
        ),
        confidence: 1 / levels,
      };
      continue;
    }
    const criteria = question.criteria;
    const keys = Object.keys(criteria);
    const scores: Record<string, number> = {};
    if (id === 'operation') {
      const done = succeeded(pageText) || openedTarget(state, goal);
      const typeKey = keys.includes('TYPE_TEXT') ? 'TYPE_TEXT' : null;
      // A dropdown whose option the goal names ("nach Name") and that does not show it yet.
      const selects = (state.page?.elements ?? []).filter((element) =>
        Array.isArray(element.options),
      );
      const goalOption = selects.some((element) =>
        (element.options as string[]).some(
          (option) => overlap(option, goalWords) >= 1 && option !== element.value,
        ),
      );
      const hasEmptyField =
        (state.page?.elements ?? []).some(
          (element) =>
            ['textbox', 'searchbox'].includes(String(element.role)) &&
            !element.value &&
            !element.credential,
        ) ||
        Object.values(
          questions.type_text_target?.type === 'choice' ? questions.type_text_target.criteria : {},
        ).some((criterion) => !(criterion as { current_value?: string }).current_value);
      for (const key of keys) scores[key] = 0;
      if (done && keys.includes('DONE')) scores.DONE = 3;
      else if (
        keys.includes('SELECT') &&
        (valuesLeft.some(([, value]) => optionTexts.has(value.toLowerCase())) ||
          (goalOption && typedLeft.length === 0))
      )
        scores.SELECT = 3;
      else if (typeKey && typedLeft.length > 0 && hasEmptyField) scores.TYPE_TEXT = 3;
      else if (keys.includes('CLICK')) scores.CLICK = 2;
      else if (keys.includes('SCROLL_DOWN')) scores.SCROLL_DOWN = 1.5;
      else if (keys.includes('BLOCKED')) scores.BLOCKED = 1;
      answers[id] = choice(scores);
      continue;
    }
    if (id === 'value') {
      const next = (typedLeft[0] ?? valuesLeft[0])?.[0];
      for (const key of keys) scores[key] = key === next ? 2 : 0;
      answers[id] = choice(scores);
      continue;
    }
    const typing = /type/.test(id);
    const clicking = /click/.test(id);
    const valueWords = new Set(
      words(valuesLeft.map(([key]) => key.replace(/[_-]+/g, ' ')).join(' ')),
    );
    for (const key of keys) {
      const { text, element } = elementText(state, key, criteria[key]);
      let score = overlap(text, goalWords);
      if (typing) {
        score += overlap(text, valueWords) * 2;
        if (emptyField(element, criteria[key])) score += 1;
      }
      const own = element ? `${element.text ?? ''} ${element.label ?? ''}` : textOf(criteria[key]);
      if (clicking && element && !element.text) score -= 0.5;
      if (
        clicking &&
        SUBMIT_WORDS.test(own) &&
        valuesLeft.length === 0 &&
        Object.keys(values).length > 0
      )
        score += 2;
      if (
        clicking &&
        (element?.checked === true || /checked.{0,3}true/.test(textOf(criteria[key])))
      )
        score -= 1;
      scores[key] = score;
    }
    answers[id] = choice(scores);
  }
  const tokens = Math.ceil(JSON.stringify(body.state ?? '').length / 4);
  return {
    model: body.model === 'jev-latest' ? 'mock-1' : (body.model ?? 'mock-1'),
    answers,
    usage: { input_tokens: tokens, output_tokens: Object.keys(answers).length },
  };
}
