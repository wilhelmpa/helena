import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import type { ModelFactory } from '../models';

// A scripted model for the loop's tests: each call to it takes the next turn of the script.
export type Turn =
  | {
      text: string;
      reasoning?: string;
      reasoningTokens?: number;
      inputTokens?: number;
      finishReason?: 'stop' | 'length';
    }
  | {
      calls: { name: string; input: unknown; id?: string }[];
      text?: string;
      inputTokens?: number;
      finishReason?: 'stop' | 'length';
    }
  | { error: string }
  | { hang: true };

const usage = (input = 100, output = 20, reasoning = 0) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output - reasoning, reasoning },
});

let callCounter = 0;

function partsOf(turn: Turn): LanguageModelV4StreamPart[] {
  if ('error' in turn || 'hang' in turn) return [];
  const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  if ('reasoning' in turn && turn.reasoning) {
    parts.push(
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', delta: turn.reasoning },
      { type: 'reasoning-end', id: 'r' },
    );
  }
  if (turn.text) {
    parts.push(
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: turn.text },
      { type: 'text-end', id: 't' },
    );
  }
  if ('calls' in turn) {
    for (const call of turn.calls) {
      parts.push({
        type: 'tool-call',
        toolCallId: call.id ?? `call-${++callCounter}`,
        toolName: call.name,
        input: typeof call.input === 'string' ? call.input : JSON.stringify(call.input),
      });
    }
  }
  parts.push({
    type: 'finish',
    finishReason: {
      unified: turn.finishReason ?? ('calls' in turn ? 'tool-calls' : 'stop'),
      raw: turn.finishReason ?? ('calls' in turn ? 'tool_calls' : 'stop'),
    },
    usage: usage(turn.inputTokens, 20, 'reasoningTokens' in turn ? turn.reasoningTokens : 0),
  });
  return parts;
}

export function scriptedModel(
  script: Turn[],
  options: { summary?: string; summaryFinishReason?: 'stop' | 'length' } = {},
) {
  let index = 0;
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal, prompt }) => {
      if (
        prompt.some(
          (message) =>
            message.role === 'system' &&
            message.content.startsWith('Erstelle eine einzige flache Zusammenfassung'),
        )
      ) {
        return {
          stream: convertArrayToReadableStream(
            partsOf({
              text: options.summary ?? 'Zusammenfassung.',
              finishReason: options.summaryFinishReason ?? 'stop',
            }),
          ),
        };
      }
      const turn = script[Math.min(index++, script.length - 1)]!;
      if ('error' in turn) throw new Error(turn.error);
      if ('hang' in turn) {
        await new Promise((_, reject) => {
          if (abortSignal?.aborted) reject(new Error('aborted'));
          abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return { stream: convertArrayToReadableStream(partsOf(turn)) };
    },
    doGenerate: async () => ({
      content: [{ type: 'text', text: options.summary ?? 'Zusammenfassung.' }],
      finishReason: {
        unified: options.summaryFinishReason ?? 'stop',
        raw: options.summaryFinishReason ?? 'stop',
      },
      usage: usage(),
      warnings: [],
    }),
  });
  return model;
}

// A factory that hands out the scripted model of each model id.
export function factoryOf(models: Record<string, ReturnType<typeof scriptedModel>>): ModelFactory {
  return (server, modelId) => {
    const model = models[`${server.provider}/${modelId}`];
    if (!model) throw new Error(`no scripted model for ${server.provider}/${modelId}`);
    return model;
  };
}
