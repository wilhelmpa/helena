import { describe, expect, it } from 'bun:test';
import {
  askByJson,
  askByLogprobs,
  letterDistribution,
  type OpenAiCompatibleServer,
} from './openai';
import { readAnswer, toSystemOne } from './systemone';

// A llama-server stand-in: answers each chat completion with the letters' post-sampling
// probabilities from `score(options, request)`.
function fakeServer(
  score: (options: { letter: string; option: string }[], body: Record<string, unknown>) => number[],
  extra: Partial<OpenAiCompatibleServer> = {},
): OpenAiCompatibleServer & { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  return {
    bodies,
    model: 'qwen3.5-4b',
    ...extra,
    async post(path, body) {
      expect(path).toBe('/v1/chat/completions');
      const request = body as Record<string, unknown>;
      bodies.push(request);
      const user = JSON.parse((request.messages as { content: string }[])[1]!.content) as {
        options: { letter: string; option: string; key?: string }[];
      };
      if (request.response_format) {
        const keys = user.options.map((o) => o.key!);
        const p = score(
          user.options.map((o, i) => ({ letter: String(i), option: o.option })),
          request,
        );
        const best = p.indexOf(Math.max(...p));
        return {
          model: 'qwen3.5-4b-q4',
          choices: [
            { message: { content: JSON.stringify({ choice: keys[best], confidence: p[best] }) } },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 12 },
        };
      }
      const p = score(user.options, request);
      return {
        model: 'qwen3.5-4b-q4',
        choices: [
          {
            logprobs: {
              content: [
                {
                  token: user.options[0]!.letter,
                  top_probs: user.options.map((o, i) => ({ token: o.letter, prob: p[i] })),
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 40, completion_tokens: 1 },
      };
    },
  };
}

const questions = {
  category: {
    kind: 'choice' as const,
    question: 'Welche Art von Mail ist das?',
    options: [
      { id: 'rechnung', label: 'Rechnung oder Beleg' },
      { id: 'newsletter', label: 'Newsletter' },
      { id: 'privat', label: 'Private Nachricht' },
    ],
  },
  reply: { kind: 'yesno' as const, question: 'Braucht die Mail eine Antwort?' },
};

describe('the local logit backend', () => {
  it('reads the letters of one token and asks for exactly that', async () => {
    const server = fakeServer((options) =>
      options.length === 2
        ? [0.2, 0.8]
        : options.map((o) => (o.option.startsWith('rechnung') ? 0.7 : 0.15)),
    );
    const result = await askByLogprobs(server, {
      state: 'Ihre Rechnung Nr. 4711 über 119,00 EUR',
      questions: toSystemOne(questions),
    });
    const category = readAnswer(questions.category, result.answers.category);
    expect(category.choice).toBe('rechnung');
    expect(category.probabilities.rechnung).toBeCloseTo(0.7, 5);
    expect(category.confidence).toBeCloseTo((3 * 0.7 - 1) / 2, 5);
    const reply = readAnswer(questions.reply, result.answers.reply);
    expect(reply.choice).toBe('no');
    expect(reply.probabilities.yes).toBeCloseTo(0.2, 5);
    expect(result.inputTokens).toBe(80);
    expect(result.model).toBe('qwen3.5-4b-q4');
    const body = server.bodies[0]!;
    expect(body.max_tokens).toBe(1);
    expect(body.post_sampling_probs).toBe(true);
    expect(body.top_k).toBe(0);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body).not.toHaveProperty('enable_thinking');
    expect(Object.values(body.logit_bias as Record<string, number>).every((v) => v === 100)).toBe(
      true,
    );
  });

  it('answers more than 20 options in rounds', async () => {
    const criteria = Object.fromEntries(
      Array.from({ length: 45 }, (_, i) => [`o${i}`, i === 37 ? 'the right one' : `option ${i}`]),
    );
    const server = fakeServer((options) =>
      options.map((o) => (o.option.includes('right') ? 0.9 : 0.1 / options.length)),
    );
    const result = await askByLogprobs(server, {
      state: 'x',
      questions: { q: { type: 'choice', instructions: 'which?', criteria } },
    });
    const answer = result.answers.q as { choice: string; probabilities: Record<string, number> };
    expect(answer.choice).toBe('o37');
    expect(Object.keys(answer.probabilities)).toHaveLength(45);
    // 3 chunks of at most 20, then the final among 3 winners.
    expect(server.bodies).toHaveLength(4);
    expect(server.bodies.every((b) => (b.messages as unknown[]).length === 2)).toBe(true);
    const sum = Object.values(answer.probabilities).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('averages both orders when asked to debias', async () => {
    // A model that always prefers the first letter a little.
    const server = fakeServer((options) => options.map((_, i) => (i === 0 ? 0.6 : 0.4)), {
      debias: true,
    });
    const result = await askByLogprobs(server, {
      state: 'x',
      questions: { q: { type: 'choice', instructions: 'which?', criteria: { a: 'A', b: 'B' } } },
    });
    const answer = result.answers.q as { probabilities: Record<string, number> };
    expect(answer.probabilities.a).toBeCloseTo(0.5, 5);
    expect(server.bodies).toHaveLength(2);
  });

  it('refuses an answer that names no option', () => {
    expect(() =>
      letterDistribution(
        { choices: [{ logprobs: { content: [{ top_probs: [{ token: 'Z', prob: 1 }] }] } }] },
        ['A', 'B'],
      ),
    ).toThrow('none of the options');
    expect(() => letterDistribution({ choices: [{}] }, ['A', 'B'])).toThrow('no log probabilities');
  });

  it('reads OpenAI top_logprobs where a server has no top_probs', () => {
    const values = letterDistribution(
      {
        choices: [
          {
            logprobs: {
              content: [
                {
                  top_logprobs: [
                    { token: ' A', logprob: Math.log(0.3) },
                    { token: 'B', logprob: Math.log(0.1) },
                  ],
                },
              ],
            },
          },
        ],
      },
      ['A', 'B'],
    );
    expect(values[0]).toBeCloseTo(0.3, 6);
    expect(values[1]).toBeCloseTo(0.1, 6);
  });
});

describe('the JSON backend', () => {
  it('turns the stated confidence into a distribution over the options', async () => {
    const server = fakeServer((options) =>
      options.map((o) => (o.option.startsWith('newsletter') ? 0.9 : 0.05)),
    );
    const result = await askByJson(server, {
      state: 'Unser Newsletter für September',
      questions: toSystemOne({ category: questions.category }),
    });
    const answer = readAnswer(questions.category, result.answers.category);
    expect(answer.choice).toBe('newsletter');
    expect(answer.probabilities.newsletter).toBeCloseTo(0.9, 5);
    expect(answer.probabilities.rechnung).toBeCloseTo(0.05, 5);
    expect(server.bodies[0]!.response_format).toBeDefined();
  });
});

describe('reading answers', () => {
  it('refuses an option that was not offered', () => {
    expect(() =>
      readAnswer(questions.category, {
        type: 'choice',
        choice: 'spam',
        probabilities: { spam: 1 },
      }),
    ).toThrow();
  });
  it.each([
    { privat: 1 },
    { privat: 0.6, newsletter: 0.2 },
    { privat: 1, newsletter: -0.5, rechnung: 0.5 },
    { privat: 0.6, newsletter: NaN, rechnung: 0.4 },
    { privat: 0.6, newsletter: Infinity, rechnung: 0.4 },
    { privat: 0.6, newsletter: '0.2', rechnung: 0.2 },
    { privat: 0.2, newsletter: 0, rechnung: 0 },
    { privat: 1, newsletter: 1, rechnung: 1 },
  ])('rejects a malformed distribution instead of making it certain (%j)', (probabilities) => {
    expect(() => readAnswer(questions.category, { choice: 'privat', probabilities })).toThrow();
  });

  it.each([undefined, 'spam', 'privat'])(
    'rejects an absent or inconsistent choice (%s)',
    (choice) => {
      expect(() =>
        readAnswer(questions.category, {
          choice,
          probabilities: { privat: 0.1, newsletter: 0.8, rechnung: 0.1 },
        }),
      ).toThrow();
    },
  );

  it('normalizes only rounding drift and retains Helena confidence', () => {
    const answer = readAnswer(questions.category, {
      type: 'choice',
      choice: 'privat',
      probabilities: { privat: 0.7, newsletter: 0.2, rechnung: 0.099 },
      confidence: 0.99,
    });
    expect(answer.probabilities.privat).toBeCloseTo(0.7 / 0.999, 6);
    expect(answer.confidence).toBeCloseTo((3 * (0.7 / 0.999) - 1) / 2, 6);
  });
});
