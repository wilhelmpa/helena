import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AgentAssignmentInput,
  type DepartmentInput,
  type GoalInput,
  type ProjectAssignmentInput,
  clearAgentAssignment,
  clearProjectAssignment,
  createDepartment,
  createGoal,
  deleteDepartment,
  deleteGoal,
  getOrganization,
  setAgentAssignment,
  setAgentProjectInstructions,
  setProjectAssignment,
  updateDepartment,
  updateGoal,
} from '@/lib/api/endpoints/organization';
import { qk } from '@/services/queryKeys';

export function useOrganizationQuery(teamId: number | null, projectId?: number) {
  return useQuery({
    queryKey:
      teamId == null ? ['organization', 'none'] : [...qk.organization(teamId), projectId ?? 'all'],
    queryFn: () => getOrganization(teamId!, projectId),
    enabled: teamId != null,
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
