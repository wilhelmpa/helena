'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PipelineStep } from '@/lib/api/endpoints/pipelines';
import { PIPELINE_STEP_ICONS } from '@/utils/pipelineStepIcons';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { findStep, removeStep, replaceStep } from '../../utils/editorState';
import { fieldIssues, unplacedStepIssues } from '../../utils/issueDisplay';
import PipelineIssueList from '../PipelineIssueList';
import PipelineActionStepForm from './PipelineActionStepForm';
import PipelineAgentStepForm from './PipelineAgentStepForm';
import PipelineApprovalStepForm from './PipelineApprovalStepForm';
import PipelineConditionStepForm from './PipelineConditionStepForm';
import PipelineField from './PipelineField';
import PipelineStepDetails from './PipelineStepDetails';
import PipelineWaitStepForm from './PipelineWaitStepForm';

// The selected step: a form for its kind, or its values for a reader. Problems of the
// step no field shows are listed at the top.
export default function PipelineStepInspector() {
  const t = useTranslations('pipelines');
  const { definition, selectedId, editable, issues, change, select } = usePipelineEditor();
  const step = selectedId ? findStep(definition.steps, selectedId) : undefined;
  if (!step) return <p className="text-sm text-muted-foreground">{t('inspector.empty')}</p>;
  const Icon = PIPELINE_STEP_ICONS[step.type];
  const update = (next: PipelineStep) =>
    change((current) => ({ ...current, steps: replaceStep(current.steps, step.id, next) }));

  return (
    <div key={step.id} className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t(`kinds.${step.type}`)}</span>
        {editable && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ms-auto text-muted-foreground hover:text-destructive"
            aria-label={t('inspector.delete')}
            title={t('inspector.delete')}
            onClick={() => {
              change((current) => ({ ...current, steps: removeStep(current.steps, step.id) }));
              select(null);
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <PipelineIssueList issues={unplacedStepIssues(issues, step)} />
      {editable ? (
        <>
          <PipelineField
            label={t('inspector.name')}
            htmlFor="step-name"
            issues={fieldIssues(issues, step.id, 'name')}
          >
            <Input
              id="step-name"
              value={step.name}
              maxLength={120}
              dir="auto"
              onChange={(event) => update({ ...step, name: event.target.value })}
            />
          </PipelineField>
          {step.type === 'agent' && <PipelineAgentStepForm step={step} onChange={update} />}
          {step.type === 'approval' && <PipelineApprovalStepForm step={step} onChange={update} />}
          {step.type === 'condition' && <PipelineConditionStepForm step={step} onChange={update} />}
          {step.type === 'action' && <PipelineActionStepForm step={step} onChange={update} />}
          {step.type === 'wait' && <PipelineWaitStepForm step={step} onChange={update} />}
        </>
      ) : (
        <PipelineStepDetails step={step} />
      )}
    </div>
  );
}
