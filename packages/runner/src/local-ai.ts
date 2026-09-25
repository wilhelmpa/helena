import {
  parseLocalModelId,
  type RuntimeDefaults,
  type RuntimeLocalAi,
  type RuntimePolicySnapshot,
} from '@helena/sdk';
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
//
// A local server that stops never blocks an agent: the API hands the configured model to a
// run or chat answer whose local server does not answer when it starts, and while local AI
// is on the profile carries that configured model as the first entry of Hermes'
// fallback_providers (withLocalFallback), so a server that fails during a turn gives way to
// it after Hermes' retries. The local provider fails fast (LOCAL_TIMEOUTS).

// Hermes' per-provider deadlines for a server on this machine (it has no connect timeout or
// retry count per provider). A server that is down refuses the connection at once (directly,
// or through the isolated agent's forwarder, which closes it), so Hermes retries
// (agent.api_max_retries, 3, with backoff) and then takes the fallback, in well under a
// minute. These bound a server that accepts and then hangs: `stale_timeout_seconds`, no byte
// of the answer for this long (Hermes' default 180 s; a 64k prompt can take two minutes before
// its first token), and `request_timeout_seconds`, the whole answer (default 1800 s).
export const LOCAL_TIMEOUTS = {
  stale_timeout_seconds: 240,
  request_timeout_seconds: 900,
} as const;

export interface FallbackModel {
  provider: string;
  model: string;
}

// The model an agent runs on without local AI, as a Hermes fallback entry: its own model with
// the provider the runner's catalog names, or, when that is local or unset, the runtime's
// default (the deployment's config.yaml). Null while neither is known (the runner has not
// read the default yet) or both are local.
export function cloudFallback(input: {
  model: string | null | undefined;
  providerOf: (model: string) => string | undefined;
  defaults: RuntimeDefaults | null;
  runnerProvider?: string;
}): FallbackModel | null {
  if (input.model && !parseLocalModelId(input.model)) {
    const provider = input.providerOf(input.model);
    return provider ? { provider, model: input.model } : null;
  }
  const model = input.defaults?.model;
  if (!model || parseLocalModelId(model)) return null;
  const provider = input.defaults?.provider ?? input.runnerProvider;
  return provider ? { provider, model } : null;
}

// While local AI is on, the snapshot the profile is written from, with the agent's cloud model
// first in its fallback chain and the chain the owner configured after it. Hermes skips an
// entry that is the backend that just failed, so a run on the cloud model loses nothing.
export function withLocalFallback(
  snapshot: RuntimePolicySnapshot,
  cloud: FallbackModel | null,
): RuntimePolicySnapshot {
  if (!snapshot.localAi || !cloud) return snapshot;
  const configured = snapshot.hermes?.fallbackModels ?? [];
  const chain = [
    cloud,
    ...configured.filter(
      (entry) => entry.provider !== cloud.provider || entry.model !== cloud.model,
    ),
  ];
  return { ...snapshot, hermes: { ...snapshot.hermes, fallbackModels: chain } };
}

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
      ...LOCAL_TIMEOUTS,
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
