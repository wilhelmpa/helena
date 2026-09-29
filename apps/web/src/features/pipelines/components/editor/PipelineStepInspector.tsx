'use client';

import { Puzzle, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isPluginStep, type PipelineStep } from '@/lib/api/endpoints/pipelines';
import { PIPELINE_STEP_ICONS } from '@/utils/pipelineStepIcons';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { usePluginTypes } from '../../hooks/usePluginTypes';
import { findStep, removeStep, replaceStep } from '../../utils/editorState';
import { fieldIssues, unplacedStepIssues } from '../../utils/issueDisplay';
import PipelineIssueList from '../PipelineIssueList';
import PipelineActionStepForm from './PipelineActionStepForm';
import PipelineAgentStepForm from './PipelineAgentStepForm';
import PipelineApprovalStepForm from './PipelineApprovalStepForm';
import PipelineConditionStepForm from './PipelineConditionStepForm';
import PipelineDecisionStepForm from './PipelineDecisionStepForm';
import PipelineField from './PipelineField';
import PipelineNotifyStepForm from './PipelineNotifyStepForm';
import PipelinePluginFields from './PipelinePluginFields';
import PipelineStepDetails from './PipelineStepDetails';
import PipelineWaitStepForm from './PipelineWaitStepForm';
import PipelineWebhookStepForm from './PipelineWebhookStepForm';
import { Inline, Stack, Text } from '@/design-system';

// The selected step: a form for its kind, or its values for a reader. Problems of the
// step no field shows are listed at the top.
export default function PipelineStepInspector() {
  const t = useTranslations('pipelines');
  const { definition, selectedId, editable, issues, change, select } = usePipelineEditor();
  const plugins = usePluginTypes();
  const step = selectedId ? findStep(definition.steps, selectedId) : undefined;
  if (!step)
    return (
      <Text as="p" size="sm" tone="muted">
        {t('inspector.empty')}
      </Text>
    );
  const Icon = isPluginStep(step) ? Puzzle : PIPELINE_STEP_ICONS[step.type];
  const plugin = isPluginStep(step) ? plugins.stepInfo(step.type) : null;
  const update = (next: PipelineStep) =>
    change((current) => ({ ...current, steps: replaceStep(current.steps, step.id, next) }));

  return (
    <Stack gap={4} key={step.id}>
      <Inline gap={2}>
        <Icon className="size-4 text-muted-foreground" />
        <Text as="span" size="sm" className="font-medium">
          {plugins.stepLabel(step.type)}
        </Text>
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
      </Inline>
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
          {step.type === 'decision' && <PipelineDecisionStepForm step={step} onChange={update} />}
          {step.type === 'action' && <PipelineActionStepForm step={step} onChange={update} />}
          {step.type === 'wait' && <PipelineWaitStepForm step={step} onChange={update} />}
          {step.type === 'notify' && <PipelineNotifyStepForm step={step} onChange={update} />}
          {step.type === 'webhook' && <PipelineWebhookStepForm step={step} onChange={update} />}
          {isPluginStep(step) &&
            (plugin ? (
              <>
                {plugin.description && (
                  <Text as="p" size="xs" tone="muted">
                    {plugins.text(plugin.description)}
                  </Text>
                )}
                <PipelinePluginFields
                  idPrefix="step-config"
                  schema={plugin.configSchema}
                  value={step.config}
                  stepId={step.id}
                  issuesOf={(field) => fieldIssues(issues, step.id, field)}
                  onChange={(config) => update({ ...step, config })}
                />
              </>
            ) : (
              <Text as="p" size="sm" tone="muted">
                {t('inspector.plugin.missing', { type: step.type })}
              </Text>
            ))}
        </>
      ) : (
        <PipelineStepDetails step={step} />
      )}
    </Stack>
  );
}
