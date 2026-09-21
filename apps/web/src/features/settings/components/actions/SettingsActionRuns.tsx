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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
    <section className="space-y-3 border-t pt-5">
      <div>
        <h2 className="text-sm font-medium">{t('runHistory')}</h2>
        <p className="text-xs text-muted-foreground">{t('runHistoryHint')}</p>
      </div>
      {query.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-10" />
      ) : runs.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t('noRuns')}</p>
      ) : (
        <Table className="min-w-[760px] table-fixed">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[17%]" />
            <col className="w-[25%]" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('columns.action')}</TableHead>
              <TableHead>{t('workItem')}</TableHead>
              <TableHead>{t('stateTransition')}</TableHead>
              <TableHead>{t('runStatusLabel')}</TableHead>
              <TableHead className="text-end">{t('runAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="px-3 py-2">
                  <div className="truncate text-sm font-medium">{run.actionName}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(triggerLabel(run.trigger))}
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2 text-sm">{run.issueIdentifier ?? '—'}</TableCell>
                <TableCell className="px-3 py-2 text-sm">
                  {run.fromColumnName ?? `#${run.fromColumnId}`} →{' '}
                  {run.toColumnName ?? `#${run.toColumnId}`}
                </TableCell>
                <TableCell className="px-3 py-2">
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
                    <p
                      className="mt-1 line-clamp-2 text-xs text-muted-foreground"
                      title={run.lastError}
                    >
                      {run.lastError}
                    </p>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2 text-end text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(run.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function triggerLabel(trigger: ActionDef['trigger']) {
  if (trigger === 'manual') return 'triggerManual' as const;
  if (trigger === 'issue_comment_added') return 'triggerCommentAdded' as const;
  return 'triggerStateChanged' as const;
}
