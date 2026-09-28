import { describe, expect, it } from 'bun:test';
import { askByLogprobs, type OpenAiCompatibleServer } from './openai';
import { toSystemOne } from './systemone';
import { letterBias, singleTokenIds } from './tokens';

// A slice of Qwen3.8's byte-level vocabulary: the capital letters are single tokens, `Ġ`
// marks a leading space.
const VOCAB: Record<string, number> = {
  A: 32,
  B: 33,
  C: 34,
  D: 35,
  ĠA: 362,
  Hello: 9707,
};

describe('token ids for logit_bias', () => {
  it('finds exact single tokens only', () => {
    expect(singleTokenIds(VOCAB, ['A', 'C', ' A', 'Hel', 'Hello'])).toEqual([
      32,
      34,
      null,
      null,
      9707,
    ]);
  });

  it('ignores inherited properties and non-integer ids', () => {
    expect(singleTokenIds({ A: 1.5, B: -1 }, ['A', 'B', 'toString', 'constructor'])).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('biases the letters themselves without a tokenizer, and their ids with one', async () => {
    expect(await letterBias(['A', 'B'], 100)).toEqual({ A: 100, B: 100 });
    const ids = async (texts: string[]) => singleTokenIds(VOCAB, texts);
    expect(await letterBias(['A', 'B'], 100, ids)).toEqual({ '32': 100, '33': 100 });
    await expect(letterBias(['A', 'Z'], 100, ids)).rejects.toThrow('option letter Z');
  });
});

// A Halogen stand-in: it takes logit_bias by id only (a text key is refused as OpenAI does)
// and answers with OpenAI's top_logprobs.
function idServer(
  lookups: { count: number },
  vocab: Record<string, number> = VOCAB,
): OpenAiCompatibleServer & { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  return {
    bodies,
    model: 'halogen-qwen3.8-flash-next',
    concurrency: 2,
    tokenIds: async (texts) => {
      lookups.count++;
      return singleTokenIds(vocab, texts);
    },
    async post(_path, body) {
      const request = body as Record<string, unknown>;
      bodies.push(request);
      const bias = request.logit_bias as Record<string, number>;
      for (const key of Object.keys(bias)) {
        if (!/^\d+$/.test(key)) throw Object.assign(new Error('HTTP 400'), { status: 400 });
      }
      const user = JSON.parse((request.messages as { content: string }[])[1]!.content) as {
        options: { letter: string }[];
      };
      const letters = user.options.map((option) => option.letter);
      return {
        model: 'halogen-qwen3.8-flash-next',
        choices: [
          {
            logprobs: {
              content: [
                {
                  token: letters[0],
                  top_logprobs: letters.map((letter, index) => ({
                    token: letter,
                    logprob: Math.log(index === 0 ? 0.7 : 0.3 / (letters.length - 1)),
                  })),
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 1 },
      };
    },
  };
}

const request = {
  state: 'Rechnung Nr. 12 über 40 €',
  questions: toSystemOne({
    category: {
      kind: 'choice',
      question: 'Welche Art von Mail ist das?',
      options: [
        { id: 'rechnung', label: 'Rechnung' },
        { id: 'newsletter', label: 'Newsletter' },
        { id: 'privat', label: 'Privat' },
      ],
    },
    reply: { kind: 'yesno', question: 'Braucht sie eine Antwort?' },
  }),
};

describe('the local logit backend on a server that takes token ids', () => {
  it('biases the letters by id and looks the tokenizer up once per server', async () => {
    const lookups = { count: 0 };
    const server = idServer(lookups);
    const result = await askByLogprobs(server, request);
    expect(lookups.count).toBe(1);
    const choice = server.bodies.find(
      (body) => Object.keys(body.logit_bias as object).length === 3,
    )!;
    expect(choice.logit_bias).toEqual({ '32': 100, '33': 100, '34': 100 });
    expect(Object.keys(result.answers).sort()).toEqual(['category', 'reply']);
    // Asking again does not read the tokenizer again.
    await askByLogprobs(server, request);
    expect(lookups.count).toBe(1);
  });

  it('refuses rather than bias the wrong token when a letter is not one token', async () => {
    const lookups = { count: 0 };
    const vocab = { ...VOCAB };
    delete (vocab as Record<string, number>).C;
    const server = idServer(lookups, vocab);
    await expect(askByLogprobs(server, request)).rejects.toThrow('option letter C');
    // The three-option question never went out with a partial bias.
    expect(server.bodies.some((body) => Object.keys(body.logit_bias as object).length === 3)).toBe(
      false,
    );
  });

  it('asks the tokenizer again after a failed lookup', async () => {
    let calls = 0;
    const server = idServer({ count: 0 });
    server.tokenIds = async (texts) => {
      calls++;
      if (calls === 1) throw new Error('ENOENT vocab.json');
      return singleTokenIds(VOCAB, texts);
    };
    await expect(askByLogprobs(server, request)).rejects.toThrow('ENOENT');
    await askByLogprobs(server, request);
    expect(calls).toBe(2);
  });
});
