import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';

// Open timeline entries keep the same meaning in chat, agent lists, and the organization chart.
const RUNNING = new Set(['pending', 'running', 'streaming']);
const WAITING = new Set(['waiting', 'suspended']);

export function openWorkByAgent(
  entries: Pick<AgentActivityEntry, 'status' | 'agent'>[],
): Map<number, 'running' | 'waiting'> {
  const work = new Map<number, 'running' | 'waiting'>();
  for (const entry of entries) {
    if (!entry.agent) continue;
    if (WAITING.has(entry.status)) work.set(entry.agent.id, 'waiting');
    else if (RUNNING.has(entry.status) && !work.has(entry.agent.id)) {
      work.set(entry.agent.id, 'running');
    }
  }
  return work;
}
