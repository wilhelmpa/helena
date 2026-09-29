import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { Routine, RoutineInput } from '@/lib/api/endpoints/routines';
import { Button } from '@/components/ui/button';
import ListPager from '@/components/common/ListPager';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePaging } from '@/hooks/usePaging';
import { usePermissions } from '@/hooks/usePermissions';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { qk } from '@/services/queryKeys';
import { aiAgentsPath } from '@/utils/paths';
import { revScope } from '@/utils/revScopes';
import {
  useCreateRoutine,
  useDeleteRoutine,
  useRoutines,
  useRunRoutine,
  useUpdateRoutine,
} from '../services/routines.service';
import { RoutineDialog } from './RoutineDialog';
import { RoutinesTable } from './RoutinesTable';
import { uuid } from '@/utils/uuid';
import { Stack, Text } from '@/design-system';

// The routines of the project, with the dialogs that create, change and delete them.
export function RoutinesList({
  project,
  requestNew,
  onNewHandled,
}: {
  project: ProjectDetail;
  requestNew: boolean;
  onNewHandled: () => void;
}) {
  const t = useTranslations('routines');
  const projectKey = project.project.key;
  const { can } = usePermissions();
  const paging = usePaging();
  const routinesQuery = useRoutines(projectKey, paging.params);
  const agentsQuery = useAiAgentsQuery(project.project.teamId);
  const agents = (agentsQuery.data ?? []).filter((agent) =>
    agent.projects.some((item) => item.id === project.project.id),
  );
  const routines = routinesQuery.data?.items ?? [];
  const createRoutine = useCreateRoutine(projectKey);
  const updateRoutine = useUpdateRoutine(projectKey);
  const deleteRoutine = useDeleteRoutine(projectKey);
  const runRoutine = useRunRoutine(projectKey);
  const [editing, setEditing] = useState<Routine | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Routine | null>(null);
  // A new routine is created once, however often a failed save is retried.
  const [idempotencyKey, setIdempotencyKey] = useState(() => uuid());
  useLiveRefresh({
    scope: revScope.controlPlane(project.project.id),
    targets: [qk.routines(projectKey)],
  });

  // The "New schedule" button lives in the page header; opening is signalled here.
  useEffect(() => {
    if (!requestNew) return;
    setIdempotencyKey(uuid());
    setEditing('new');
    onNewHandled();
  }, [requestNew, onNewHandled]);

  if (agentsQuery.isError || routinesQuery.isError) {
    return (
      <EmptyState title={t('loadFailed')} description={t('loadFailedHint')}>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void Promise.all([agentsQuery.refetch(), routinesQuery.refetch()])}
        >
          {t('tryAgain')}
        </Button>
      </EmptyState>
    );
  }
  if (agentsQuery.isLoading || routinesQuery.isLoading) {
    return <ListSkeleton rows={3} rowClassName="h-12" />;
  }
  if (agents.length === 0 && routines.length === 0) {
    return (
      <EmptyState title={t('noAgents')} description={t('noAgentsHint')}>
        {can('ai_agents', 'create') && (
          <Button size="sm" asChild>
            <Link href={aiAgentsPath(projectKey)}>{t('createAgent')}</Link>
          </Button>
        )}
      </EmptyState>
    );
  }

  async function save(input: RoutineInput) {
    if (editing === 'new') await createRoutine.mutateAsync({ idempotencyKey, input });
    else if (editing) await updateRoutine.mutateAsync({ routineId: editing.id, patch: input });
    setEditing(null);
  }

  return (
    <>
      {routines.length === 0 ? (
        <EmptyState title={t('emptyHint')} description="">
          {can('ai_agents', 'create') && (
            <Button
              size="sm"
              onClick={() => {
                setIdempotencyKey(uuid());
                setEditing('new');
              }}
            >
              {t('newTitle')}
            </Button>
          )}
        </EmptyState>
      ) : (
        <Stack gap={4}>
          <RoutinesTable
            routines={routines}
            actionsFor={(routine) => ({
              canEdit: can('ai_agents', 'edit'),
              canDelete: can('ai_agents', 'delete'),
              running: runRoutine.isPending && runRoutine.variables === routine.id,
              onToggle: () =>
                updateRoutine.mutate({
                  routineId: routine.id,
                  patch: { enabled: !routine.enabled },
                }),
              onRun: () => runRoutine.mutate(routine.id),
              onEdit: () => setEditing(routine),
              onDelete: () => setDeleting(routine),
            })}
          />
          <ListPager paging={paging} total={routinesQuery.data?.total ?? 0} />
        </Stack>
      )}

      {editing && (
        <RoutineDialog
          key={editing === 'new' ? idempotencyKey : editing.id}
          projectKey={projectKey}
          agents={agents}
          initial={editing === 'new' ? undefined : editing}
          saving={createRoutine.isPending || updateRoutine.isPending}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('delete')}
          confirmLabel={t('delete')}
          onConfirm={async () => {
            await deleteRoutine.mutateAsync(deleting.id);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        >
          <Text as="p" size="sm" tone="muted">
            {t.rich('deleteMessage', {
              name: deleting.title,
              v: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
          </Text>
        </ConfirmDialog>
      )}
    </>
  );
}
