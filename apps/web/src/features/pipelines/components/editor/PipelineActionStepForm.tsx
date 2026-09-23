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
import { ACTION_KINDS, type ActionStep, type TaskAction } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { fieldIssues } from '../../utils/issueDisplay';
import PipelineField from './PipelineField';
import PipelineNameInput from './PipelineNameInput';
import PipelineNamesInput from './PipelineNamesInput';
import PipelineTemplateText from './PipelineTemplateText';

const NOBODY = '__nobody';

const actionOf = (kind: TaskAction['kind']): TaskAction =>
  kind === 'set_status'
    ? { kind, status: '' }
    : kind === 'add_labels' || kind === 'remove_labels'
      ? { kind, labels: [] }
      : kind === 'set_assignee'
        ? { kind, assignee: null }
        : kind === 'comment'
          ? { kind, body: '' }
          : { kind, title: '', description: '' };

// A change to the task. Statuses and labels are named; members only in a project
// workflow, a template names roles.
export default function PipelineActionStepForm({
  step,
  onChange,
}: {
  step: ActionStep;
  onChange: (step: ActionStep) => void;
}) {
  const t = useTranslations('pipelines.inspector.action');
  const { definition, context, template, issues } = usePipelineEditor();
  const issuesOf = (field: string) => fieldIssues(issues, step.id, field);
  const action = step.action;
  const set = (next: TaskAction) => onChange({ ...step, action: next });
  const text = (
    field: string,
    value: string,
    apply: (value: string) => TaskAction,
    single = false,
  ) => (
    <PipelineTemplateText
      id={`step-${field}`}
      label={t(field as 'body' | 'title' | 'description')}
      stepId={step.id}
      value={value}
      maxLength={field === 'title' ? 300 : 8000}
      singleLine={single}
      issues={issuesOf(`action.${field}`)}
      onChange={(next) => set(apply(next))}
    />
  );
  const members = template ? [] : (context?.members ?? []);
  const assignee =
    action.kind !== 'set_assignee' || !action.assignee
      ? NOBODY
      : 'role' in action.assignee
        ? `role:${action.assignee.role}`
        : `user:${action.assignee.userId}`;

  return (
    <>
      <PipelineField label={t('kind')} htmlFor="step-action" issues={issuesOf('action.kind')}>
        <Select
          value={action.kind}
          onValueChange={(kind) => set(actionOf(kind as TaskAction['kind']))}
        >
          <SelectTrigger id="step-action" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PipelineField>
      {action.kind === 'set_status' && (
        <PipelineField label={t('status')} htmlFor="step-status" issues={issuesOf('action.status')}>
          <PipelineNameInput
            id="step-status"
            value={action.status}
            options={context?.statuses.map((status) => status.name)}
            onChange={(status) => set({ ...action, status })}
          />
        </PipelineField>
      )}
      {(action.kind === 'add_labels' || action.kind === 'remove_labels') && (
        <PipelineField label={t('labels')} htmlFor="step-labels" issues={issuesOf('action.labels')}>
          <PipelineNamesInput
            id="step-labels"
            value={action.labels}
            options={context?.labels.map((label) => ({ value: label.name, label: label.name }))}
            onChange={(labels) => set({ ...action, labels })}
          />
        </PipelineField>
      )}
      {action.kind === 'set_assignee' && (
        <PipelineField
          label={t('assignee')}
          htmlFor="step-assign"
          issues={issuesOf('action.assignee')}
        >
          <Select
            value={assignee}
            onValueChange={(value) =>
              set({
                kind: 'set_assignee',
                assignee:
                  value === NOBODY
                    ? null
                    : value.startsWith('role:')
                      ? { role: value.slice(5) }
                      : { userId: value.slice(5) },
              })
            }
          >
            <SelectTrigger id="step-assign" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOBODY}>{t('nobody')}</SelectItem>
              <SelectGroup>
                <SelectLabel>{t('roles')}</SelectLabel>
                {definition.roles.map((role) => (
                  <SelectItem key={role.key} value={`role:${role.key}`}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              {members.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t('members')}</SelectLabel>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={`user:${member.id}`}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </PipelineField>
      )}
      {action.kind === 'comment' && text('body', action.body, (body) => ({ ...action, body }))}
      {action.kind === 'create_subtask' && (
        <>
          {text('title', action.title, (title) => ({ ...action, title }), true)}
          {text('description', action.description, (description) => ({ ...action, description }))}
        </>
      )}
    </>
  );
}
