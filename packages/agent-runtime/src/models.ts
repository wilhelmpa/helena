import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { isLocalHalogenUrl } from '@helena/sdk';
import { DEFAULTS, splitModelId, type ModelServer } from './config';

export function providerOptionsKey(provider: string): string {
  return provider.replace(/[_-]([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

// A model id (`helena-halogen/halogen-qwen3.8-flash-next`, `anthropic/claude-sonnet-5`) as the
// AI SDK model the loop calls, with what the loop needs to know about it.
export interface ResolvedModel {
  id: string;
  provider: string;
  modelId: string;
  model: LanguageModel;
  contextLength: number;
  maxOutputTokens?: number;
  local: boolean;
  queueAdmission?: boolean;
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
    ...(server.baseUrl && isLocalHalogenUrl(server.baseUrl)
      ? { headers: { 'x-volition-halogen-priority': env.VOLITION_HALOGEN_PRIORITY ?? 'normal' } }
      : {}),
    includeUsage: true,
    // Queue admission can exceed Bun's five-minute idle timeout; the loop supplies deadlines.
    ...(server.local
      ? {
          fetch: ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
            fetch(input, { ...init, timeout: false } as RequestInit & {
              timeout: false;
            })) as typeof fetch,
        }
      : {}),
  })(modelId);
};

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
  const settings = server.models?.find((entry) => entry.id === model);
  if (server.keyEnv && !env[server.keyEnv]) {
    throw new Error(`the key of ${provider} is not in the environment`);
  }
  const providerOptions: Record<string, Record<string, unknown>> = {};
  if (server.kind === 'openai-compatible') {
    const effort =
      server.thinking === false || reasoning === 'off'
        ? 'none'
        : reasoning || (server.local ? 'low' : undefined);
    providerOptions[providerOptionsKey(server.provider)] = {
      ...(effort && { reasoningEffort: effort }),
      ...(server.thinkingSwitch && {
        chat_template_kwargs: { enable_thinking: effort !== 'none' },
      }),
    };
  }
  return {
    id,
    provider,
    modelId: model,
    model: factory(server, model, env),
    contextLength: settings?.contextLength ?? server.contextLength ?? DEFAULTS.contextLength,
    ...(settings?.maxOutputTokens && { maxOutputTokens: settings.maxOutputTokens }),
    local: server.local === true,
    queueAdmission: server.local === true && isLocalHalogenUrl(server.baseUrl ?? ''),
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
