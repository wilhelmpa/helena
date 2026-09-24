'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import type { WebhookStep } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { fieldIssues } from '../../utils/issueDisplay';
import PipelineField from './PipelineField';
import PipelineTemplateText from './PipelineTemplateText';

// Sends the task and the results so far to a URL. The request is signed per Standard
// Webhooks with the project's signing secret (Workflows page of the project), and the
// answer's status decides the step's outcome.
export default function PipelineWebhookStepForm({
  step,
  onChange,
}: {
  step: WebhookStep;
  onChange: (step: WebhookStep) => void;
}) {
  const t = useTranslations('pipelines.inspector.webhook');
  const { issues } = usePipelineEditor();
  const issuesOf = (field: string) => fieldIssues(issues, step.id, field);

  return (
    <>
      <PipelineField
        label={t('url')}
        htmlFor="step-webhook-url"
        hint={t('urlHint')}
        issues={issuesOf('url')}
      >
        <Input
          id="step-webhook-url"
          type="url"
          inputMode="url"
          dir="ltr"
          maxLength={2000}
          placeholder="https://"
          value={step.url}
          onChange={(event) => onChange({ ...step, url: event.target.value })}
        />
      </PipelineField>
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
