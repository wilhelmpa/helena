// browser_task's settings and Browser 2.0 (docs/helena-decisions/browser-task.md): the kinds of
// decision service, "Verbindung testen", a project's "Browser-Steuerung", the instance default
// and the test area's runs.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  cancelLabRun,
  getBrowserControl,
  getDecisionBackends,
  getInstanceBrowserControl,
  getLabOptions,
  getLabRun,
  labRunActive,
  listLabRuns,
  listProjectConnections,
  listTeamConnections,
  startLabRun,
  testDecisionConnection,
  updateBrowserControl,
  updateInstanceBrowserControl,
  type BrowserControlPatch,
  type InstanceBrowserControl,
  type LabScope,
  type StartLabRun,
} from '@/lib/api/endpoints/browserTask';
import { qk } from '@/services/queryKeys';

const keys = {
  backends: ['decision-backends'] as const,
  control: (projectKey: string) => ['browser-control', projectKey] as const,
  projectConnections: (projectKey: string) =>
    ['browser-control', projectKey, 'connections'] as const,
  teamConnections: (teamId: number) => ['browser-control', 'team', teamId] as const,
  instance: ['browser-control', 'instance'] as const,
  lab: (scope: LabScope) =>
    ['browser-lab', scope.kind === 'project' ? scope.projectKey : `home-${scope.teamId}`] as const,
};

export function useDecisionBackendsQuery() {
  return useQuery({
    queryKey: keys.backends,
    queryFn: getDecisionBackends,
    staleTime: 5 * 60_000,
  });
}

const TEST_CODES = ['ok', 'no_key', 'key_refused', 'address_not_allowed'] as const;
type TestCode = (typeof TEST_CODES)[number];
const isTestCode = (message: string): message is TestCode =>
  (TEST_CODES as readonly string[]).includes(message);

// The words for a test result the API reports as a code.
export function useConnectionTestMessage() {
  const t = useTranslations('browserLab.test.codes');
  return (message: string) => (isTestCode(message) ? t(message) : message);
}

export function useTestDecisionConnection(teamId: number) {
  const qc = useQueryClient();
  const t = useTranslations('browserLab.test');
  const words = useConnectionTestMessage();
  return useMutation({
    mutationFn: (credentialId: number) => testDecisionConnection(teamId, credentialId),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(
          t('succeeded', {
            models: result.models.join(', ') || '–',
            ms: result.latencyMs ?? 0,
          }),
        );
      } else {
        toast.error(t('failed', { reason: words(result.message) }));
      }
      void qc.invalidateQueries({ queryKey: qk.credentials(teamId) });
    },
    onError: (error: Error) => toast.error(t('failed', { reason: error.message })),
  });
}

export function useBrowserControlQuery(projectKey: string) {
  return useQuery({
    queryKey: keys.control(projectKey),
    queryFn: () => getBrowserControl(projectKey),
  });
}

export function useUpdateBrowserControl(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: BrowserControlPatch) => updateBrowserControl(projectKey, patch),
    onSuccess: (data) => qc.setQueryData(keys.control(projectKey), data),
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useProjectConnectionsQuery(projectKey: string) {
  return useQuery({
    queryKey: keys.projectConnections(projectKey),
    queryFn: () => listProjectConnections(projectKey),
  });
}

export function useTeamConnectionsQuery(teamId: number | null) {
  return useQuery({
    queryKey: keys.teamConnections(teamId ?? 0),
    queryFn: () => listTeamConnections(teamId!),
    enabled: teamId !== null,
  });
}

export function useInstanceBrowserControlQuery() {
  return useQuery({ queryKey: keys.instance, queryFn: getInstanceBrowserControl });
}

export function useUpdateInstanceBrowserControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<InstanceBrowserControl>) => updateInstanceBrowserControl(patch),
    onSuccess: (data) => qc.setQueryData(keys.instance, data),
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useLabOptionsQuery(scope: LabScope | null) {
  return useQuery({
    queryKey: scope ? [...keys.lab(scope), 'options'] : ['browser-lab', 'none'],
    queryFn: () => getLabOptions(scope!),
    enabled: scope !== null,
  });
}

// The runs, asked again every two seconds while one of them is still going.
export function useLabRunsQuery(scope: LabScope | null) {
  return useQuery({
    queryKey: scope ? [...keys.lab(scope), 'runs'] : ['browser-lab', 'none', 'runs'],
    queryFn: () => listLabRuns(scope!),
    enabled: scope !== null,
    refetchInterval: (query) => ((query.state.data?.runs ?? []).some(labRunActive) ? 2_000 : false),
  });
}

// One run with its steps, every second while it runs.
export function useLabRunQuery(scope: LabScope | null, runId: number | null) {
  return useQuery({
    queryKey: scope ? [...keys.lab(scope), 'run', runId] : ['browser-lab', 'none', 'run'],
    queryFn: () => getLabRun(scope!, runId!),
    enabled: scope !== null && runId !== null,
    refetchInterval: (query) =>
      query.state.data && labRunActive(query.state.data) ? 1_000 : false,
  });
}

export function useStartLabRun(scope: LabScope | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StartLabRun) => startLabRun(scope!, body),
    onSuccess: () => {
      if (scope) void qc.invalidateQueries({ queryKey: [...keys.lab(scope), 'runs'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useCancelLabRun(scope: LabScope | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: number) => cancelLabRun(scope!, runId),
    onSuccess: () => {
      if (scope) void qc.invalidateQueries({ queryKey: keys.lab(scope) });
    },
  });
}
