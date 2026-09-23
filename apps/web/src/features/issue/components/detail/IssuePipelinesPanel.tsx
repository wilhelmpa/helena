import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PipelineRunTimeline from '@/components/common/pipeline-runs/PipelineRunTimeline';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePermissions } from '@/hooks/usePermissions';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { useIssuePipelineRuns, useIssuePipelines } from '@/services/pipelines.service';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';
import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import IssuePipelineStartMenu from './IssuePipelineStartMenu';
import IssueSectionHeading from './IssueSectionHeading';

const SHOWN_RUNS = 3;

// The workflows of the workflow builder on this issue: start one the project runs, and
// follow their runs step by step. Left out in a project whose workflows never ran here
// and that has none to start.
export default function IssuePipelinesPanel({
  project,
  issueId,
  canEdit,
}: {
  project: ProjectDetail;
  issueId: number;
  canEdit: boolean;
}) {
  const t = useTranslations('pipelines.issuePanel');
  const { can } = usePermissions();
  const { open, toggle } = usePersistedOpen('issue-pipelines-open');
  const [all, setAll] = useState(false);
  const pipelines = useIssuePipelines(issueId, true);
  const runs = useIssuePipelineRuns(issueId, true);
  const targets = [qk.issuePipelineRuns(issueId), qk.issuePipelines(issueId)];
  useLiveRefresh({ scope: revScope.controlPlane(project.project.id), targets });
  useLiveRefresh({ scope: revScope.agentRuns(project.project.id), targets });

  const startable = pipelines.data ?? [];
  const rows = runs.data ?? [];
  if (startable.length === 0 && rows.length === 0 && !runs.isError) return null;
  const shown = all ? rows : rows.slice(0, SHOWN_RUNS);

  return (
    <div className={`mt-6 border-t pt-5 ${open ? '' : '-mb-2'}`}>
      <div className={`flex h-7 items-center justify-between gap-3 ${open ? 'mb-3' : ''}`}>
        <IssueSectionHeading
          label={t('title')}
          tally={rows.length ? String(rows.length) : undefined}
          open={open}
          onToggle={toggle}
        />
        {canEdit && startable.length > 0 && (
          <IssuePipelineStartMenu issueId={issueId} pipelines={startable} />
        )}
      </div>
      {open && (
        <div className="space-y-2">
          {runs.isError ? (
            <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            shown.map((run) => (
              <PipelineRunTimeline key={run.id} run={run} canEdit={can('actions', 'edit')} />
            ))
          )}
          {rows.length > SHOWN_RUNS && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setAll(!all)}
            >
              {all ? t('showLess') : t('showMore', { count: rows.length - SHOWN_RUNS })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
