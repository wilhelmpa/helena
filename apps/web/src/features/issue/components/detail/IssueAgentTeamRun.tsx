import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { useRelativeTime } from '@/context/relativeTimeContext';
import type { AgentTeamRun } from '@/lib/api/endpoints/issues';
import IssueAgentTeamSteps from './IssueAgentTeamSteps';

const KNOWN_STATUS = [
  'pending',
  'running',
  'waiting',
  'suspended',
  'success',
  'failed',
  'canceled',
] as const;

function isKnownStatus(status: string): status is (typeof KNOWN_STATUS)[number] {
  return (KNOWN_STATUS as readonly string[]).includes(status);
}

// One agent-team run: its state, the stages, and once it finished the summary written
// to the task with what each stage reported.
export default function IssueAgentTeamRun({ run }: { run: AgentTeamRun }) {
  const t = useTranslations('issue.agentTeam');
  const relativeTime = useRelativeTime();
  const [open, setOpen] = useState(false);
  const history = run.result?.history ?? [];

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={run.status === 'failed' ? 'destructive' : 'outline'}>
          {isKnownStatus(run.status) ? t(`status.${run.status}`) : run.status}
        </Badge>
        {run.result && run.result.status !== 'dry-run-complete' && (
          <span className="text-muted-foreground">{t(`outcome.${run.result.status}`)}</span>
        )}
        {run.createdAt && (
          <span className="ms-auto text-muted-foreground">{relativeTime(run.createdAt)}</span>
        )}
      </div>
      <IssueAgentTeamSteps run={run} />
      {run.error && <p className="text-xs text-destructive">{run.error}</p>}
      {run.result && (
        <p className="text-sm whitespace-pre-wrap" dir="auto">
          {run.result.summary}
        </p>
      )}
      {history.length > 0 && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(!open)}
        >
          {open ? t('hideStages') : t('showStages', { count: history.length })}
        </button>
      )}
      {open && (
        <ol className="space-y-2 border-s ps-3">
          {history.map((entry) => (
            <li key={`${entry.executionId}-${entry.attempt}`} className="text-xs">
              <p className="font-medium">
                {t(`phases.${entry.phase}`)}
                <span className="font-normal text-muted-foreground">
                  {' · '}
                  {t(`stageStatus.${entry.status}`)} · {relativeTime(entry.completedAt)}
                </span>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground" dir="auto">
                {entry.summary}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
