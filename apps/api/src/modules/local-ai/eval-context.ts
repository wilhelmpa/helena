import {
  isLocalHalogenUrl,
  localThinkingFields,
  priorityProxyBaseUrl,
  type LocalAiChatAnswer,
  type LocalAiChatRequest,
  type LocalAiEvalContext,
  type LocalAiThinking,
} from '@helena/sdk';

// The two calls an eval makes, over a server's OpenAI-compatible API (chat completions with
// tools, embeddings). No database: the API's evals and the command-line bench
// (scripts/local-ai-eval.ts) use the same. Every chat call says how much the model may think
// (the class's `thinking`, `off` by default), so the eval measures what the class will run.

const EVAL_TIMEOUT_MS = 180_000;

interface ChatCompletion {
  choices?: {
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: { function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function openAiEvalContext(options: {
  baseUrl: string;
  key: string | null;
  model: string;
  // The class's level of thinking; a request may name another.
  thinking?: LocalAiThinking;
  signal?: AbortSignal;
  timeoutMs?: number;
  judge?: (request: LocalAiChatRequest) => Promise<LocalAiChatAnswer>;
  runCodingTask?: LocalAiEvalContext['runCodingTask'];
}): LocalAiEvalContext {
  const post = async (path: string, body: unknown) => {
    const response = await fetch(joinUrl(priorityProxyBaseUrl(options.baseUrl), path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(isLocalHalogenUrl(options.baseUrl)
          ? { 'x-volition-halogen-priority': 'background' }
          : {}),
        ...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? EVAL_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  };
  return {
    model: options.model,
    signal: options.signal,
    judge: options.judge,
    runCodingTask: options.runCodingTask,
    async runSkillUsage() {
      const { runSkillUsageEval } =
        await import('../../../../../packages/agent-runtime/src/skill-usage-eval');
      return runSkillUsageEval({
        config: {
          model: `helena-halogen/${options.model}`,
          reasoning: options.thinking === 'off' ? 'none' : (options.thinking ?? 'none'),
          servers: [
            {
              provider: 'helena-halogen',
              kind: 'openai-compatible',
              baseUrl: priorityProxyBaseUrl(options.baseUrl),
              keyEnv: 'VOLITION_EVAL_KEY',
              local: isLocalHalogenUrl(options.baseUrl),
              thinkingSwitch: true,
            },
          ],
          workdir: '/tmp',
        },
        env: {
          VOLITION_EVAL_KEY: options.key ?? undefined,
          VOLITION_HALOGEN_PRIORITY: 'background',
        },
        signal: options.signal ?? AbortSignal.timeout(30 * 60_000),
      });
    },
    async runSkillLearning() {
      const { runSkillLearningEval } =
        await import('../../../../../packages/agent-runtime/src/skill-learning-eval');
      return runSkillLearningEval({
        config: {
          model: `helena-halogen/${options.model}`,
          reasoning: options.thinking === 'off' ? 'none' : (options.thinking ?? 'none'),
          servers: [
            {
              provider: 'helena-halogen',
              kind: 'openai-compatible',
              baseUrl: priorityProxyBaseUrl(options.baseUrl),
              keyEnv: 'VOLITION_EVAL_KEY',
              local: isLocalHalogenUrl(options.baseUrl),
              thinkingSwitch: true,
            },
          ],
          workdir: '/tmp',
        },
        env: {
          VOLITION_EVAL_KEY: options.key ?? undefined,
          VOLITION_HALOGEN_PRIORITY: 'background',
        },
        signal: options.signal ?? AbortSignal.timeout(20 * 60_000),
      });
    },
    async chat(request: LocalAiChatRequest): Promise<LocalAiChatAnswer> {
      const started = Date.now();
      const body = (await post('/chat/completions', {
        model: options.model,
        messages: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          { role: 'user', content: request.prompt },
        ],
        ...(request.maxTokens && { max_tokens: request.maxTokens }),
        ...(request.json && { response_format: { type: 'json_object' } }),
        ...(request.tools && {
          tools: request.tools.map((tool) => ({ type: 'function', function: tool })),
        }),
        ...localThinkingFields(request.thinking ?? options.thinking ?? 'off'),
        temperature: 0,
        stream: false,
      })) as ChatCompletion;
      const message = body.choices?.[0]?.message;
      return {
        finishReason: body.choices?.[0]?.finish_reason ?? null,
        text: message?.content ?? '',
        toolCalls: (message?.tool_calls ?? []).map((call) => ({
          name: call.function?.name ?? '',
          arguments: call.function?.arguments ?? '{}',
        })),
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
        latencyMs: Date.now() - started,
      };
    },
    async embed(texts) {
      const started = Date.now();
      const body = (await post('/embeddings', { model: options.model, input: texts })) as {
        data?: { embedding?: number[]; index?: number }[];
      };
      const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return { vectors: rows.map((row) => row.embedding ?? []), latencyMs: Date.now() - started };
    },
  };
}
