'use client';

import { useTranslations } from 'next-intl';
import type { DefinitionIssue, PipelineTrigger } from '@/lib/api/endpoints/pipelines';
import { byKey } from '@/utils/messageKey';

// The words the workflow screens share: what starts a workflow, a duration, and a
// problem the API names, translated by its code with the API's own text as fallback.
export function usePipelineLabels() {
  const t = useTranslations('pipelines');
  const issues = useTranslations('pipelines.issues');

  const trigger = (value: PipelineTrigger): string => {
    if (value.type === 'status_changed' && value.to)
      return t('triggerSummary.statusTo', { status: value.to });
    if (value.type === 'label_added' && value.label)
      return t('triggerSummary.label', { label: value.label });
    if (value.type === 'schedule' && value.cron)
      return t('triggerSummary.schedule', { cron: value.cron });
    return t(`triggers.${value.type}`);
  };

  const duration = (minutes: number): string => {
    if (minutes % 1440 === 0) return t('duration.days', { count: minutes / 1440 });
    if (minutes % 60 === 0) return t('duration.hours', { count: minutes / 60 });
    return t('duration.minutes', { count: minutes });
  };

  const issue = (value: DefinitionIssue): string =>
    issues.has(value.code as Parameters<typeof issues.has>[0])
      ? byKey(issues)(value.code, value.params ?? {})
      : value.message;

  return { trigger, duration, issue };
}
