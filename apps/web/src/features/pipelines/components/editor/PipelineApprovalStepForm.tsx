'use client';

import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ApprovalStep } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { flattenSteps } from '../../utils/editorState';
import { fieldIssues } from '../../utils/issueDisplay';
import PipelineField from './PipelineField';
import PipelineNumberInput from './PipelineNumberInput';
import PipelineTemplateText from './PipelineTemplateText';
import { Text } from '@/design-system';

// An approval step: what the approver checks, and on a rejection either the end of the
// run or a way back to a step the run passed on its way here.
export default function PipelineApprovalStepForm({
  step,
  onChange,
}: {
  step: ApprovalStep;
  onChange: (step: ApprovalStep) => void;
}) {
  const t = useTranslations('pipelines.inspector.approval');
  const { definition, issues } = usePipelineEditor();
  const issuesOf = (field: string) => fieldIssues(issues, step.id, field);
  const targets =
    flattenSteps(definition.steps).find((entry) => entry.step.id === step.id)?.path ?? [];
  const reject = step.onReject;

  return (
    <>
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
      <PipelineField
        label={t('onReject')}
        htmlFor="step-reject"
        issues={issuesOf('onReject.action')}
      >
        <Select
          value={reject.action}
          onValueChange={(action) =>
            onChange({
              ...step,
              onReject:
                action === 'end'
                  ? { action: 'end' }
                  : { action: 'goto', stepId: targets.at(-1)?.id ?? '', maxLoops: 3 },
            })
          }
        >
          <SelectTrigger id="step-reject" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="end">{t('end')}</SelectItem>
            <SelectItem value="goto">{t('goto')}</SelectItem>
          </SelectContent>
        </Select>
      </PipelineField>
      {reject.action === 'goto' && (
        <div className="grid grid-cols-2 gap-3">
          <PipelineField
            label={t('target')}
            htmlFor="step-target"
            issues={issuesOf('onReject.stepId')}
          >
            {targets.length === 0 ? (
              <Text as="p" size="xs" tone="muted">
                {t('noEarlierSteps')}
              </Text>
            ) : (
              <Select
                value={reject.stepId || undefined}
                onValueChange={(stepId) => onChange({ ...step, onReject: { ...reject, stepId } })}
              >
                <SelectTrigger id="step-target" className="w-full">
                  <SelectValue placeholder={t('chooseStep')} />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((target) => (
                    <SelectItem key={target.id} value={target.id}>
                      {target.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </PipelineField>
          <PipelineField
            label={t('maxLoops')}
            htmlFor="step-loops"
            issues={issuesOf('onReject.maxLoops')}
          >
            <PipelineNumberInput
              id="step-loops"
              value={reject.maxLoops}
              min={1}
              max={10}
              onChange={(value) =>
                onChange({ ...step, onReject: { ...reject, maxLoops: value ?? Number.NaN } })
              }
            />
          </PipelineField>
        </div>
      )}
    </>
  );
}
