import { parseLocalModelId, type RuntimeLocalAi } from '@helena/sdk';
import { registerProfileContribution } from './contributions';

// Helena's local AI in an agent's Hermes profile (docs/helena-decisions/local-ai-platform.md):
// while the owner has it on, each local model server becomes a named Hermes provider
// (`providers.helena-<slug>`, its key from the environment), and the helper calls the policy
// sends there first (context compression, image descriptions) point at it, each with the main
// model as its fallback. While it is off the snapshot carries none of it, so nothing of it
// stays in any profile: the agent runs exactly as without local AI.
//
// Thinking (decision doc §6.7): Lemonade starts its models answering without thinking. The
// helper calls carry nothing, so they run without (a compression needs no reasoning, and with
// it a reasoning model spends its tokens before it answers). An agent the owner put on a local
// model asks for thinking through the provider's `extra_body`, which Hermes adds to the
// agent's own turns only and drops when it falls back to another provider. The helpers'
// per-task `extra_body` is no way to switch thinking off: Hermes sends it to the fallback
// (the main model) too, and a Codex or Claude endpoint refuses `chat_template_kwargs`.
//
// A local model never becomes the agent's configured model here. An agent runs one only when
// the owner picked it (the model id `helena-<slug>/<model>` then names the provider, see
// localRoute below) or, for the helpers, where the policy says so.

export function hermesLocalAiConfig(localAi: RuntimeLocalAi | null | undefined) {
  if (!localAi || localAi.servers.length === 0) return {};
  const providers: Record<string, Record<string, unknown>> = {};
  for (const server of localAi.servers) {
    providers[server.provider] = {
      base_url: server.baseUrl,
      ...(server.keyEnv ? { key_env: server.keyEnv } : {}),
      transport: 'chat_completions',
      context_length: server.contextLength,
      // The list comes from Helena; Hermes need not ask the server at every start.
      discover_models: false,
      // The agent's own turns think (see above); llama-server merges this over its default.
      extra_body: { chat_template_kwargs: { enable_thinking: true } },
      models: Object.fromEntries(
        server.models.map((model) => [
          model.id,
          {
            ...(model.contextLength ? { context_length: model.contextLength } : {}),
            ...(model.vision ? { supports_vision: true } : {}),
          },
        ]),
      ),
    };
  }
  const auxiliary: Record<string, Record<string, unknown>> = {};
  for (const helper of localAi.helpers) {
    auxiliary[helper.task] = {
      provider: helper.provider,
      model: helper.model,
      // The main model, exactly as without local AI, whenever the local one fails.
      fallback_chain: [{ provider: 'main' }],
    };
  }
  return {
    providers,
    ...(Object.keys(auxiliary).length > 0 ? { auxiliary } : {}),
  };
}

registerProfileContribution({
  id: 'local-ai',
  hermesConfig: ({ runtime, snapshot }) =>
    runtime === 'hermes' ? hermesLocalAiConfig(snapshot.localAi) : {},
});

// Where a model id sends a run: a local model id names its provider and the model as its
// server knows it; any other id is left to the catalog.
export function localRoute(
  model: string | null | undefined,
): { provider: string; model: string } | null {
  const parsed = parseLocalModelId(model);
  return parsed ? { provider: parsed.provider, model: parsed.model } : null;
}

// The variables the local servers' keys reach Hermes in, for the servers the snapshot names.
export function localKeyVariables(localAi: RuntimeLocalAi | null | undefined): string[] {
  return (localAi?.servers ?? []).flatMap((server) => (server.keyEnv ? [server.keyEnv] : []));
}
