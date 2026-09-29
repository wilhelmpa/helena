'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DecisionStep } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { flattenSteps } from '../../utils/editorState';
import { fieldIssues } from '../../utils/issueDisplay';
import PipelineField from './PipelineField';
import PipelineTemplateText from './PipelineTemplateText';
import { Stack, Text } from '@/design-system';

const NEW = 'new';
const MAX_OPTIONS = 12;

// "Entscheidung" (docs/helena-decisions/decisions.md §6): the question and its options (one
// per line), which options lead into the first lane, and where the run goes when the decision
// model is not sure enough. A later step can reuse this answer instead of asking again, so
// several lanes follow one question.
export default function PipelineDecisionStepForm({
  step,
  onChange,
}: {
  step: DecisionStep;
  onChange: (step: DecisionStep) => void;
}) {
  const t = useTranslations('pipelines.inspector.decision');
  const { definition, issues } = usePipelineEditor();
  const issuesOf = (field: string) => fieldIssues(issues, step.id, field);
  const entry = flattenSteps(definition.steps).find((item) => item.step.id === step.id);
  const earlier = (entry?.path ?? []).filter(
    (candidate): candidate is DecisionStep => candidate.type === 'decision' && !candidate.from,
  );
  const source = step.from ? earlier.find((candidate) => candidate.id === step.from) : undefined;
  const [optionsText, setOptionsText] = useState(step.options.join('\n'));
  const options = source ? source.options : step.options;

  const setOptions = (text: string) => {
    setOptionsText(text);
    const next = [
      ...new Set(
        text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    ].slice(0, MAX_OPTIONS);
    onChange({
      ...step,
      options: next,
      thenOptions: step.thenOptions.filter((option) => next.includes(option)),
    });
  };

  return (
    <>
      {earlier.length > 0 && (
        <PipelineField label={t('source')} htmlFor="step-decision-from" issues={issuesOf('from')}>
          <Select
            value={step.from ?? NEW}
            onValueChange={(value) => {
              const from = value === NEW ? null : value;
              const picked = earlier.find((candidate) => candidate.id === from);
              onChange({
                ...step,
                from,
                question: from ? '' : step.question,
                context: from ? '' : step.context,
                options: picked ? picked.options : step.options,
                thenOptions: [],
              });
            }}
          >
            <SelectTrigger id="step-decision-from" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW}>{t('ask')}</SelectItem>
              {earlier.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {t('reuse', { step: candidate.name })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PipelineField>
      )}
      {!source && (
        <>
          <PipelineTemplateText
            id="step-decision-question"
            label={t('question')}
            stepId={step.id}
            value={step.question}
            maxLength={2000}
            rows={2}
            placeholder={t('questionHint')}
            issues={issuesOf('question')}
            onChange={(question) => onChange({ ...step, question })}
          />
          <PipelineTemplateText
            id="step-decision-context"
            label={t('context')}
            stepId={step.id}
            value={step.context}
            maxLength={8000}
            rows={3}
            placeholder={t('contextHint')}
            issues={issuesOf('context')}
            onChange={(context) => onChange({ ...step, context })}
          />
          <PipelineField
            label={t('options')}
            htmlFor="step-decision-options"
            hint={t('optionsHint', { max: MAX_OPTIONS })}
            issues={issuesOf('options')}
          >
            <Textarea
              id="step-decision-options"
              value={optionsText}
              rows={4}
              dir="auto"
              onChange={(event) => setOptions(event.target.value)}
            />
          </PipelineField>
        </>
      )}
      <PipelineField label={t('thenOptions')} hint={t('thenHint')} issues={issuesOf('thenOptions')}>
        <Stack gap={2}>
          {options.length === 0 && (
            <Text as="p" size="xs" tone="muted">
              {t('noOptions')}
            </Text>
          )}
          {options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={step.thenOptions.includes(option)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...step,
                    options: source ? source.options : step.options,
                    thenOptions: checked
                      ? [...step.thenOptions, option]
                      : step.thenOptions.filter((item) => item !== option),
                  })
                }
              />
              <span dir="auto">{option}</span>
            </label>
          ))}
        </Stack>
      </PipelineField>
      <PipelineField label={t('unsure')} htmlFor="step-decision-unsure" hint={t('unsureHint')}>
        <Select
          value={step.unsure}
          onValueChange={(unsure) =>
            onChange({ ...step, unsure: unsure as DecisionStep['unsure'] })
          }
        >
          <SelectTrigger id="step-decision-unsure" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['else', 'then', 'fail'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {t(`unsureModes.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PipelineField>
    </>
  );
}
