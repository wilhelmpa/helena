'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PipelineRun } from '@/lib/api/endpoints/pipelines';
import { AgentTokenCounts } from '@/components/common/agent-chat/AgentTokenCounts';
import { Badge } from '@/components/ui/badge';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { issueIdentifierPath } from '@/utils/paths';

export default function PipelineRunHeader({
  run,
  showIssue,
}: {
  run: PipelineRun;
  showIssue: boolean;
}) {
  const t = useTranslations('pipelines');
  const relativeTime = useRelativeTime();

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-sm font-medium" dir="auto">
          {run.pipelineName}
        </span>
        <span className="text-muted-foreground">{t('runs.version', { version: run.version })}</span>
        {run.dryRun && <Badge variant="secondary">{t('runs.testRun')}</Badge>}
        <Badge variant={run.status === 'failed' ? 'destructive' : 'outline'}>
          {t(`runs.status.${run.status}`)}
        </Badge>
        <span className="ms-auto flex items-center gap-3">
          <AgentTokenCounts input={run.inputTokens} output={run.outputTokens} />
          <span className="text-muted-foreground">{relativeTime(run.createdAt)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>{t('runs.trigger', { trigger: t(`triggers.${run.trigger}`) })}</span>
        {run.actorName && <span>{t('runs.startedBy', { name: run.actorName })}</span>}
        {showIssue && run.issueIdentifier && (
          <Link
            href={issueIdentifierPath(run.issueIdentifier)}
            className="truncate hover:underline"
          >
            <span dir="ltr">{run.issueIdentifier}</span>
            {run.issueTitle && <span dir="auto"> · {run.issueTitle}</span>}
          </Link>
        )}
      </div>
    </div>
  );
}
