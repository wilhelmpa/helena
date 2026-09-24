import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { AgentTokenCounts } from '@/components/common/agent-chat/AgentTokenCounts';
import PipelineRunControls from '@/components/common/pipeline-runs/PipelineRunControls';
import type { AgentTeamRun } from '@/lib/api/endpoints/issues';
import { agentTeamTokens, isKnownStatus } from '../../utils/agentTeam';
import IssueAgentTeamStages from './IssueAgentTeamStages';
import IssueAgentTeamSteps from './IssueAgentTeamSteps';
import ModelFailureNote from '@/features/model-availability/components/ModelFailureNote';
import { knownFailure } from '@/features/model-availability/utils/modelFailure';

// One agent-team run: its state, the stages with the Hermes run behind each, and once it
// finished the summary written to the task with what each stage reported. A member who
// may edit the task cancels a run or retries a failed one from the stage that failed.
export default function IssueAgentTeamRun({
  run,
  canEdit,
}: {
  run: AgentTeamRun;
  canEdit: boolean;
}) {
  const t = useTranslations('issue.agentTeam');
  const relativeTime = useRelativeTime();
  const [open, setOpen] = useState(false);
  const history = run.result?.history ?? [];
  const tokens = agentTeamTokens(run);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={run.status === 'failed' ? 'destructive' : 'outline'}>
          {isKnownStatus(run.status) ? t(`status.${run.status}`) : run.status}
        </Badge>
        {run.result && run.result.status !== 'dry-run-complete' && (
          <span className="text-muted-foreground">{t(`outcome.${run.result.status}`)}</span>
        )}
        <span className="ms-auto flex items-center gap-3">
          {tokens && <AgentTokenCounts input={tokens.input} output={tokens.output} />}
          {run.createdAt && (
            <span className="text-muted-foreground">{relativeTime(run.createdAt)}</span>
          )}
        </span>
      </div>
      <IssueAgentTeamSteps run={run} />
      <IssueAgentTeamStages stages={run.stages} />
      {knownFailure(run.failure) ? (
        <ModelFailureNote
          failure={run.failure}
          error={run.error}
          className="text-xs text-destructive"
        />
      ) : (
        run.error && <p className="text-xs text-destructive">{run.error}</p>
      )}
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
      {canEdit && <PipelineRunControls run={{ id: run.runId, status: run.status }} />}
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
