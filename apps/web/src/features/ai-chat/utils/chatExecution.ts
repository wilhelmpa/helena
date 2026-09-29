import type { ModelCheck } from '@/lib/api/endpoints/agentRuntimeSync';
import type { AgentRuntimeKind } from '@/lib/api/endpoints/agents';
import { shortModel } from '@/features/local-ai/utils/localAi';

// What ran an answer, for the "via …" line under it. Kept apart from the component so the
// naming can be tested.
export type ChatExecution = 'local' | 'claude' | 'codex' | 'hermes' | 'command' | 'webhook';

const LOCAL_PREFIX = 'helena-';

// A provider or model of Lokale KI is named `helena-<slug>` (`custom:helena-local`,
// `helena-halogen/halogen-qwen3.8-flash-next`); the runtime reads it back without the prefix.
const isLocalName = (value: string | null | undefined) =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^custom:/, '')
    .startsWith(LOCAL_PREFIX);

// Which execution answered: a local model whatever runtime carried it (the runtime's own
// name says nothing then, and a local model behind Hermes is not "Hermes (Cloud)"), else the
// runtime the run reported, else the agent's own. Null when nothing says.
export function chatExecution(
  check: ModelCheck | null | undefined,
  agentRuntime?: AgentRuntimeKind | null,
): ChatExecution | null {
  const used = check?.used;
  if (isLocalName(used?.provider) || isLocalName(used?.model)) return 'local';
  // The configured local model answered itself: no fallback to the cloud, and the model
  // that ran is the configured one (Hermes reports it without the `helena-<slug>/` prefix).
  const configured = check?.configured.model;
  if (
    !check?.fallback &&
    isLocalName(configured) &&
    used?.model &&
    shortModel(configured) === shortModel(used.model)
  ) {
    return 'local';
  }
  const runtime = check?.runtime ?? agentRuntime ?? undefined;
  if (runtime === 'claude' || runtime === 'claude-code') return 'claude';
  if (runtime === 'codex') return 'codex';
  if (runtime === 'hermes') return 'hermes';
  if (runtime === 'command' || runtime === 'webhook') return runtime;
  return null;
}
