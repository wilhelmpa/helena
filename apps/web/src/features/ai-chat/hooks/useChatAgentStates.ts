'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAgentActivity } from '@/lib/api/endpoints/agentActivity';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { qk } from '@/services/queryKeys';
import { chatAgentState, openWorkByAgent, type ChatAgentState } from '../utils/agentPresence';

// How often the states are looked at again: the agents list refetches on its own (the
// runner's last poll), the timeline here, and "now" ticks so a runner that stopped
// polling turns offline without a reload.
const REFRESH_MS = 15_000;

// Each agent's state for the chat's pickers and header, keyed by agent id. Reads the
// same recent timeline Home's "Agenten gerade" does (same query key, one request for
// both), so the two always tell the same story.
export function useChatAgentStates(agents: AiAgent[]): Map<number, ChatAgentState> {
  const activity = useQuery({
    queryKey: qk.agentActivity(null, { window: 40 }),
    queryFn: () => listAgentActivity(null, {}, null),
    refetchInterval: REFRESH_MS,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => {
    const work = openWorkByAgent(activity.data?.items ?? []);
    return new Map(
      agents.map((agent) => [agent.id, chatAgentState(agent, work.get(agent.id), now)]),
    );
  }, [agents, activity.data, now]);
}
