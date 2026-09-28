import {
  answerFromDistribution,
  DecisionAnswerError,
  type SystemOneAnswer,
  type SystemOneQuestion,
  type SystemOneRequest,
  type SystemOneResult,
} from './systemone';
import type { TokenIds } from './tokens';

// Two ways to answer System One questions with an ordinary language model behind an
// OpenAI-compatible server (llama.cpp's llama-server, AMD's Lemonade, which passes the body
// through to it; docs/helena-decisions/decisions.md §3.2):
//
// - "local logit" (`openai-logprobs`): the options are lettered A–T, the model is asked for one
//   token, and the distribution over the letters is read from that one forward pass. This is
//   SemIf-OpenJev's readout (MIT, © Theo Lee; idea only, own code and wording) over HTTP:
//   llama-server reports the probabilities after the sampler chain when `post_sampling_probs`
//   is set, and `logit_bias` +100 on every letter makes them exactly the softmax over the
//   letters' logits (a grammar would not: the server reports before applying it). top_k,
//   top_p and min_p are switched off so no letter is cut. More than 20 options are answered
//   in rounds: interleaved chunks of at most 20, then the chunk winners against each other,
//   p(option) = p_final(winner of its chunk) · p_chunk(option).
// - "JSON" (`openai-json`): the model answers {"choice", "confidence"} under a JSON schema.
//   Its stated confidence is not a probability; the class threshold still decides.
//
// Thinking is switched off through the chat template (`chat_template_kwargs`), never through
// a top-level `enable_thinking`, which Lemonade turns into a "/no_think" prefix of the prompt.

export interface OpenAiCompatibleServer {
  // POSTs JSON to `<base><path>` and returns the parsed body; throws on an HTTP error.
  post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown>;
  model: string;
  // At most this many characters of the state go to the model (default 12,000).
  maxStateChars?: number;
  // Ask twice, with the options in the given and in the reverse order, and average: halves
  // the letters' position bias at twice the cost (default off; the eval compares).
  debias?: boolean;
  // Questions asked at the same time (default 4).
  concurrency?: number;
  // For a server that takes `logit_bias` by token id only (Halogen): the option letters' ids in
  // the model's tokenizer. Absent: the letters themselves are the keys (llama.cpp, Lemonade).
  tokenIds?: TokenIds;
}

export const LETTERS = 'ABCDEFGHIJKLMNOPQRST'.split('');

const SYSTEM_LOGIT =
  'You decide one question about the evidence. Choose exactly one of the listed options ' +
  'and reply with its letter only, without any explanation or reasoning.';

const SYSTEM_JSON =
  'You decide one question about the evidence. Choose exactly one of the listed options. ' +
  'Reply with JSON only: {"choice": "<the option\'s key>", "confidence": <0 to 1, how sure you are>}.';

const CHAT_PATH = '/v1/chat/completions';

function text(value: unknown, max: number): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

function optionText(question: SystemOneQuestion, key: string): string {
  if (question.type === 'noul') {
    const criteria = question.criteria ?? {};
    return key === 'yes'
      ? `yes: ${text(criteria.true ?? 'The answer to the question is yes.', 600)}`
      : `no: ${text(criteria.false ?? 'The answer to the question is no.', 600)}`;
  }
  return `${key}: ${text(question.criteria[key], 600)}`;
}

function keysOf(question: SystemOneQuestion): string[] {
  return question.type === 'noul' ? ['yes', 'no'] : Object.keys(question.criteria);
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  model: string | null;
}

function usageOf(body: unknown, usage: Usage): void {
  const b = body as {
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    model?: unknown;
  };
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  usage.inputTokens += count(b?.usage?.prompt_tokens);
  usage.outputTokens += count(b?.usage?.completion_tokens);
  if (typeof b?.model === 'string' && b.model) usage.model = b.model.slice(0, 200);
}

function messages(system: string, state: string, instructions: unknown, options: object[]) {
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({ evidence: state, question: text(instructions, 2000), options }),
    },
  ];
}

// The probability of each letter of one answer token, from llama.cpp's post-sampling
// `top_probs` or, where a server has only OpenAI's `top_logprobs`, from those renormalized
// over the letters. A letter the server did not list counts 0.
export function letterDistribution(body: unknown, letters: string[]): number[] {
  const first = (
    body as {
      choices?: {
        logprobs?: {
          content?: {
            top_probs?: { token?: unknown; prob?: unknown }[];
            top_logprobs?: { token?: unknown; logprob?: unknown }[];
          }[];
        };
      }[];
    }
  )?.choices?.[0]?.logprobs?.content?.[0];
  const found = new Map<string, number>();
  const add = (token: unknown, p: number) => {
    if (typeof token !== 'string' || !Number.isFinite(p) || p <= 0) return;
    const letter = token.trim();
    if (letters.includes(letter)) found.set(letter, (found.get(letter) ?? 0) + p);
  };
  if (Array.isArray(first?.top_probs)) {
    for (const entry of first.top_probs) add(entry.token, Number(entry.prob));
  } else if (Array.isArray(first?.top_logprobs)) {
    for (const entry of first.top_logprobs) add(entry.token, Math.exp(Number(entry.logprob)));
  } else {
    throw new DecisionAnswerError('the server returned no log probabilities');
  }
  const values = letters.map((letter) => found.get(letter) ?? 0);
  if (values.every((value) => value === 0))
    throw new DecisionAnswerError('the model named none of the options');
  return values;
}

// The `logit_bias` key of each letter: the letter itself, or its token id where the server
// needs ids (looked up once per server object); null for a letter that is not one token.
const biasKeysOf = new WeakMap<OpenAiCompatibleServer, Promise<Record<string, string | null>>>();

function biasKeys(
  server: OpenAiCompatibleServer,
  signal?: AbortSignal,
): Promise<Record<string, string | null>> {
  const tokenIds = server.tokenIds;
  if (!tokenIds) return Promise.resolve(Object.fromEntries(LETTERS.map((l) => [l, l])));
  let pending = biasKeysOf.get(server);
  if (!pending) {
    pending = tokenIds(LETTERS, signal).then((ids) =>
      Object.fromEntries(
        LETTERS.map((letter, index) => {
          const id = ids[index];
          return [
            letter,
            typeof id === 'number' && Number.isInteger(id) && id >= 0 ? String(id) : null,
          ];
        }),
      ),
    );
    biasKeysOf.set(server, pending);
    // A failed lookup (the tokenizer file missing) is not kept: the next question asks again.
    pending.catch(() => biasKeysOf.delete(server));
  }
  return pending;
}

async function letterRound(
  server: OpenAiCompatibleServer,
  state: string,
  question: SystemOneQuestion,
  keys: string[],
  usage: Usage,
  signal?: AbortSignal,
): Promise<number[]> {
  const biasKey = await biasKeys(server, signal);
  const ask = async (order: string[]) => {
    const letters = LETTERS.slice(0, order.length);
    // A bias on the wrong token would skew the readout without a trace: refuse instead.
    const missing = letters.find((letter) => !biasKey[letter]);
    if (missing)
      throw new DecisionAnswerError(
        `the tokenizer has no single token for the option letter ${missing}`,
      );
    const body = await server.post(
      CHAT_PATH,
      {
        model: server.model,
        messages: messages(
          SYSTEM_LOGIT,
          state,
          question.instructions,
          order.map((key, index) => ({
            letter: letters[index],
            option: optionText(question, key),
          })),
        ),
        max_tokens: 1,
        temperature: 1,
        top_k: 0,
        top_p: 1,
        min_p: 0,
        logprobs: true,
        top_logprobs: Math.max(letters.length, 5),
        post_sampling_probs: true,
        logit_bias: Object.fromEntries(letters.map((letter) => [biasKey[letter]!, 100])),
        chat_template_kwargs: { enable_thinking: false },
        cache_prompt: true,
        stream: false,
      },
      signal,
    );
    usageOf(body, usage);
    const values = letterDistribution(body, letters);
    const total = values.reduce((sum, value) => sum + value, 0);
    return new Map(order.map((key, index) => [key, values[index]! / total]));
  };
  const forward = await ask(keys);
  if (!server.debias) return keys.map((key) => forward.get(key) ?? 0);
  const backward = await ask([...keys].reverse());
  return keys.map((key) => ((forward.get(key) ?? 0) + (backward.get(key) ?? 0)) / 2);
}

async function logitAnswer(
  server: OpenAiCompatibleServer,
  state: string,
  question: SystemOneQuestion,
  usage: Usage,
  signal?: AbortSignal,
): Promise<SystemOneAnswer> {
  const keys = keysOf(question);
  if (keys.length < 2) throw new DecisionAnswerError('a question needs at least two options');
  if (keys.length <= LETTERS.length) {
    return answerFromDistribution(
      question,
      keys,
      await letterRound(server, state, question, keys, usage, signal),
    );
  }
  // Interleaved chunks, so no chunk holds only the list's end.
  const n = Math.ceil(keys.length / LETTERS.length);
  const chunks = Array.from({ length: n }, (_, i) => keys.filter((_, index) => index % n === i));
  const rounds = await Promise.all(
    chunks.map((chunk) => letterRound(server, state, question, chunk, usage, signal)),
  );
  const winners = chunks.map((chunk, index) => {
    const p = rounds[index]!;
    return chunk[p.indexOf(Math.max(...p))]!;
  });
  const final = await letterRound(server, state, question, winners, usage, signal);
  const combined = keys.map((key) => {
    const chunk = chunks.findIndex((candidates) => candidates.includes(key));
    const within = rounds[chunk]![chunks[chunk]!.indexOf(key)]!;
    return final[chunk]! * within;
  });
  return answerFromDistribution(question, keys, combined);
}

async function jsonAnswer(
  server: OpenAiCompatibleServer,
  state: string,
  question: SystemOneQuestion,
  usage: Usage,
  signal?: AbortSignal,
): Promise<SystemOneAnswer> {
  const keys = keysOf(question);
  const body = await server.post(
    CHAT_PATH,
    {
      model: server.model,
      messages: messages(
        SYSTEM_JSON,
        state,
        question.instructions,
        keys.map((key) => ({ key, option: optionText(question, key) })),
      ),
      max_tokens: 60,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'decision',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              choice: { type: 'string', enum: keys },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['choice', 'confidence'],
          },
        },
      },
      chat_template_kwargs: { enable_thinking: false },
      stream: false,
    },
    signal,
  );
  usageOf(body, usage);
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  let parsed: { choice?: unknown; confidence?: unknown };
  try {
    parsed = JSON.parse(typeof content === 'string' ? content : '') as typeof parsed;
  } catch {
    throw new DecisionAnswerError('the model did not answer in JSON');
  }
  const index = keys.indexOf(String(parsed.choice));
  if (index < 0) throw new DecisionAnswerError('the model chose an option that was not offered');
  const stated = Number(parsed.confidence);
  const floor = 1 / keys.length;
  const c = Number.isFinite(stated) ? Math.min(1, Math.max(floor, stated)) : floor;
  const rest = keys.length > 1 ? (1 - c) / (keys.length - 1) : 0;
  return answerFromDistribution(
    question,
    keys,
    keys.map((_, i) => (i === index ? c : rest)),
  );
}

async function each<T>(
  items: [string, T][],
  limit: number,
  fn: (item: [string, T]) => Promise<[string, SystemOneAnswer]>,
): Promise<Record<string, SystemOneAnswer>> {
  const out: Record<string, SystemOneAnswer> = {};
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      const [id, answer] = await fn(item);
      out[id] = answer;
    }
  });
  await Promise.all(workers);
  return out;
}

async function ask(
  mode: 'logit' | 'json',
  server: OpenAiCompatibleServer,
  request: SystemOneRequest,
  signal?: AbortSignal,
): Promise<SystemOneResult> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0, model: null };
  const state = text(request.state, server.maxStateChars ?? 12_000);
  const answers = await each(
    Object.entries(request.questions),
    server.concurrency ?? 4,
    async ([id, question]) => [
      id,
      mode === 'logit'
        ? await logitAnswer(server, state, question, usage, signal)
        : await jsonAnswer(server, state, question, usage, signal),
    ],
  );
  return {
    model: usage.model ?? server.model,
    answers,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

// System One questions answered from the letters' probabilities of one token.
export function askByLogprobs(
  server: OpenAiCompatibleServer,
  request: SystemOneRequest,
  signal?: AbortSignal,
): Promise<SystemOneResult> {
  return ask('logit', server, request, signal);
}

// System One questions answered as JSON by a chat model.
export function askByJson(
  server: OpenAiCompatibleServer,
  request: SystemOneRequest,
  signal?: AbortSignal,
): Promise<SystemOneResult> {
  return ask('json', server, request, signal);
}
