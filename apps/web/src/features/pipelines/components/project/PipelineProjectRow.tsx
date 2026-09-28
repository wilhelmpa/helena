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
import PipelineHookPanel from './PipelineHookPanel';
import PipelineRoleMapping from './PipelineRoleMapping';
import { Inline, Stack, Text } from '@/design-system';

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
    <Stack as="article" gap={3} pad={4} className="rounded-md border bg-card">
      <Inline gap={3} wrap align="start">
        <div className="min-w-0 flex-1">
          <Inline gap={2} wrap>
            <Link href={editor} className="text-md font-medium hover:underline" dir="auto">
              {pipeline.name}
            </Link>
            <Badge variant="secondary">
              {entry.source === 'template' ? t('template') : t('own')}
            </Badge>
            <Badge variant="outline">{labels.trigger(pipeline.definition.trigger)}</Badge>
          </Inline>
          {pipeline.description && (
            <Text as="p" size="sm" tone="muted" className="mt-1" dir="auto">
              {pipeline.description}
            </Text>
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
          <Text as="span" size="xs" tone="muted" className="flex items-center gap-1.5">
            <StateIcon className="size-4" />
            {entry.enabled ? t('enabled') : t('disabled')}
          </Text>
        )}
      </Inline>
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
      {pipeline.definition.trigger.type === 'webhook' && entry.enabled && (
        <PipelineHookPanel projectKey={projectKey} pipelineId={pipeline.id} editable={editable} />
      )}
      {entry.issues.length > 0 && (
        <Stack gap={1}>
          <Text as="p" size="xs" className="font-medium">
            {t('problems')}
          </Text>
          <PipelineIssueList issues={entry.issues} />
        </Stack>
      )}
      <Inline gap={4} align="stretch" className="text-xs">
        <Link href={editor} className="text-muted-foreground hover:text-foreground">
          {t('open')}
        </Link>
        <Link href={runs} className="text-muted-foreground hover:text-foreground">
          {t('runs')}
        </Link>
      </Inline>
    </Stack>
  );
}
