// What an agent learned in its Hermes runtime, and the owner's decisions on it, which the
// agent's runner carries out on its next sync.

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  type RuntimeActionInput,
  getLearnedSkill,
  listChatReflections,
  listRuntimeActions,
  promoteLearnedSkill,
  queueRuntimeAction,
} from '@/lib/api/endpoints/agentLearning';
import { waitingCount } from '../utils/agentLearning';
import { qk } from '@/services/queryKeys';

// A runner syncs every few seconds while it waits for work.
const ACTION_REFRESH_MS = 5_000;

// Read again while an action waits. Once one is carried out the agent is read again too,
// since its runner reports the inventory the action changed.
export function useRuntimeActionsQuery(teamId: number, agentId: number | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.agentRuntimeActions(teamId, agentId ?? 0),
    queryFn: () => listRuntimeActions(teamId, agentId!),
    enabled: agentId != null,
    refetchInterval: (current) =>
      waitingCount(current.state.data) > 0 ? ACTION_REFRESH_MS : false,
  });
  const waiting = waitingCount(query.data);
  const previous = useRef(waiting);
  useEffect(() => {
    if (waiting < previous.current)
      void qc.invalidateQueries({ queryKey: qk.teamAiAgents(teamId) });
    previous.current = waiting;
  }, [qc, teamId, waiting]);
  return query;
}

export function useLearnedSkillQuery(teamId: number, agentId: number, path: string | null) {
  return useQuery({
    queryKey: qk.learnedSkill(teamId, agentId, path ?? ''),
    queryFn: () => getLearnedSkill(teamId, agentId, path!),
    enabled: path != null,
  });
}

// The runner carries an action out later, so its queueing is confirmed.
export function useQueueRuntimeAction(teamId: number, agentId: number) {
  const t = useTranslations('teams.agents.abilities.learning');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RuntimeActionInput) => queueRuntimeAction(teamId, agentId, input),
    onSuccess: () => {
      toast.success(t('queued'));
      void qc.invalidateQueries({ queryKey: qk.agentRuntimeActions(teamId, agentId) });
    },
  });
}

export function usePromoteLearnedSkill(teamId: number, agentId: number) {
  const t = useTranslations('teams.agents.abilities.learning');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => promoteLearnedSkill(teamId, agentId, path),
    onSuccess: (skill) => {
      toast.success(t('promoted', { name: skill.name }));
      void qc.invalidateQueries({ queryKey: qk.agentSkills(teamId) });
      void qc.invalidateQueries({ queryKey: qk.agentSkillLinks(teamId, agentId) });
      void qc.invalidateQueries({ queryKey: qk.agentRuntimeActions(teamId, agentId) });
    },
  });
}

// The agent's latest reflections on its chats, for its learning settings.
export function useChatReflectionsQuery(teamId: number, agentId: number | null) {
  return useQuery({
    queryKey: qk.agentChatReflections(teamId, agentId ?? 0),
    queryFn: () => listChatReflections(teamId, agentId!),
    enabled: agentId != null,
  });
}
