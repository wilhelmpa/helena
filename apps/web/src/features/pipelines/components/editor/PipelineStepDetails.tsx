'use client';

import { useTranslations } from 'next-intl';
import type { PipelineStep } from '@/lib/api/endpoints/pipelines';
import { useStepSummary } from '../../hooks/useStepSummary';

// A step as a reader sees it: its name, what it does and the texts it works with.
export default function PipelineStepDetails({ step }: { step: PipelineStep }) {
  const t = useTranslations('pipelines.inspector');
  const summary = useStepSummary();
  const rows: [string, string][] = [
    [t('name'), step.name],
    [t('title'), summary(step)],
  ];
  if (step.type === 'agent') {
    rows.push([t('agent.instruction'), step.instruction]);
    rows.push([t('agent.timeout'), String(step.timeoutMinutes)]);
    rows.push([t('agent.maxTurns'), step.maxTurns ? String(step.maxTurns) : t('agent.noLimit')]);
    rows.push([
      t('agent.runBudget'),
      step.runBudgetSeconds ? String(Math.round(step.runBudgetSeconds / 60)) : t('agent.noLimit'),
    ]);
    rows.push([t('agent.model'), step.model ?? t('agent.agentModel')]);
  }
  if (step.type === 'approval' && step.message) rows.push([t('approval.message'), step.message]);
  if (step.type === 'action' && step.action.kind === 'comment')
    rows.push([t('action.body'), step.action.body]);
  if (step.type === 'action' && step.action.kind === 'create_subtask')
    rows.push([t('action.description'), step.action.description]);

  return (
    <dl className="space-y-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm whitespace-pre-wrap" dir="auto">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
