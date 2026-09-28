'use client';

import { useTranslations } from 'next-intl';
import ListPager from '@/components/common/ListPager';
import Modal from '@/components/common/overlay/Modal';
import PipelineRunTimeline from '@/components/common/pipeline-runs/PipelineRunTimeline';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { usePaging } from '@/hooks/usePaging';
import type { Routine } from '@/lib/api/endpoints/routines';
import { useRoutineRuns } from '../services/routines.service';
import { Stack, Text } from '@/design-system';

// The runs of a routine, newest first: when each was due, what it did and, for one that
// failed, why. A member who may edit routines cancels a run or retries a failed one.
export function RoutineRunsDialog({
  routine,
  canEdit,
  onClose,
}: {
  routine: Routine;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('routines');
  const paging = usePaging(10);
  const runs = useRoutineRuns(routine.projectKey, routine.id, paging.params);

  return (
    <Modal
      title={t('historyTitle', { name: routine.title })}
      scope={routine.projectKey}
      onClose={onClose}
      wide
    >
      {runs.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-20" />
      ) : runs.isError ? (
        <Text as="p" size="sm" tone="danger">
          {t('historyFailed')}
        </Text>
      ) : runs.data.items.length === 0 ? (
        <Text as="p" size="sm" tone="muted">
          {t('noRunsShort')}
        </Text>
      ) : (
        <Stack gap={3}>
          {runs.data.items.map((run) => (
            <PipelineRunTimeline key={run.id} run={run} canEdit={canEdit} showIssue />
          ))}
          <ListPager paging={paging} total={runs.data.total} />
        </Stack>
      )}
    </Modal>
  );
}
