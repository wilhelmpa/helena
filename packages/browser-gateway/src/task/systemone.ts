// Talking to a System One model (TypeSafe Jev, or a Jev-compatible server such as Laya): the
// client interface the loop calls, and the checks every answer passes before anything acts on it.
// The checks follow jev-ultrafast's validate_choice (MIT, © Browser Use) and laya-browser-agent's
// decider (Apache-2.0, © Chenney Zhuang): the choice is one of the offered options, the
// probabilities cover exactly those options, are finite, lie in [0, 1], sum to 1 ± 0.02, and the
// choice is the most probable one. A surprising answer is an error; nothing acts on it.

import type { ChoiceAnswer, NoulAnswer, Question, SystemOneResponse } from './types.ts';

export interface DecisionRequest {
  state: unknown;
  questions: Record<string, Question>;
}

export interface DecisionReply {
  model: string | null;
  answers: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

// The gateway's side of the backend: Helena's proxy (helena-client.ts) in production, a direct
// client in the eval harness and the tests. It never sees a key.
export interface DecisionClient {
  decide(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionReply>;
}

export class DecisionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validChoice(answer: unknown, options: string[]): ChoiceAnswer {
  const a = answer as Partial<ChoiceAnswer> | null;
  const offered = new Set(options);
  if (!a || typeof a.choice !== 'string' || !offered.has(a.choice)) {
    throw new DecisionError('invalid_answer', 'The model chose an option that was not offered.');
  }
  const probabilities = a.probabilities;
  if (!probabilities || typeof probabilities !== 'object') {
    throw new DecisionError('invalid_answer', 'The model answered without probabilities.');
  }
  const keys = Object.keys(probabilities);
  if (keys.length !== offered.size || keys.some((key) => !offered.has(key))) {
    throw new DecisionError('invalid_answer', 'The probabilities do not cover the options.');
  }
  const values = Object.values(probabilities);
  if (!values.every(unit)) {
    throw new DecisionError('invalid_answer', 'A probability is not a number in [0, 1].');
  }
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 0.02) {
    throw new DecisionError('invalid_answer', `The probabilities sum to ${sum.toFixed(3)}.`);
  }
  const max = Math.max(...values);
  if ((probabilities[a.choice] ?? 0) < max - 1e-6) {
    throw new DecisionError('invalid_answer', 'The choice is not the most probable option.');
  }
  if (!unit(a.confidence)) {
    throw new DecisionError('invalid_answer', 'The model answered without valid confidence.');
  }
  return { choice: a.choice, probabilities: { ...probabilities }, confidence: a.confidence };
}

export function validNoul(answer: unknown): NoulAnswer {
  const a = answer as Partial<NoulAnswer> | null;
  if (!a || !unit(a.noul)) {
    throw new DecisionError(
      'invalid_answer',
      'The model answered a yes/no question without P(yes).',
    );
  }
  return { noul: a.noul };
}

// The questions of one request are checked together: every one must be answered as asked.
export function answerOf<T extends 'choice' | 'noul'>(
  reply: DecisionReply,
  id: string,
  question: Question,
  kind: T,
): T extends 'choice' ? ChoiceAnswer : NoulAnswer {
  const answer = reply.answers[id];
  if (kind === 'choice') {
    const options = Object.keys((question as { criteria: Record<string, unknown> }).criteria);
    return validChoice(answer, options) as never;
  }
  return validNoul(answer) as never;
}

// Parses a backend's JSON body into a reply (used by the direct client and the mock).
export function replyOf(body: SystemOneResponse, latencyMs: number): DecisionReply {
  if (!body || typeof body !== 'object' || !body.answers || typeof body.answers !== 'object') {
    throw new DecisionError('invalid_reply', 'The decision backend answered without answers.');
  }
  return {
    model: typeof body.model === 'string' ? body.model : null,
    answers: body.answers,
    inputTokens: Math.max(0, Math.round(body.usage?.input_tokens ?? 0)),
    outputTokens: Math.max(0, Math.round(body.usage?.output_tokens ?? 0)),
    latencyMs,
  };
}

// A client that posts straight to `{baseUrl}/v1/systemone` — for the eval harness and tests on a
// developer machine. Production never uses it: the gateway goes through Helena, which holds the
// key (helena-client.ts, systemOne).
export class DirectDecisionClient implements DecisionClient {
  #url: string;
  #key: string | null;
  #model: string;
  #fetch: typeof fetch;

  constructor(options: {
    baseUrl: string;
    key?: string | null;
    model: string;
    fetchImpl?: typeof fetch;
  }) {
    const base = options.baseUrl.replace(/\/+$/, '');
    this.#url = `${base}${base.endsWith('/v1') ? '' : '/v1'}/systemone`;
    this.#key = options.key ?? null;
    this.#model = options.model;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async decide(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionReply> {
    const started = performance.now();
    const res = await this.#fetch(this.#url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.#key ? { authorization: `Bearer ${this.#key}` } : {}),
      },
      body: JSON.stringify({
        model: this.#model,
        state: request.state,
        questions: request.questions,
      }),
      signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new DecisionError(
        `http_${res.status}`,
        `The decision backend answered ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    return replyOf(JSON.parse(text) as SystemOneResponse, Math.round(performance.now() - started));
  }
}
