import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { useProjectWorkflows } from '@/services/controlPlaneWorkflows.service';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';
import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import { useIssueAgentTeamRuns, useStartIssueAgentTeam } from '../../services/agentTeam.service';
import { isAgentTeamRunActive } from '../../utils/agentTeam';
import IssueAgentTeamRun from './IssueAgentTeamRun';
import IssueSectionHeading from './IssueSectionHeading';

const SHOWN_RUNS = 3;

// The project's agent team on this issue: start it, and follow its runs. Shown only in
// a project that runs the agent-team workflow.
export default function IssueAgentTeamPanel({
  project,
  issueId,
  canEdit,
}: {
  project: ProjectDetail;
  issueId: number;
  canEdit: boolean;
}) {
  const t = useTranslations('issue.agentTeam');
  const { open, toggle } = usePersistedOpen('issue-agent-team-open');
  const workflows = useProjectWorkflows(project.project.key);
  const enabled =
    workflows.data?.some((item) => item.id === 'agent-team' && item.assignment.enabled) ?? false;
  const runs = useIssueAgentTeamRuns(issueId, enabled);
  const start = useStartIssueAgentTeam(issueId);
  useLiveRefresh({
    scope: revScope.controlPlane(project.project.id),
    targets: [qk.issueAgentTeamRuns(issueId)],
  });
  useLiveRefresh({
    scope: revScope.agentRuns(project.project.id),
    targets: [qk.issueAgentTeamRuns(issueId)],
  });
  if (!enabled) return null;

  const rows = runs.data ?? [];
  const active = rows.some(isAgentTeamRunActive);

  return (
    <div className={`mt-6 border-t pt-5 ${open ? '' : '-mb-2'}`}>
      <div className={`flex h-7 items-center justify-between gap-3 ${open ? 'mb-3' : ''}`}>
        <IssueSectionHeading
          label={t('title')}
          tally={rows.length ? String(rows.length) : undefined}
          open={open}
          onToggle={toggle}
        />
        {canEdit && !active && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-muted-foreground hover:text-foreground"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            <Play />
            {rows.length ? t('startAgain') : t('start')}
          </Button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          {runs.isError ? (
            <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            rows.slice(0, SHOWN_RUNS).map((run) => <IssueAgentTeamRun key={run.runId} run={run} />)
          )}
        </div>
      )}
    </div>
  );
}
