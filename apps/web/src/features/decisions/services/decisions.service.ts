// Typed decisions (docs/helena-decisions/decisions.md): the classes' settings and evals, the
// decision log, and the model router's switches.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  cancelDecisionEval,
  correctDecision,
  getRouterOverview,
  listDecisionClasses,
  listDecisionLog,
  setAgentRouter,
  setProjectRouter,
  startDecisionEval,
  updateDecisionClass,
  type DecisionClassPatch,
} from '@/lib/api/endpoints/decisions';

const keys = {
  classes: (teamId: number) => ['decisions', teamId, 'classes'] as const,
  log: (teamId: number, classId: string, status: string) =>
    ['decisions', teamId, 'log', classId, status] as const,
  router: (teamId: number) => ['decisions', teamId, 'router'] as const,
};

export function useDecisionClassesQuery(teamId: number | null) {
  return useQuery({
    queryKey: keys.classes(teamId ?? 0),
    queryFn: () => listDecisionClasses(teamId!),
    enabled: teamId !== null,
    // An eval runs in the background: poll while one does.
    refetchInterval: (query) =>
      query.state.data?.classes.some((cls) => cls.latestEval?.status === 'running') ? 3000 : false,
  });
}

// The reasons the API gives for refusing to switch a class on, in the reader's words.
export function useDecisionReason() {
  const t = useTranslations('decisions.reasons');
  return (reason: string | null | undefined) => {
    switch (reason) {
      case 'no_connection':
      case 'no_eval':
      case 'eval_failed':
      case 'eval_threshold':
        return t(reason);
      default:
        return reason ?? '';
    }
  };
}

export function useUpdateDecisionClass(teamId: number) {
  const qc = useQueryClient();
  const reason = useDecisionReason();
  return useMutation({
    mutationFn: ({ classId, patch }: { classId: string; patch: DecisionClassPatch }) =>
      updateDecisionClass(teamId, classId, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.classes(teamId) }),
    onError: (error: Error) => toast.error(reason(error.message)),
  });
}

export function useStartDecisionEval(teamId: number) {
  const qc = useQueryClient();
  const reason = useDecisionReason();
  return useMutation({
    mutationFn: ({ classId, credentialId }: { classId: string; credentialId?: number | null }) =>
      startDecisionEval(teamId, classId, { credentialId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.classes(teamId) }),
    onError: (error: Error) => toast.error(reason(error.message)),
  });
}

export function useCancelDecisionEval(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (evalId: number) => cancelDecisionEval(teamId, evalId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.classes(teamId) }),
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDecisionLogQuery(teamId: number | null, classId: string, status: string) {
  return useQuery({
    queryKey: keys.log(teamId ?? 0, classId, status),
    queryFn: () =>
      listDecisionLog(teamId!, {
        classId: classId || undefined,
        status: status || undefined,
        limit: 100,
      }),
    enabled: teamId !== null,
  });
}

export function useCorrectDecision(teamId: number) {
  const qc = useQueryClient();
  const t = useTranslations('decisions.log');
  return useMutation({
    mutationFn: ({ decisionId, outcome }: { decisionId: number; outcome: string }) =>
      correctDecision(teamId, decisionId, outcome),
    onSuccess: () => {
      toast.success(t('corrected'));
      void qc.invalidateQueries({ queryKey: ['decisions', teamId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRouterOverviewQuery(teamId: number | null) {
  return useQuery({
    queryKey: keys.router(teamId ?? 0),
    queryFn: () => getRouterOverview(teamId!),
    enabled: teamId !== null,
  });
}

export function useSetAgentRouter(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      ...body
    }: {
      agentId: number;
      enabled?: boolean;
      allowUpgrade?: boolean;
    }) => setAgentRouter(teamId, agentId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.router(teamId) }),
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useSetProjectRouter(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, enabled }: { projectId: number; enabled: boolean }) =>
      setProjectRouter(teamId, projectId, enabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.router(teamId) }),
    onError: (error: Error) => toast.error(error.message),
  });
}
