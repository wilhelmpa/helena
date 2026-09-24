'use client';

import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NOTIFY_RECIPIENTS, type NotifyStep } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { fieldIssues } from '../../utils/issueDisplay';
import PipelineField from './PipelineField';
import PipelineNamesInput from './PipelineNamesInput';
import PipelineTemplateText from './PipelineTemplateText';

// Tells people about the run: a comment on the task that notifies the assignee, the
// task's watchers or members the step names. Members are named only in a project
// workflow; a template reaches people through the task.
export default function PipelineNotifyStepForm({
  step,
  onChange,
}: {
  step: NotifyStep;
  onChange: (step: NotifyStep) => void;
}) {
  const t = useTranslations('pipelines.inspector.notify');
  const { context, template, issues } = usePipelineEditor();
  const issuesOf = (field: string) => fieldIssues(issues, step.id, field);
  const members = context?.members ?? [];
  const kinds = NOTIFY_RECIPIENTS.filter(
    (kind) => kind !== 'members' || !template || step.to.kind === 'members',
  );

  return (
    <>
      <PipelineField label={t('to')} htmlFor="step-notify-to" issues={issuesOf('to.kind')}>
        <Select
          value={step.to.kind}
          onValueChange={(kind) =>
            onChange({
              ...step,
              to:
                kind === 'members'
                  ? { kind: 'members', userIds: [] }
                  : { kind: kind as 'assignee' | 'watchers' },
            })
          }
        >
          <SelectTrigger id="step-notify-to" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`recipients.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PipelineField>
      {step.to.kind === 'members' && (
        <PipelineField
          label={t('members')}
          htmlFor="step-notify-members"
          issues={issuesOf('to.userIds')}
        >
          <PipelineNamesInput
            id="step-notify-members"
            value={step.to.userIds}
            options={members.map((member) => ({ value: member.id, label: member.name }))}
            onChange={(userIds) => onChange({ ...step, to: { kind: 'members', userIds } })}
          />
        </PipelineField>
      )}
      <PipelineTemplateText
        id="step-message"
        label={t('message')}
        stepId={step.id}
        value={step.message}
        maxLength={2000}
        placeholder={t('messagePlaceholder')}
        issues={issuesOf('message')}
        onChange={(message) => onChange({ ...step, message })}
      />
    </>
  );
}
