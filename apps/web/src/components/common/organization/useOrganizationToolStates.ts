'use client';

import { useQueries } from '@tanstack/react-query';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { getAiAgentChatEvents, type AgUiEvent } from '@/lib/api/endpoints/agentChat';
import { getRunEvents } from '@/lib/api/endpoints/agentRuntime';

export function activeToolFromEvents(events: AgUiEvent[]): boolean {
  const active = new Set<string>();
  for (const event of events) {
    if (event.type === 'TOOL_CALL_START' && event.toolCallId) active.add(event.toolCallId);
    if (event.type === 'TOOL_CALL_RESULT' && event.toolCallId) active.delete(event.toolCallId);
    if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') active.clear();
  }
  return active.size > 0;
}

export function useOrganizationToolStates(
  teamId: number,
  entries: AgentActivityEntry[],
): Set<number> {
  const active = entries.filter(
    (entry) =>
      entry.agent &&
      (entry.kind === 'agent-run' || entry.kind === 'chat') &&
      (entry.status === 'running' || entry.status === 'streaming'),
  );
  const queries = useQueries({
    queries: active.map((entry) => ({
      queryKey: ['chart-tool-events', teamId, entry.id],
      queryFn: async () => {
        const id = Number(entry.id.split(':')[1]);
        if (!entry.agent || !Number.isInteger(id)) return [];
        const events: AgUiEvent[] = [];
        let after = 0;
        for (let page = 0; page < 10; page++) {
          if (entry.kind === 'chat') {
            const result = await getAiAgentChatEvents(teamId, entry.agent.id, id, after);
            events.push(...result.items.map((item) => item.event));
            if (!result.hasMore || result.nextCursor == null || result.nextCursor === after) break;
            after = result.nextCursor;
          } else {
            const result = await getRunEvents(teamId, entry.agent.id, id, after);
            events.push(...result.events.map((item) => item.payload));
            if (result.events.length < 500 || result.next === after) break;
            after = result.next;
          }
        }
        return events;
      },
      refetchInterval: 5_000,
    })),
  });
  return new Set(
    active
      .filter((entry, index) => entry.agent && activeToolFromEvents(queries[index]?.data ?? []))
      .map((entry) => entry.agent!.id),
  );
}
