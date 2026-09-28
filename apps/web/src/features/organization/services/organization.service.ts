import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AgentAssignmentInput,
  type AgentTokenCeilings,
  type DepartmentInput,
  type GoalInput,
  type ProjectAssignmentInput,
  clearAgentAssignment,
  clearProjectAssignment,
  createDepartment,
  createGoal,
  decideGoalNote,
  deleteDepartment,
  deleteGoal,
  getGoalDetail,
  getOrganization,
  pauseAgent,
  resumeAgent,
  setAgentAssignment,
  setAgentProjectInstructions,
  setAgentTokenCeilings,
  setIssueGoal,
  setProjectAssignment,
  setProjectTokenCeiling,
  updateDepartment,
  setDepartmentBudgets,
  updateGoal,
} from '@/lib/api/endpoints/organization';
import { getAgentUsage } from '@/lib/api/endpoints/agentActivity';
import { getIssueBySeq } from '@/lib/api/endpoints/issues';
import { qk } from '@/services/queryKeys';
import type { BudgetInput } from '@/lib/api/endpoints/autopilot';

export function useOrganizationQuery(teamId: number | null, projectId?: number) {
  return useQuery({
    queryKey:
      teamId == null ? ['organization', 'none'] : [...qk.organization(teamId), projectId ?? 'all'],
    queryFn: () => getOrganization(teamId!, projectId),
    enabled: teamId != null,
  });
}

export function useAgentUsageQuery(projectKey: string) {
  return useQuery({
    queryKey: qk.agentUsage(projectKey),
    queryFn: () => getAgentUsage(projectKey),
  });
}

function useOrganizationMutation<T>(teamId: number, mutationFn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.organization(teamId) }),
  });
}

export function useCreateDepartment(teamId: number) {
  return useOrganizationMutation<DepartmentInput>(teamId, (input) =>
    createDepartment(teamId, input),
  );
}

export function useUpdateDepartment(teamId: number) {
  return useOrganizationMutation<{ id: number; input: Partial<DepartmentInput> }>(
    teamId,
    ({ id, input }) => updateDepartment(teamId, id, input),
  );
}

export function useSetDepartmentBudgets(teamId: number, departmentId: number) {
  return useOrganizationMutation<BudgetInput[]>(teamId, (budgets) =>
    setDepartmentBudgets(teamId, departmentId, budgets),
  );
}

export function useDeleteDepartment(teamId: number) {
  return useOrganizationMutation<number>(teamId, (id) => deleteDepartment(teamId, id));
}

export function useCreateGoal(teamId: number) {
  return useOrganizationMutation<GoalInput>(teamId, (input) => createGoal(teamId, input));
}

export function useUpdateGoal(teamId: number) {
  return useOrganizationMutation<{ id: number; input: Partial<GoalInput> }>(
    teamId,
    ({ id, input }) => updateGoal(teamId, id, input),
  );
}

export function useDeleteGoal(teamId: number) {
  return useOrganizationMutation<number>(teamId, (id) => deleteGoal(teamId, id));
}

export function useSetAgentAssignment(teamId: number) {
  return useOrganizationMutation<{ id: number; input: AgentAssignmentInput }>(
    teamId,
    ({ id, input }) => setAgentAssignment(teamId, id, input),
  );
}

export function useClearAgentAssignment(teamId: number) {
  return useOrganizationMutation<number>(teamId, (id) => clearAgentAssignment(teamId, id));
}

export function useSetProjectAssignment(teamId: number) {
  return useOrganizationMutation<{ id: number; input: ProjectAssignmentInput }>(
    teamId,
    ({ id, input }) => setProjectAssignment(teamId, id, input),
  );
}

export function useClearProjectAssignment(teamId: number) {
  return useOrganizationMutation<number>(teamId, (id) => clearProjectAssignment(teamId, id));
}

export function useSetAgentProjectInstructions(teamId: number) {
  return useOrganizationMutation<{ agentId: number; projectId: number; instructions: string }>(
    teamId,
    ({ agentId, projectId, instructions }) =>
      setAgentProjectInstructions(teamId, agentId, projectId, instructions),
  );
}

// A pause shows in the team's agent lists as well as in the organization.
function usePauseMutation(teamId: number, mutationFn: (agentId: number) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.organization(teamId) }),
        queryClient.invalidateQueries({ queryKey: qk.teamAiAgents(teamId) }),
      ]),
  });
}

export function usePauseAgent(teamId: number) {
  return usePauseMutation(teamId, (id) => pauseAgent(teamId, id));
}

export function useResumeAgent(teamId: number) {
  return usePauseMutation(teamId, (id) => resumeAgent(teamId, id));
}

export function useSetAgentTokenCeilings(teamId: number) {
  return useOrganizationMutation<{ id: number; ceilings: AgentTokenCeilings }>(
    teamId,
    ({ id, ceilings }) => setAgentTokenCeilings(teamId, id, ceilings),
  );
}

export function useSetProjectTokenCeiling(teamId: number) {
  return useOrganizationMutation<{ projectId: number; monthly: number | null }>(
    teamId,
    ({ projectId, monthly }) => setProjectTokenCeiling(teamId, projectId, monthly),
  );
}

// A goal's linked tasks and notes, loaded when its card opens them.
export function useGoalDetailQuery(teamId: number, goalId: number, enabled: boolean) {
  return useQuery({
    queryKey: qk.goalDetail(teamId, goalId),
    queryFn: () => getGoalDetail(teamId, goalId),
    enabled,
  });
}

// Accepts or rejects an agent's proposed status of a goal.
export function useDecideGoalNote(teamId: number) {
  return useOrganizationMutation<{ goalId: number; noteId: number; accept: boolean }>(
    teamId,
    ({ goalId, noteId, accept }) => decideGoalNote(teamId, goalId, noteId, accept),
  );
}

// Links the task an identifier ("VOL-12") names to a goal, or unlinks a task (goalId null).
export function useLinkGoalTask(teamId: number) {
  return useOrganizationMutation<{ goalId: number | null; identifier?: string; issueId?: number }>(
    teamId,
    async ({ goalId, identifier, issueId }) => {
      let id = issueId;
      if (id === undefined) {
        const match = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec((identifier ?? '').trim().toUpperCase());
        if (!match) throw new Error('invalid identifier');
        id = (await getIssueBySeq(match[1]!, Number(match[2]))).id;
      }
      return setIssueGoal(id, goalId);
    },
  );
}
