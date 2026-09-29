import { expect, spyOn, test } from 'bun:test';
import { generateText } from 'ai';
import { resolveModel } from '../models';

test('native model requests carry background priority only to Halogen', async () => {
  const requests: { url: string; priority: string | null }[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    requests.push({
      url: String(url),
      priority: new Headers(init?.headers).get('x-volition-halogen-priority'),
    });
    return Response.json({
      id: 'test-response',
      model: 'flash',
      created: 1,
      choices: [
        { index: 0, message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  try {
    for (const baseUrl of [
      'http://127.0.0.1:8741/v1',
      'http://127.0.0.1:8731/v1',
      'https://provider.invalid/v1',
    ]) {
      const resolved = resolveModel(
        'test/flash',
        [{ provider: 'test', kind: 'openai-compatible', baseUrl }],
        'none',
        {
          VOLITION_HALOGEN_PRIORITY: 'background',
        },
      );
      expect(
        (await generateText({ model: resolved.model, prompt: 'Test', maxRetries: 0 })).text,
      ).toBe('Done');
    }
    expect(requests).toEqual([
      { url: 'http://127.0.0.1:8741/v1/chat/completions', priority: 'background' },
      { url: 'http://127.0.0.1:8731/v1/chat/completions', priority: 'background' },
      { url: 'https://provider.invalid/v1/chat/completions', priority: null },
    ]);
  } finally {
    fetchMock.mockRestore();
  }
});
