import { useTranslations } from 'next-intl';
import type { ActionDef } from '@/lib/api/endpoints/actions';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { useActionRuns } from '@/services/actions.service';
import { qk } from '@/services/queryKeys';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { revScope } from '@/utils/revScopes';
import { formatDateTime } from '@/utils/dates';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';

import { Box, Stack, Text, Table, Td, Th, Tr } from '@/design-system';

export function SettingsActionRuns({ project }: { project: ProjectDetail }) {
  const t = useTranslations('settings.actions');
  const projectKey = project.project.key;
  const query = useActionRuns(projectKey);
  const runs = query.data ?? [];
  useLiveRefresh({
    scope: revScope.actionRuns(project.project.id),
    targets: [qk.actionRuns(projectKey)],
  });

  return (
    <Stack as="section" gap={3} padTop={4} className="border-t">
      <div>
        <h2 className="text-sm font-medium">{t('runHistory')}</h2>
        <Text as="p" size="xs" tone="muted">
          {t('runHistoryHint')}
        </Text>
      </div>
      {query.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-10" />
      ) : runs.length === 0 ? (
        <Box as="p" pad={4} className="rounded-md border">
          <Text as="span" size="sm" tone="muted">
            {t('noRuns')}
          </Text>
        </Box>
      ) : (
        <Table stack={false} className="min-w-[760px] table-fixed">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[17%]" />
            <col className="w-[25%]" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead>
            <Tr className="hover:bg-transparent">
              <Th>{t('columns.action')}</Th>
              <Th>{t('workItem')}</Th>
              <Th>{t('stateTransition')}</Th>
              <Th>{t('runStatusLabel')}</Th>
              <Th alignment="end">{t('runAt')}</Th>
            </Tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <Tr key={run.id}>
                <Td>
                  <div className="truncate text-sm font-medium">{run.actionName}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(triggerLabel(run.trigger))}
                  </div>
                </Td>
                <Td>{run.issueIdentifier ?? '—'}</Td>
                <Td>
                  {run.fromColumnName ?? `#${run.fromColumnId}`} →{' '}
                  {run.toColumnName ?? `#${run.toColumnId}`}
                </Td>
                <Td>
                  <Badge
                    variant={
                      run.status === 'failed'
                        ? 'destructive'
                        : run.status === 'succeeded'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {t(`runStatus.${run.status}`)}
                  </Badge>
                  {run.lastError && (
                    <Box as="p" marginTop={1} className="line-clamp-2">
                      <Text
                        as="span"
                        size="xs"
                        tone="muted"

                        title={run.lastError}
                      >
                        {run.lastError}
                      </Text>
                    </Box>
                  )}
                </Td>
                <Td alignment="end" className="tabular-nums">
                  {formatDateTime(run.createdAt)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Stack>
  );
}

function triggerLabel(trigger: ActionDef['trigger']) {
  if (trigger === 'manual') return 'triggerManual' as const;
  if (trigger === 'issue_comment_added') return 'triggerCommentAdded' as const;
  return 'triggerStateChanged' as const;
}
