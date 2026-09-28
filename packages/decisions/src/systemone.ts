import {
  decisionConfidence,
  decisionOptionIds,
  type DecisionAnswer,
  type DecisionQuestion,
} from '@helena/sdk';

// The System One wire format (TypeSafe's Jev): the one shape every
// decision backend answers in Helena, whatever protocol it speaks underneath. A request is a
// state and named questions; `choice` picks one of the `criteria` keys, `noul` gives the
// probability of yes. Decision: docs/helena-decisions/decisions.md §3.

export interface SystemOneChoiceQuestion {
  type: 'choice';
  instructions: unknown;
  criteria: Record<string, unknown>;
}

export interface SystemOneNoulQuestion {
  type: 'noul';
  instructions: unknown;
  criteria?: { true?: unknown; false?: unknown };
}

export type SystemOneQuestion = SystemOneChoiceQuestion | SystemOneNoulQuestion;

export interface SystemOneRequest {
  state: unknown;
  questions: Record<string, SystemOneQuestion>;
}

export interface SystemOneChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface SystemOneNoulAnswer {
  type: 'noul';
  noul: number;
}

export type SystemOneAnswer = SystemOneChoiceAnswer | SystemOneNoulAnswer;

// What a protocol adapter hands back: the answers in System One shape, the tokens, and the
// model as the server named it.
export interface SystemOneResult {
  model: string | null;
  answers: Record<string, SystemOneAnswer>;
  inputTokens: number;
  outputTokens: number;
}

export class DecisionAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionAnswerError';
  }
}

// Helena's questions as System One questions: a choice with its options as criteria, a
// yes/no question as a noul.
export function toSystemOne(
  questions: Record<string, DecisionQuestion>,
): Record<string, SystemOneQuestion> {
  const out: Record<string, SystemOneQuestion> = {};
  for (const [id, question] of Object.entries(questions)) {
    out[id] =
      question.kind === 'yesno'
        ? { type: 'noul', instructions: question.question }
        : {
            type: 'choice',
            instructions: question.question,
            criteria: Object.fromEntries(
              (question.options ?? []).map((option) => [option.id, option.label]),
            ),
          };
  }
  return out;
}

function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

// A backend's answer to one of Helena's questions, checked: the choice is an offered option,
// the probabilities cover exactly the options and sum to 1 within rounding tolerance; a
// noul becomes yes/no with P(yes) = noul. A malformed answer throws.
export function readAnswer(question: DecisionQuestion, raw: unknown): DecisionAnswer {
  const answer = raw as { noul?: unknown; probabilities?: unknown; choice?: unknown } | null;
  if (!answer || typeof answer !== 'object')
    throw new DecisionAnswerError('the backend gave no answer');
  if (question.kind === 'yesno') {
    const p = answer.noul;
    if (!unit(p)) throw new DecisionAnswerError('the yes/no answer has no probability');
    const probabilities = { yes: p, no: 1 - p };
    return {
      choice: p >= 0.5 ? 'yes' : 'no',
      probabilities,
      confidence: decisionConfidence(probabilities),
    };
  }
  const ids = decisionOptionIds(question);
  const given = answer.probabilities;
  if (!given || typeof given !== 'object' || Array.isArray(given))
    throw new DecisionAnswerError('the answer has no probabilities');
  const keys = Object.keys(given);
  if (keys.length !== ids.length || keys.some((key) => !ids.includes(key)))
    throw new DecisionAnswerError('the probabilities do not cover the offered options');
  const probabilities: Record<string, number> = {};
  for (const id of ids) {
    const value = (given as Record<string, unknown>)[id];
    if (!unit(value)) throw new DecisionAnswerError('a probability is not a number in [0, 1]');
    probabilities[id] = value;
  }
  const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.02)
    throw new DecisionAnswerError('the probabilities do not sum to 1');
  if (typeof answer.choice !== 'string' || !ids.includes(answer.choice))
    throw new DecisionAnswerError('the backend chose an option that was not offered');
  if (probabilities[answer.choice]! < Math.max(...Object.values(probabilities)) - 1e-6)
    throw new DecisionAnswerError('the choice is not the most probable option');
  for (const id of ids) probabilities[id] = probabilities[id]! / total;
  return { choice: answer.choice, probabilities, confidence: decisionConfidence(probabilities) };
}

// A distribution over labels as a System One answer to `question` (a choice over its
// criteria keys, or a noul whose first label means yes).
export function answerFromDistribution(
  question: SystemOneQuestion,
  keys: string[],
  probabilities: number[],
): SystemOneAnswer {
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  const normalized = probabilities.map((value) => (total > 0 ? value / total : 1 / keys.length));
  if (question.type === 'noul') return { type: 'noul', noul: normalized[0] ?? 0.5 };
  const table: Record<string, number> = {};
  keys.forEach((key, index) => {
    table[key] = normalized[index] ?? 0;
  });
  const choice = keys.reduce((best, key) => (table[key]! > table[best]! ? key : best));
  return { type: 'choice', choice, probabilities: table, confidence: decisionConfidence(table) };
}
