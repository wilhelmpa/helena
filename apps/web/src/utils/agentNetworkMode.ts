import type { AgentNetworkMode } from '@/lib/api/endpoints/agentNetwork';

// The mode an agent actually egresses under: its own override when it has one, or
// the project's mode when it does not (null). Pure so the settings form and its
// tests can reason about "who is on the allow list right now" without a component.
export function effectiveAgentMode(
  agentMode: AgentNetworkMode | null,
  projectMode: AgentNetworkMode,
): AgentNetworkMode {
  return agentMode ?? projectMode;
}
