'use client';

import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentStep } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { fieldIssues } from '../../utils/issueDisplay';
import PipelineField from './PipelineField';
import PipelineNumberInput from './PipelineNumberInput';
import PipelineTemplateText from './PipelineTemplateText';
import { Text } from '@/design-system';

const AGENT_MODEL = '__agent';

// An agent step: a role, or in a project workflow one of its agents, with the
// instruction and the limits of its run. The run budget is edited in minutes.
export default function PipelineAgentStepForm({
  step,
  onChange,
}: {
  step: AgentStep;
  onChange: (step: AgentStep) => void;
}) {
  const t = useTranslations('pipelines.inspector.agent');
  const { definition, context, template, issues } = usePipelineEditor();
  const issuesOf = (field: string) => fieldIssues(issues, step.id, field);
  const assignee =
    'role' in step.assignee ? `role:${step.assignee.role}` : `agent:${step.assignee.agentId}`;
  const agents = template ? [] : (context?.agents ?? []);
  const models = context?.models ?? [];
  const modelOptions =
    step.model && !models.includes(step.model) ? [step.model, ...models] : models;

  return (
    <>
      <PipelineField label={t('assignee')} htmlFor="step-assignee" issues={issuesOf('assignee')}>
        <Select
          value={assignee}
          onValueChange={(value) =>
            onChange({
              ...step,
              assignee: value.startsWith('role:')
                ? { role: value.slice(5) }
                : { agentId: Number(value.slice(6)) },
            })
          }
        >
          <SelectTrigger id="step-assignee" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t('roles')}</SelectLabel>
              {definition.roles.map((role) => (
                <SelectItem key={role.key} value={`role:${role.key}`}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectGroup>
            {agents.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t('agents')}</SelectLabel>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={`agent:${agent.id}`}>
                    {agent.name} (@{agent.username})
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </PipelineField>
      <PipelineTemplateText
        id="step-instruction"
        label={t('instruction')}
        stepId={step.id}
        value={step.instruction}
        maxLength={8000}
        rows={8}
        placeholder={t('instructionPlaceholder')}
        issues={issuesOf('instruction')}
        onChange={(instruction) => onChange({ ...step, instruction })}
      />
      <div className="grid grid-cols-2 gap-3">
        <PipelineField
          label={t('timeout')}
          htmlFor="step-timeout"
          issues={issuesOf('timeoutMinutes')}
        >
          <PipelineNumberInput
            id="step-timeout"
            value={step.timeoutMinutes}
            min={5}
            max={1440}
            onChange={(value) => onChange({ ...step, timeoutMinutes: value ?? Number.NaN })}
          />
        </PipelineField>
        <PipelineField label={t('maxTurns')} htmlFor="step-turns" issues={issuesOf('maxTurns')}>
          <PipelineNumberInput
            id="step-turns"
            value={step.maxTurns}
            min={1}
            max={200}
            placeholder={t('noLimit')}
            onChange={(maxTurns) => onChange({ ...step, maxTurns })}
          />
        </PipelineField>
        <PipelineField
          label={t('runBudget')}
          htmlFor="step-budget"
          issues={issuesOf('runBudgetSeconds')}
        >
          <PipelineNumberInput
            id="step-budget"
            value={step.runBudgetSeconds === null ? null : Math.round(step.runBudgetSeconds / 60)}
            min={1}
            max={120}
            placeholder={t('noLimit')}
            onChange={(minutes) =>
              onChange({ ...step, runBudgetSeconds: minutes === null ? null : minutes * 60 })
            }
          />
        </PipelineField>
        <PipelineField label={t('model')} htmlFor="step-model" issues={issuesOf('model')}>
          <Select
            value={step.model ?? AGENT_MODEL}
            onValueChange={(value) =>
              onChange({ ...step, model: value === AGENT_MODEL ? null : value })
            }
          >
            <SelectTrigger id="step-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AGENT_MODEL}>{t('agentModel')}</SelectItem>
              {modelOptions.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PipelineField>
      </div>
      <Text as="p" size="xs" tone="muted">
        {t('limitsHint')}
      </Text>
    </>
  );
}
