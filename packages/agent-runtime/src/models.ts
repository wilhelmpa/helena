import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { DEFAULTS, splitModelId, type ModelServer } from './config';

// A model id (`helena-halogen/halogen-qwen3.8-flash-next`, `anthropic/claude-sonnet-5`) as the
// AI SDK model the loop calls, with what the loop needs to know about it.
export interface ResolvedModel {
  id: string;
  provider: string;
  modelId: string;
  model: LanguageModel;
  contextLength: number;
  local: boolean;
  // Merged into every call on this model (thinking on or off for a local Qwen).
  providerOptions: Record<string, Record<string, unknown>>;
}

export type ModelFactory = (
  server: ModelServer,
  modelId: string,
  env: Record<string, string | undefined>,
) => LanguageModel;

// The AI SDK providers: OpenAI-compatible for local servers and API-key providers that speak
// it, Anthropic's own for an Anthropic key. The key is read from the environment here and
// nowhere else.
export const defaultModelFactory: ModelFactory = (server, modelId, env) => {
  const apiKey = server.keyEnv ? env[server.keyEnv] : undefined;
  if (server.kind === 'anthropic') {
    return createAnthropic({
      ...(server.baseUrl ? { baseURL: server.baseUrl } : {}),
      apiKey: apiKey ?? '',
    })(modelId);
  }
  return createOpenAICompatible({
    name: server.provider,
    baseURL: server.baseUrl ?? '',
    ...(apiKey ? { apiKey } : {}),
    includeUsage: true,
  })(modelId);
};

// Reasoning levels Helena knows; `none` and `off` switch a local model's thinking off.
const NO_THINKING = new Set(['none', 'off', 'minimal']);

export function resolveModel(
  id: string,
  servers: ModelServer[],
  reasoning: string | null | undefined,
  env: Record<string, string | undefined>,
  factory: ModelFactory = defaultModelFactory,
): ResolvedModel {
  const { provider, model } = splitModelId(id);
  const server = servers.find((entry) => entry.provider === provider);
  if (!server) throw new Error(`no model server for provider ${provider}`);
  if (server.keyEnv && !env[server.keyEnv]) {
    throw new Error(`the key of ${provider} is not in the environment`);
  }
  const providerOptions: Record<string, Record<string, unknown>> = {};
  if (server.kind === 'openai-compatible' && server.thinkingSwitch) {
    // The OpenAI-compatible provider spreads its own options into the request body.
    providerOptions[server.provider] = {
      chat_template_kwargs: {
        enable_thinking: server.thinking !== false && !NO_THINKING.has(reasoning ?? ''),
      },
    };
  } else if (server.kind === 'openai-compatible' && reasoning && !NO_THINKING.has(reasoning)) {
    providerOptions[server.provider] = { reasoningEffort: reasoning };
  }
  return {
    id,
    provider,
    modelId: model,
    model: factory(server, model, env),
    contextLength: server.contextLength ?? DEFAULTS.contextLength,
    local: server.local === true,
    providerOptions,
  };
}

// The configured model first, then its fallbacks, each once. A model whose server or key is
// missing is left out with the reason, so a broken fallback never hides the first one.
export function modelChain(
  primary: string,
  fallbacks: string[] | undefined,
  servers: ModelServer[],
  reasoning: string | null | undefined,
  env: Record<string, string | undefined>,
  factory: ModelFactory = defaultModelFactory,
): { chain: ResolvedModel[]; skipped: { id: string; reason: string }[] } {
  const chain: ResolvedModel[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of [primary, ...(fallbacks ?? [])]) {
    if (chain.some((entry) => entry.id === id)) continue;
    try {
      chain.push(resolveModel(id, servers, reasoning, env, factory));
    } catch (error) {
      skipped.push({ id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { chain, skipped };
}
