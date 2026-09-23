'use client';

import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import {
  OUTCOMES,
  TASK_FIELDS,
  type ConditionStep,
  type ConditionTest,
  type TaskField,
} from '@/lib/api/endpoints/pipelines';
import { PRIORITY_ORDER } from '@/utils/fieldOptions';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { fieldIssues } from '../../utils/issueDisplay';
import PipelineField from './PipelineField';
import PipelineNamesInput, { type NameOption } from './PipelineNamesInput';

const STATE_TYPES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'] as const;

const testOf = (kind: ConditionTest['kind']): ConditionTest =>
  kind === 'outcome'
    ? { kind, outcomes: ['success'] }
    : kind === 'keyword'
      ? { kind, keyword: '' }
      : { kind, field: 'status', op: 'is', values: [] };

// A condition: what it checks decides the Yes and No lanes. The values of a task field
// are picked from the project's own in a project workflow and typed in a template.
export default function PipelineConditionStepForm({
  step,
  onChange,
}: {
  step: ConditionStep;
  onChange: (step: ConditionStep) => void;
}) {
  const t = useTranslations('pipelines.inspector.condition');
  const stateType = useTranslations('display.stateTypes');
  const priority = usePriorityLabel();
  const { context, issues } = usePipelineEditor();
  const issuesOf = (field: string) => fieldIssues(issues, step.id, field);
  const test = step.condition;
  const set = (condition: ConditionTest) => onChange({ ...step, condition });
  const named = (items?: { name: string }[]) =>
    items?.map((item) => ({ value: item.name, label: item.name }));
  const options: Record<TaskField, NameOption[] | undefined> = {
    status: named(context?.statuses),
    statusType: STATE_TYPES.map((value) => ({ value, label: stateType(value) })),
    labels: named(context?.labels),
    area: named(context?.areas),
    priority: PRIORITY_ORDER.map((value) => ({ value, label: priority(value) })),
  };

  return (
    <>
      <PipelineField label={t('kind')} htmlFor="step-condition" issues={issuesOf('condition.kind')}>
        <Select
          value={test.kind}
          onValueChange={(kind) => set(testOf(kind as ConditionTest['kind']))}
        >
          <SelectTrigger id="step-condition" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['outcome', 'keyword', 'task'] as const).map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PipelineField>
      {test.kind === 'outcome' && (
        <PipelineField label={t('kinds.outcome')} issues={issuesOf('condition.outcomes')}>
          <div className="flex flex-wrap gap-4">
            {OUTCOMES.map((outcome) => (
              <label key={outcome} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={test.outcomes.includes(outcome)}
                  onCheckedChange={(checked) =>
                    set({
                      ...test,
                      outcomes: checked
                        ? [...test.outcomes, outcome]
                        : test.outcomes.filter((item) => item !== outcome),
                    })
                  }
                />
                {t(`outcomes.${outcome}`)}
              </label>
            ))}
          </div>
        </PipelineField>
      )}
      {test.kind === 'keyword' && (
        <PipelineField
          label={t('keyword')}
          htmlFor="step-keyword"
          hint={t('keywordHint')}
          issues={issuesOf('condition.keyword')}
        >
          <Input
            id="step-keyword"
            value={test.keyword}
            maxLength={200}
            dir="auto"
            onChange={(event) => set({ ...test, keyword: event.target.value })}
          />
        </PipelineField>
      )}
      {test.kind === 'task' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <PipelineField label={t('field')} issues={issuesOf('condition.field')}>
              <Select
                value={test.field}
                onValueChange={(field) => set({ ...test, field: field as TaskField, values: [] })}
              >
                <SelectTrigger className="w-full" aria-label={t('field')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_FIELDS.map((field) => (
                    <SelectItem key={field} value={field}>
                      {t(`fields.${field}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PipelineField>
            <PipelineField label={t('op')} issues={issuesOf('condition.op')}>
              <Select
                value={test.op}
                onValueChange={(op) => set({ ...test, op: op as 'is' | 'is_not' })}
              >
                <SelectTrigger className="w-full" aria-label={t('op')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="is">{t('ops.is')}</SelectItem>
                  <SelectItem value="is_not">{t('ops.is_not')}</SelectItem>
                </SelectContent>
              </Select>
            </PipelineField>
          </div>
          <PipelineField
            label={t('values')}
            htmlFor="step-values"
            issues={issuesOf('condition.values')}
          >
            <PipelineNamesInput
              key={test.field}
              id="step-values"
              value={test.values}
              options={options[test.field]}
              onChange={(values) => set({ ...test, values })}
            />
          </PipelineField>
        </>
      )}
    </>
  );
}
