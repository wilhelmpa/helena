'use client';

import { Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PipelineRunStep } from '@/lib/api/endpoints/pipelines';
import { AgentTokenCounts } from '@/components/common/agent-chat/AgentTokenCounts';
import { Badge } from '@/components/ui/badge';
import { byKey } from '@/utils/messageKey';
import { formatDateTime } from '@/utils/dates';
import { PIPELINE_STEP_ICONS } from '@/utils/pipelineStepIcons';
import PipelineRunStepSummary from './PipelineRunStepSummary';

// One execution of a step: how it ended, who worked on it or decided it, and what it
// left for the steps after it.
export default function PipelineRunStepItem({
  step,
  parts = [],
}: {
  step: PipelineRunStep;
  parts?: PipelineRunStep[];
}) {
  const t = useTranslations('pipelines.runs');
  const label = byKey(t);
  // A step type a plugin added has no icon of its own.
  const Icon = PIPELINE_STEP_ICONS[step.kind] ?? Workflow;
  const known = (group: string, value: string) =>
    t.has(`${group}.${value}` as Parameters<typeof t.has>[0]) ? label(`${group}.${value}`) : value;

  return (
    <li className="flex gap-2 text-xs">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium" dir="auto">
            {step.name}
          </span>
          {step.iteration > 1 && (
            <span className="text-muted-foreground">
              {t('iteration', { iteration: step.iteration })}
            </span>
          )}
          <Badge variant={step.status === 'failed' ? 'destructive' : 'outline'}>
            {known('stepStatus', step.status)}
          </Badge>
          {step.outcome && (
            <span className="text-muted-foreground">{known('outcomes', step.outcome)}</span>
          )}
          {step.attempt > 1 && (
            <span className="text-muted-foreground">{t('attempt', { attempt: step.attempt })}</span>
          )}
        </div>
        {step.agent && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
            <span dir="auto">{step.agent.name}</span>
            <span dir="ltr">@{step.agent.username}</span>
            {step.agentRun && (
              <>
                <span>
                  {t('agentRun', { id: step.agentRun.id })} ·{' '}
                  {known('agentRunStatus', step.agentRun.status)}
                </span>
                <AgentTokenCounts
                  input={step.agentRun.inputTokens}
                  output={step.agentRun.outputTokens}
                />
              </>
            )}
          </div>
        )}
        {step.status === 'waiting' && step.wakeAt && (
          <p className="text-muted-foreground">
            {t('wakeAt', { time: formatDateTime(step.wakeAt) })}
          </p>
        )}
        {step.decidedByName && (
          <p className="text-muted-foreground">{t('decidedBy', { name: step.decidedByName })}</p>
        )}
        {step.note && (
          <p className="whitespace-pre-wrap" dir="auto">
            {t('note', { note: step.note })}
          </p>
        )}
        {step.error && (
          <p className="text-destructive" dir="auto">
            {step.error}
          </p>
        )}
        {step.summary && <PipelineRunStepSummary summary={step.summary} />}
        {parts.length > 0 && (
          <ol className="mt-2 space-y-2 border-s ps-3">
            {parts.map((part) => (
              <PipelineRunStepItem key={`${part.stepId}:${part.iteration}`} step={part} />
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}
