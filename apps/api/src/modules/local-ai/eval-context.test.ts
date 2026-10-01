import { expect, test } from 'bun:test';
import { openAiEvalContext } from './eval-context';

for (const method of ['runSkillUsage', 'runSkillLearning'] as const) {
  test(`${method} accepts a local model server without an API key`, async () => {
    let requests = 0;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        requests++;
        const frame = (delta: object, finish: string | null, usage?: object) =>
          `data: ${JSON.stringify({
            id: 'volition-eval-response',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'volition-test-model',
            choices: [{ index: 0, delta, finish_reason: finish }],
            ...(usage ? { usage } : {}),
          })}\n\n`;
        return new Response(
          frame({ role: 'assistant', content: 'ACK' }, null) +
            frame({}, 'stop', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }) +
            'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    try {
      const context = openAiEvalContext({
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        model: 'volition-test-model',
        key: null,
      });
      const result = await context[method]!();
      expect(requests).toBeGreaterThan(0);
      expect(result.cases.length).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  }, 20_000);
}
