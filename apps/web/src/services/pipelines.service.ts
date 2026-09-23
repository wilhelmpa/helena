import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { PageParams } from '@/lib/api/core/paging';
import type { ApprovalDecision } from '@/lib/api/endpoints/approvals';
import {
  cancelPipelineRun,
  createPipelineTemplate,
  createProjectPipeline,
  decidePipelineApproval,
  deletePipeline,
  getPipeline,
  getPipelineRun,
  getPipelineVersion,
  getProjectPipelineContext,
  getTeamPipelineContext,
  listBuiltinPipelines,
  listIssuePipelineRuns,
  listPipelineApprovals,
  listPipelineRuns,
  listPipelineTemplates,
  listPipelineVersions,
  listProjectPipelines,
  listStartablePipelines,
  retryPipelineRun,
  setProjectPipeline,
  startPipelineRun,
  updatePipeline,
  validatePipelineTemplate,
  validateProjectPipeline,
  type Pipeline,
  type PipelineDefinition,
  type PipelineInput,
  type PipelineRun,
  type PipelineRunFilters,
} from '@/lib/api/endpoints/pipelines';
import { qk } from '@/services/queryKeys';

// Where a workflow is edited: a template in the team's library, or a workflow of one
// project. It decides which context the pickers read and how a draft is validated.
export type PipelineScope = { teamId: number; projectKey: null } | { projectKey: string };

const scopeKey = (scope: PipelineScope) =>
  scope.projectKey === null ? `team:${scope.teamId}` : `project:${scope.projectKey}`;

export const usePipelineTemplates = (teamId: number) =>
  useQuery({
    queryKey: qk.pipelineTemplates(teamId),
    queryFn: () => listPipelineTemplates(teamId),
  });

export const useBuiltinPipelines = (teamId: number) =>
  useQuery({
    queryKey: qk.pipelineBuiltins(teamId),
    queryFn: () => listBuiltinPipelines(teamId),
    staleTime: Infinity,
  });

export function useCreatePipelineTemplate(teamId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PipelineInput) => createPipelineTemplate(teamId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.anyPipelines }),
  });
}

export const useProjectPipelines = (projectKey: string) =>
  useQuery({
    queryKey: qk.projectPipelines(projectKey),
    queryFn: () => listProjectPipelines(projectKey),
  });

export function useCreateProjectPipeline(projectKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PipelineInput) => createProjectPipeline(projectKey, input),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.anyPipelines }),
  });
}

export function useSetProjectPipeline(projectKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { pipelineId: number; enabled: boolean; roles: Record<string, number> }) =>
      setProjectPipeline(projectKey, input.pipelineId, {
        enabled: input.enabled,
        roles: input.roles,
      }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: qk.projectPipelines(projectKey) }),
        client.invalidateQueries({ queryKey: qk.anyIssue }),
      ]),
  });
}

export const usePipelineContext = (scope: PipelineScope) =>
  useQuery({
    queryKey: qk.pipelineContext(scopeKey(scope)),
    queryFn: () =>
      scope.projectKey === null
        ? getTeamPipelineContext(scope.teamId)
        : getProjectPipelineContext(scope.projectKey),
  });

// The problems of a draft. Keyed by the draft itself, so going back to an earlier
// state answers from the cache; the previous answer stays shown while a new one loads.
export function usePipelineValidation(
  scope: PipelineScope,
  definition: PipelineDefinition | null,
  roles?: Record<string, number>,
) {
  const draft = JSON.stringify({ definition, roles });
  return useQuery({
    queryKey: qk.pipelineValidation(scopeKey(scope), draft),
    queryFn: () =>
      scope.projectKey === null
        ? validatePipelineTemplate(scope.teamId, definition!)
        : validateProjectPipeline(scope.projectKey, {
            definition: definition!,
            template: false,
            roles,
          }),
    enabled: definition !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

export const usePipeline = (pipelineId: number) =>
  useQuery({ queryKey: qk.pipeline(pipelineId), queryFn: () => getPipeline(pipelineId) });

export function useUpdatePipeline(pipelineId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PipelineInput> & { baseVersion?: number }) =>
      updatePipeline(pipelineId, patch),
    onSuccess: (saved: Pipeline) => {
      client.setQueryData(qk.pipeline(pipelineId), saved);
      return Promise.all([
        client.invalidateQueries({ queryKey: qk.anyPipelines }),
        client.invalidateQueries({ queryKey: qk.pipelineVersions(pipelineId) }),
      ]);
    },
  });
}

export function useDeletePipeline() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (pipelineId: number) => deletePipeline(pipelineId),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.anyPipelines }),
  });
}

export const usePipelineVersions = (pipelineId: number) =>
  useQuery({
    queryKey: qk.pipelineVersions(pipelineId),
    queryFn: () => listPipelineVersions(pipelineId),
  });

export const usePipelineVersion = (pipelineId: number, version: number | null) =>
  useQuery({
    queryKey: qk.pipelineVersion(pipelineId, version ?? 0),
    queryFn: () => getPipelineVersion(pipelineId, version!),
    enabled: version !== null,
    staleTime: Infinity,
  });

export const usePipelineRuns = (
  pipelineId: number,
  params: PageParams,
  filters: PipelineRunFilters,
) =>
  useQuery({
    queryKey: qk.pipelineRuns(pipelineId, params, filters),
    queryFn: () => listPipelineRuns(pipelineId, params, filters),
    placeholderData: keepPreviousData,
  });

export const useIssuePipelines = (issueId: number, enabled: boolean) =>
  useQuery({
    queryKey: qk.issuePipelines(issueId),
    queryFn: () => listStartablePipelines(issueId),
    enabled,
  });

export const useIssuePipelineRuns = (issueId: number, enabled: boolean) =>
  useQuery({
    queryKey: qk.issuePipelineRuns(issueId),
    queryFn: () => listIssuePipelineRuns(issueId),
    enabled,
  });

export const usePipelineRun = (runId: string | null) =>
  useQuery({
    queryKey: qk.pipelineRun(runId ?? ''),
    queryFn: () => getPipelineRun(runId!),
    enabled: runId !== null,
  });

// A changed run is written into its own cache entry and every list that may show it
// is read again.
function useRefreshRun() {
  const client = useQueryClient();
  return (run: PipelineRun) => {
    client.setQueryData(qk.pipelineRun(run.id), run);
    return Promise.all([
      client.invalidateQueries({ queryKey: qk.anyPipelineRuns }),
      client.invalidateQueries({ queryKey: qk.pipelineApprovals }),
      run.issueId !== null
        ? client.invalidateQueries({ queryKey: qk.issuePipelineRuns(run.issueId) })
        : undefined,
    ]);
  };
}

export function useStartPipelineRun() {
  const refresh = useRefreshRun();
  return useMutation({
    mutationFn: (input: { issueId: number; pipelineId: number; dryRun: boolean }) =>
      startPipelineRun(input.issueId, input.pipelineId, input.dryRun),
    onSuccess: refresh,
  });
}

export function useCancelPipelineRun() {
  const refresh = useRefreshRun();
  return useMutation({ mutationFn: cancelPipelineRun, onSuccess: refresh });
}

export function useRetryPipelineRun() {
  const refresh = useRefreshRun();
  return useMutation({ mutationFn: retryPipelineRun, onSuccess: refresh });
}

// The decided approval leaves the Approvals list before a caller's own onSuccess would
// run, so the confirmation is shown here.
export function useDecidePipelineApproval() {
  const refresh = useRefreshRun();
  const t = useTranslations('pipelines.runs');
  return useMutation({
    mutationFn: ({ runId, decision }: { runId: string; decision: ApprovalDecision }) =>
      decidePipelineApproval(runId, decision),
    onSuccess: (run, { decision }) => {
      toast.success(t(decision.approved ? 'approvedToast' : 'rejectedToast'));
      return refresh(run);
    },
  });
}

export const usePipelineApprovals = () =>
  useQuery({ queryKey: qk.pipelineApprovals, queryFn: listPipelineApprovals });
