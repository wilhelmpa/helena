// The grouping of projects in the sidebar, which is the organization's project
// department. A change reloads the project list and the organization.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createDepartment,
  deleteDepartment,
  setProjectAssignment,
  updateDepartment,
} from '@/lib/api/endpoints/organization';
import { qk } from '@/services/queryKeys';

function useGroupMutation<T extends { teamId: number }>(run: (input: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (_data, { teamId }) => {
      void qc.invalidateQueries({ queryKey: qk.projects });
      void qc.invalidateQueries({ queryKey: qk.organization(teamId) });
    },
  });
}

export function useMoveProjectToGroup() {
  return useGroupMutation(
    ({
      teamId,
      projectId,
      groupId,
    }: {
      teamId: number;
      projectId: number;
      groupId: number | null;
    }) => setProjectAssignment(teamId, projectId, { departmentId: groupId }),
  );
}

// Creates the department and puts the project in it.
export function useCreateProjectGroup() {
  return useGroupMutation(
    async ({ teamId, projectId, name }: { teamId: number; projectId: number; name: string }) => {
      const group = await createDepartment(teamId, { name });
      await setProjectAssignment(teamId, projectId, { departmentId: group.id });
    },
  );
}

export function useRenameProjectGroup() {
  return useGroupMutation(
    ({ teamId, groupId, name }: { teamId: number; groupId: number; name: string }) =>
      updateDepartment(teamId, groupId, { name }),
  );
}

export function useDeleteProjectGroup() {
  return useGroupMutation(({ teamId, groupId }: { teamId: number; groupId: number }) =>
    deleteDepartment(teamId, groupId),
  );
}
