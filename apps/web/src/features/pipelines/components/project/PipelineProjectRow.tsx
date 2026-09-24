'use client';

import Link from 'next/link';
import { CircleCheck, CircleOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { PipelineContextAgent, ProjectPipeline } from '@/lib/api/endpoints/pipelines';
import { useSetProjectPipeline } from '@/services/pipelines.service';
import { pipelinePath, projectPipelinePath } from '@/utils/paths';
import { usePipelineLabels } from '../../hooks/usePipelineLabels';
import PipelineIssueList from '../PipelineIssueList';
import PipelineRoleMapping from './PipelineRoleMapping';

// One workflow the project can use. Turning it on is refused with the reason when it
// cannot run here; the problems below name what to fix.
export default function PipelineProjectRow({
  entry,
  projectKey,
  agents,
  editable,
}: {
  entry: ProjectPipeline;
  projectKey: string;
  agents: PipelineContextAgent[];
  editable: boolean;
}) {
  const t = useTranslations('pipelines.project');
  const labels = usePipelineLabels();
  const set = useSetProjectPipeline(projectKey);
  const { pipeline } = entry;
  const editor =
    entry.source === 'template'
      ? pipelinePath(pipeline.id)
      : projectPipelinePath(projectKey, pipeline.id);
  const runs = `${editor}?${new URLSearchParams({ tab: 'runs', project: projectKey })}`;
  const StateIcon = entry.enabled ? CircleCheck : CircleOff;

  return (
    <article className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={editor} className="text-md font-medium hover:underline" dir="auto">
              {pipeline.name}
            </Link>
            <Badge variant="secondary">
              {entry.source === 'template' ? t('template') : t('own')}
            </Badge>
            <Badge variant="outline">{labels.trigger(pipeline.definition.trigger)}</Badge>
          </div>
          {pipeline.description && (
            <p className="mt-1 text-sm text-muted-foreground" dir="auto">
              {pipeline.description}
            </p>
          )}
        </div>
        {editable ? (
          <label className="flex items-center gap-2 text-xs">
            {t('enabled')}
            <Switch
              checked={entry.enabled}
              disabled={set.isPending}
              onCheckedChange={(enabled) =>
                set.mutate({ pipelineId: pipeline.id, enabled, roles: entry.roles })
              }
            />
          </label>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StateIcon className="size-4" />
            {entry.enabled ? t('enabled') : t('disabled')}
          </span>
        )}
      </div>
      {entry.resolvedRoles.length > 0 && (
        <PipelineRoleMapping
          entry={entry}
          agents={agents}
          editable={editable}
          onChange={(roles) =>
            set.mutate({ pipelineId: pipeline.id, enabled: entry.enabled, roles })
          }
        />
      )}
      {entry.issues.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">{t('problems')}</p>
          <PipelineIssueList issues={entry.issues} />
        </div>
      )}
      <div className="flex gap-4 text-xs">
        <Link href={editor} className="text-muted-foreground hover:text-foreground">
          {t('open')}
        </Link>
        <Link href={runs} className="text-muted-foreground hover:text-foreground">
          {t('runs')}
        </Link>
      </div>
    </article>
  );
}
