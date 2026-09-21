import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ActionDef,
  listQuickActions,
  createAction,
  updateAction,
  deleteAction,
  reorderActions,
  listActionRuns,
  previewAction,
  runAction,
} from '@/lib/api/endpoints/actions';
import { EMPTY_FILTER_SET, type FilterSet } from '@/utils/filters';
import { useOptimisticReorder } from '@/services/optimisticReorder';
import { qk } from '@/services/queryKeys';

// Coerces an action's jsonb blobs (opaque on the server) into the client shapes:
// a FilterSet condition (empty when missing/partial) and an effect object.
// Applied by the actions query and after a create/update.
export function normalizeAction(a: ActionDef): ActionDef {
  const conditions = (a.condition as FilterSet | undefined)?.conditions;
  const condition = Array.isArray(conditions) ? { conditions } : EMPTY_FILTER_SET;
  const effect = a.effect && typeof a.effect === 'object' ? a.effect : {};
  return {
    ...a,
    condition,
    effect,
    workflow: a.workflow ?? legacyWorkflow(a.trigger, condition, effect),
  };
}

export function legacyWorkflow(
  trigger: ActionDef['trigger'],
  condition: FilterSet,
  effect: ActionDef['effect'],
): ActionDef['workflow'] {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', config: { trigger }, position: { x: 0, y: 0 } },
      { id: 'condition', type: 'condition', config: condition, position: { x: 0, y: 160 } },
      { id: 'action', type: 'action', config: effect, position: { x: 0, y: 320 } },
    ],
    edges: [
      { id: 'trigger-condition', source: 'trigger', target: 'condition', branch: 'always' },
      { id: 'condition-action', source: 'condition', target: 'action', branch: 'true' },
    ],
  };
}

// Reads the member-accessible list, so the issue quick actions work for a member
// without the `actions` read permission. Managing actions still requires it.
export function useActionsQuery(projectKey: string | null) {
  return useQuery({
    queryKey: qk.actions(projectKey ?? ''),
    queryFn: () => listQuickActions(projectKey!),
    enabled: projectKey != null,
    select: (rows) => rows.map(normalizeAction),
  });
}

export function useCreateAction(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input }: { input: Parameters<typeof createAction>[1] }) =>
      createAction(projectKey!, input),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.actions(projectKey) });
    },
  });
}

export function useUpdateAction(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: Parameters<typeof updateAction>[1] }) =>
      updateAction(id, input),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.actions(projectKey) });
    },
  });
}

export function useDeleteAction(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteAction(id),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.actions(projectKey) });
    },
  });
}

export function useReorderActions(projectKey: string | null) {
  return useOptimisticReorder<ActionDef>(projectKey ? qk.actions(projectKey) : null, (orderedIds) =>
    reorderActions(projectKey!, orderedIds),
  );
}

export function useActionRuns(projectKey: string) {
  return useQuery({
    queryKey: qk.actionRuns(projectKey),
    queryFn: () => listActionRuns(projectKey),
  });
}

export function useRunAction(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, issueId }: { actionId: number; issueId: number }) =>
      runAction(actionId, issueId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.actionRuns(projectKey) });
      void qc.invalidateQueries({ queryKey: qk.boardIssues(projectKey) });
    },
  });
}

export function usePreviewAction() {
  return useMutation({
    mutationFn: ({
      actionId,
      issueId,
      workflow,
    }: {
      actionId: number;
      issueId: number;
      workflow: ActionDef['workflow'];
    }) => previewAction(actionId, issueId, workflow),
    meta: { suppressErrorToast: true },
  });
}
