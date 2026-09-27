import type { AgentPresence, AgentRuntime } from '@/components/common/page/AgentAvatar';
import type { AiAgent } from '@/lib/api/endpoints/agents';
export { openWorkByAgent } from '@/utils/agentWorkState';

// A runner is online while it keeps polling; the reference runner polls every few
// seconds, so a gap this long means it is gone rather than between polls. The same
// window the settings' runner status uses (components/common/agent-chat/runnerOnline).
const ONLINE_WINDOW_MS = 90_000;

// What the chat says about an agent, beside its name: whether it can be chatted with
// at all (a template cannot), whether its runner is there to answer, and whether it is
// working right now. `label` names the one line of state the picker shows.
export type ChatAgentLabel =
  'running' | 'waiting' | 'ready' | 'offline' | 'never' | 'paused' | 'template';

export interface ChatAgentState {
  presence: AgentPresence;
  label: ChatAgentLabel;
  runtime: AgentRuntime | null;
  selectable: boolean;
  // Whether a question sent now would be picked up: a runner is polling and the agent
  // is not paused. A question to an agent that is not is still queued, and answered
  // once it is.
  online: boolean;
}

// Which engine a runner reported running the agent (runtimeState.adapter), as the short
// runtime code the avatar shows. Null while no runner has reported one.
export function agentRuntime(agent: Pick<AiAgent, 'runtimeState'>): AgentRuntime | null {
  const adapter = agent.runtimeState?.adapter?.toLowerCase() ?? null;
  if (!adapter) return null;
  if (adapter.includes('hermes')) return 'hermes';
  if (adapter.includes('claude')) return 'claude';
  if (adapter.includes('codex')) return 'codex';
  return 'external';
}

export function isAgentOnline(agent: Pick<AiAgent, 'lastSeenAt'>, now: number): boolean {
  return agent.lastSeenAt != null && now - new Date(agent.lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

// The open work of each agent in a recent timeline read, newest first: 'waiting' wins
// over 'running' — an agent that needs the member is the one thing worth pointing at.
export function chatAgentState(
  agent: Pick<AiAgent, 'template' | 'pausedAt' | 'lastSeenAt' | 'runtimeState'>,
  work: 'running' | 'waiting' | undefined,
  now: number,
): ChatAgentState {
  const runtime = agentRuntime(agent);
  if (agent.template) {
    return { presence: 'offline', label: 'template', runtime, selectable: false, online: false };
  }
  const online = isAgentOnline(agent, now);
  if (agent.pausedAt) {
    return { presence: 'offline', label: 'paused', runtime, selectable: true, online: false };
  }
  if (work === 'waiting') {
    return { presence: 'waiting', label: 'waiting', runtime, selectable: true, online };
  }
  if (!online) {
    const label = agent.lastSeenAt ? 'offline' : 'never';
    return { presence: 'offline', label, runtime, selectable: true, online: false };
  }
  if (work === 'running') {
    return { presence: 'running', label: 'running', runtime, selectable: true, online: true };
  }
  return { presence: 'ready', label: 'ready', runtime, selectable: true, online: true };
}
