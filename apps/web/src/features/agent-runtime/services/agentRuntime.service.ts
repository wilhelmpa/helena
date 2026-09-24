// What an agent's runtime keeps and does, read and steered through its runner: sessions,
// transcripts, logs, health, curator, a run's timeline, the token ledger, the runtime's
// proposals, the emergency stop and the instance's runtime settings.

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';
import type { FallbackModel } from '@/lib/api/endpoints/agents';
import {
  checkHermesUpdate,
  continueRun,
  countProposals,
  decideProposal,
  getAgentUsage,
  getCuratorStatus,
  getEmergencyStop,
  getHermesUpdate,
  getRunDetail,
  getRunEvents,
  getRuntimeDefaults,
  getRuntimeHealth,
  getRuntimeLogs,
  getRuntimeRequest,
  getRuntimeVersion,
  getTranscript,
  listMemoryRevisions,
  listProposals,
  listRuntimeSessions,
  requestHermesUpdate,
  runCurator,
  setEmergencyStop,
  setRuntimeDefaults,
  type UsageDimension,
} from '@/lib/api/endpoints/agentRuntime';
import { qk } from '@/services/queryKeys';

// A runtime read waits on the agent's runner, so a failure is shown where it happened and
// not retried behind the person's back.
const RUNTIME_READ = { retry: false, staleTime: 15_000 } as const;

export function useRuntimeSessions(
  teamId: number,
  agentId: number,
  opts: { q: string; offset: number },
) {
  return useQuery({
    queryKey: qk.agentRuntime(teamId, agentId, 'sessions', opts),
    queryFn: () =>
      listRuntimeSessions(teamId, agentId, {
        q: opts.q || undefined,
        offset: opts.offset,
        limit: 25,
      }),
    ...RUNTIME_READ,
  });
}

export function useTranscript(
  teamId: number,
  agentId: number,
  sessionId: string | null,
  live = false,
) {
  return useQuery({
    queryKey: qk.agentRuntime(teamId, agentId, 'transcript', sessionId),
    queryFn: () => getTranscript(teamId, agentId, sessionId!, { limit: 1000 }),
    enabled: sessionId != null,
    refetchInterval: live ? 5_000 : false,
    ...RUNTIME_READ,
  });
}

export function useRuntimeLogs(
  teamId: number,
  agentId: number,
  opts: { sessionId?: string | null; lines: number; level?: string | null },
  enabled = true,
) {
  return useQuery({
    queryKey: qk.agentRuntime(teamId, agentId, 'logs', opts),
    queryFn: () => getRuntimeLogs(teamId, agentId, opts),
    enabled,
    ...RUNTIME_READ,
  });
}

// `hermes doctor` takes a while, so it runs when asked, not when the panel opens.
export function useRuntimeHealth(teamId: number, agentId: number, enabled: boolean) {
  return useQuery({
    queryKey: qk.agentRuntime(teamId, agentId, 'health'),
    queryFn: () => getRuntimeHealth(teamId, agentId),
    enabled,
    ...RUNTIME_READ,
    staleTime: 60_000,
  });
}

export function useRuntimeVersion(teamId: number, agentId: number) {
  return useQuery({
    queryKey: qk.agentRuntime(teamId, agentId, 'version'),
    queryFn: () => getRuntimeVersion(teamId, agentId),
    ...RUNTIME_READ,
    staleTime: 300_000,
  });
}

export function useCuratorStatus(teamId: number, agentId: number) {
  return useQuery({
    queryKey: qk.agentRuntime(teamId, agentId, 'curator'),
    queryFn: () => getCuratorStatus(teamId, agentId),
    ...RUNTIME_READ,
  });
}

// A curator review runs longer than a request waits: it is queued, and its outcome is
// read from the request until the runner answered.
export function useRunCurator(teamId: number, agentId: number) {
  const t = useTranslations('agentRuntime.runtime');
  const qc = useQueryClient();
  const [requestId, setRequestId] = useState<number | null>(null);
  const state = useQuery({
    queryKey: qk.agentRuntime(teamId, agentId, 'request', requestId),
    queryFn: () => getRuntimeRequest(teamId, agentId, requestId!),
    enabled: requestId != null,
    refetchInterval: (query) =>
      query.state.data && ['answered', 'failed'].includes(query.state.data.status) ? false : 3_000,
    retry: false,
  });
  const done = state.data?.status === 'answered' || state.data?.status === 'failed';
  useEffect(() => {
    if (!done) return;
    if (state.data?.status === 'answered') toast.success(t('curatorDone'));
    else toast.error(state.data?.error ?? t('curatorFailed'));
    void qc.invalidateQueries({ queryKey: qk.agentRuntime(teamId, agentId, 'curator') });
  }, [done, qc, state.data, t, teamId, agentId]);
  const start = useMutation({
    mutationFn: () => runCurator(teamId, agentId),
    onSuccess: (answer) => setRequestId(answer.requestId),
  });
  return { start, running: requestId != null && !done, state: state.data };
}

export function useRunDetail(teamId: number, agentId: number, runId: number | null) {
  return useQuery({
    queryKey: qk.agentRun(teamId, agentId, runId ?? 0),
    queryFn: () => getRunDetail(teamId, agentId, runId!),
    enabled: runId != null,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3_000 : false),
  });
}

const EVENTS_POLL_MS = 1_500;

// The events of a run's timeline: read once, then followed while the run runs.
export function useRunEvents(teamId: number, agentId: number, runId: number | null, live: boolean) {
  const [events, setEvents] = useState<AgUiEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const after = useRef(0);
  useEffect(() => {
    setEvents([]);
    setLoaded(false);
    after.current = 0;
  }, [runId]);
  useEffect(() => {
    if (runId == null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        for (;;) {
          const page = await getRunEvents(teamId, agentId, runId, after.current);
          if (stopped) return;
          if (page.events.length > 0) {
            after.current = page.next;
            setEvents((current) => [...current, ...page.events.map((event) => event.payload)]);
          }
          if (page.events.length < 500) break;
        }
        setLoaded(true);
      } catch {
        setLoaded(true);
      }
      if (!stopped && live) timer = setTimeout(() => void read(), EVENTS_POLL_MS);
    };
    void read();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [teamId, agentId, runId, live]);
  return { events, loaded };
}

export function useContinueRun(teamId: number, agentId: number) {
  const t = useTranslations('agentRuntime.runs');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: number; instruction: string }) =>
      continueRun(teamId, agentId, input.runId, input.instruction),
    onSuccess: () => {
      toast.success(t('continued'));
      void qc.invalidateQueries({ queryKey: ['aiAgents', teamId, agentId] });
    },
  });
}

export function useAgentUsage(
  teamId: number,
  params: { from?: string; to?: string; agentId?: number; by: UsageDimension[] },
) {
  return useQuery({
    queryKey: qk.agentUsage(teamId, params),
    queryFn: () => getAgentUsage(teamId, params),
  });
}

export function useProposals(status: 'pending' | 'decided') {
  return useQuery({
    queryKey: qk.proposals(status),
    queryFn: () => listProposals(status),
    refetchInterval: status === 'pending' ? 15_000 : false,
  });
}

export function useProposalCount() {
  return useQuery({
    queryKey: qk.proposalCount,
    queryFn: countProposals,
    refetchInterval: 30_000,
  });
}

export function useDecideProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; approved: boolean; note?: string | null }) =>
      decideProposal(input.id, input.approved, input.note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agentProposals'] });
      void qc.invalidateQueries({ queryKey: qk.hermesUpdate });
    },
  });
}

export function useMemoryRevisions(teamId: number, agentId: number) {
  return useQuery({
    queryKey: qk.memoryRevisions(teamId, agentId),
    queryFn: () => listMemoryRevisions(teamId, agentId),
  });
}

export function useEmergencyStop() {
  return useQuery({
    queryKey: qk.emergencyStop,
    queryFn: getEmergencyStop,
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useSetEmergencyStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { active: boolean; reason?: string | null }) =>
      setEmergencyStop(input.active, input.reason),
    onSuccess: (value) => qc.setQueryData(qk.emergencyStop, value),
  });
}

export function useRuntimeDefaults(enabled: boolean) {
  return useQuery({ queryKey: qk.runtimeDefaults, queryFn: getRuntimeDefaults, enabled });
}

export function useSetRuntimeDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fallbackModels: FallbackModel[]) => setRuntimeDefaults(fallbackModels),
    onSuccess: (value) => qc.setQueryData(qk.runtimeDefaults, value),
  });
}

export function useHermesUpdate() {
  return useQuery({
    queryKey: qk.hermesUpdate,
    queryFn: getHermesUpdate,
    refetchInterval: (query) => (query.state.data?.proposal?.status === 'approved' ? 5_000 : false),
    retry: false,
  });
}

export function useCheckHermesUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: checkHermesUpdate,
    onSuccess: (value) => qc.setQueryData(qk.hermesUpdate, value),
  });
}

export function useRequestHermesUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: requestHermesUpdate,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.hermesUpdate });
      void qc.invalidateQueries({ queryKey: ['agentProposals'] });
    },
  });
}
