'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import type { PipelineTrigger } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import PipelineField from './PipelineField';
import PipelineNameInput from './PipelineNameInput';

// The fields the trigger type needs. Statuses and labels are named, so a template
// reads them as text and a project workflow offers the project's own.
export default function PipelineTriggerFields({
  trigger,
  onChange,
}: {
  trigger: PipelineTrigger;
  onChange: (trigger: PipelineTrigger) => void;
}) {
  const t = useTranslations('pipelines.trigger');
  const { context } = usePipelineEditor();

  if (trigger.type === 'status_changed')
    return (
      <PipelineField label={t('status')} htmlFor="pipeline-trigger-status" hint={t('statusHint')}>
        <PipelineNameInput
          id="pipeline-trigger-status"
          value={trigger.to ?? ''}
          options={context?.statuses.map((status) => status.name)}
          emptyLabel={t('anyStatus')}
          onChange={(to) => onChange({ ...trigger, to: to || null })}
        />
      </PipelineField>
    );
  if (trigger.type === 'label_added')
    return (
      <PipelineField label={t('label')} htmlFor="pipeline-trigger-label">
        <PipelineNameInput
          id="pipeline-trigger-label"
          value={trigger.label}
          options={context?.labels.map((label) => label.name)}
          onChange={(label) => onChange({ ...trigger, label })}
        />
      </PipelineField>
    );
  if (trigger.type !== 'schedule') return null;
  return (
    <>
      <PipelineField label={t('cron')} htmlFor="pipeline-cron" hint={t('cronHint')}>
        <Input
          id="pipeline-cron"
          value={trigger.cron}
          dir="ltr"
          className="font-mono"
          onChange={(event) => onChange({ ...trigger, cron: event.target.value })}
        />
      </PipelineField>
      <PipelineField label={t('timezone')} htmlFor="pipeline-timezone">
        <Input
          id="pipeline-timezone"
          value={trigger.timezone}
          dir="ltr"
          onChange={(event) => onChange({ ...trigger, timezone: event.target.value })}
        />
      </PipelineField>
      <PipelineField
        label={t('taskTitle')}
        htmlFor="pipeline-task-title"
        hint={t('taskTitleHint')}
        className="sm:col-span-2"
      >
        <Input
          id="pipeline-task-title"
          value={trigger.title}
          maxLength={300}
          dir="auto"
          onChange={(event) => onChange({ ...trigger, title: event.target.value })}
        />
      </PipelineField>
    </>
  );
}
