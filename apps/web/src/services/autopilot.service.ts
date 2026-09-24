import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageParams } from '@/lib/api/core/paging';
import {
  decideBudgetCard,
  getAgentAutopilot,
  getProjectAutopilot,
  importModelPrices,
  listModelPrices,
  listPolicyDecisions,
  resetModelPrice,
  setAgentAutopilotLevel,
  setAgentBudgets,
  setModelPrice,
  setModelPriceRate,
  setProjectAutopilotLevel,
  setProjectBudgets,
  type AutopilotLevel,
  type BudgetCardAction,
  type BudgetInput,
  type ManualPriceInput,
  type PolicyOutcome,
} from '@/lib/api/endpoints/autopilot';
import { qk } from '@/services/queryKeys';

// Helena's Autopilot: a change to a level or a budget can change what every Autopilot view
// shows (a project's level is every agent's effective level), so writes refresh them all.

export function useProjectAutopilot(projectKey: string) {
  return useQuery({
    queryKey: qk.projectAutopilot(projectKey),
    queryFn: () => getProjectAutopilot(projectKey),
    enabled: projectKey !== '',
  });
}

export function useAgentAutopilot(teamId: number, agentId: number | null) {
  return useQuery({
    queryKey: qk.agentAutopilot(teamId, agentId ?? 0),
    queryFn: () => getAgentAutopilot(teamId, agentId!),
    enabled: agentId != null && teamId > 0,
  });
}

export function usePolicyDecisions(
  projectKey: string,
  params: PageParams,
  outcome?: PolicyOutcome,
) {
  return useQuery({
    queryKey: qk.policyDecisions(projectKey, params, outcome),
    queryFn: () => listPolicyDecisions(projectKey, params, outcome),
  });
}

function useRefreshAutopilot() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: qk.anyAutopilot }),
      client.invalidateQueries({ queryKey: qk.approvalLists }),
      client.invalidateQueries({ queryKey: qk.approvalsPendingCountAll }),
    ]);
}

export function useSetProjectLevel(projectKey: string) {
  const refresh = useRefreshAutopilot();
  return useMutation({
    mutationFn: (level: AutopilotLevel) => setProjectAutopilotLevel(projectKey, level),
    onSuccess: refresh,
  });
}

export function useSetProjectBudgets(projectKey: string) {
  const refresh = useRefreshAutopilot();
  return useMutation({
    mutationFn: (budgets: BudgetInput[]) => setProjectBudgets(projectKey, budgets),
    onSuccess: refresh,
  });
}

export function useSetAgentLevel(teamId: number, agentId: number) {
  const refresh = useRefreshAutopilot();
  return useMutation({
    mutationFn: (input: { level: AutopilotLevel | null; raise?: boolean }) =>
      setAgentAutopilotLevel(teamId, agentId, input),
    onSuccess: refresh,
  });
}

export function useSetAgentBudgets(teamId: number, agentId: number) {
  const refresh = useRefreshAutopilot();
  return useMutation({
    mutationFn: (budgets: BudgetInput[]) => setAgentBudgets(teamId, agentId, budgets),
    onSuccess: refresh,
  });
}

export function useDecideBudgetCard() {
  const refresh = useRefreshAutopilot();
  return useMutation({
    mutationFn: ({ id, action, limit }: { id: number; action: BudgetCardAction; limit?: number }) =>
      decideBudgetCard(id, { action, limit }),
    onSuccess: refresh,
  });
}

export function useModelPrices() {
  return useQuery({ queryKey: qk.modelPrices, queryFn: listModelPrices });
}

function useRefreshPrices() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: qk.modelPrices }),
      client.invalidateQueries({ queryKey: qk.anyAutopilot }),
    ]);
}

export function useSetModelPrice() {
  const refresh = useRefreshPrices();
  return useMutation({
    mutationFn: ({ model, input }: { model: string; input: ManualPriceInput }) =>
      setModelPrice(model, input),
    onSuccess: refresh,
  });
}

export function useResetModelPrice() {
  const refresh = useRefreshPrices();
  return useMutation({ mutationFn: resetModelPrice, onSuccess: refresh });
}

export function useImportModelPrices() {
  const refresh = useRefreshPrices();
  return useMutation({ mutationFn: importModelPrices, onSuccess: refresh });
}

export function useSetModelPriceRate() {
  const refresh = useRefreshPrices();
  return useMutation({ mutationFn: setModelPriceRate, onSuccess: refresh });
}
