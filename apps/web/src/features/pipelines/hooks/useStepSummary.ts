'use client';

import { useTranslations } from 'next-intl';
import type { PipelineStep } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../context/pipelineEditor';
import { findStep } from '../utils/editorState';
import { usePipelineLabels } from './usePipelineLabels';

const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';

// One line under a step card that says what the step does.
export function useStepSummary() {
  const t = useTranslations('pipelines');
  const { definition, context } = usePipelineEditor();
  const labels = usePipelineLabels();
  const roleName = (key: string) =>
    definition.roles.find((role) => role.key === key)?.name ?? key;

  return (step: PipelineStep): string => {
    switch (step.type) {
      case 'agent': {
        const assignee = step.assignee;
        const who =
          'role' in assignee
            ? t('summary.agentRole', { role: roleName(assignee.role) })
            : t('summary.agentDirect', {
                username:
                  context?.agents.find((agent) => agent.id === assignee.agentId)?.username ??
                  String(assignee.agentId),
              });
        return `${who} · ${firstLine(step.instruction) || t('summary.noInstruction')}`;
      }
      case 'approval':
        return step.onReject.action === 'goto'
          ? t('summary.approvalGoto', {
              step: findStep(definition.steps, step.onReject.stepId)?.name ?? step.onReject.stepId,
            })
          : firstLine(step.message) || t('summary.approvalEnd');
      case 'condition': {
        const test = step.condition;
        if (test.kind === 'outcome')
          return t('summary.outcome', {
            outcomes: test.outcomes
              .map((outcome) => t(`inspector.condition.outcomes.${outcome}`))
              .join(' / '),
          });
        if (test.kind === 'keyword') return t('summary.keyword', { keyword: test.keyword });
        const values = { field: t(`inspector.condition.fields.${test.field}`), values: test.values.join(', ') };
        return test.op === 'is' ? t('summary.taskIs', values) : t('summary.taskIsNot', values);
      }
      case 'action': {
        const action = step.action;
        switch (action.kind) {
          case 'set_status':
            return t('summary.setStatus', { status: action.status });
          case 'add_labels':
            return t('summary.addLabels', { labels: action.labels.join(', ') });
          case 'remove_labels':
            return t('summary.removeLabels', { labels: action.labels.join(', ') });
          case 'set_assignee': {
            const assignee = action.assignee;
            if (!assignee) return t('summary.unassign');
            if ('role' in assignee)
              return t('summary.assignRole', { role: roleName(assignee.role) });
            const member = context?.members.find((item) => item.id === assignee.userId);
            return t('summary.assignMember', { name: member?.name ?? assignee.userId });
          }
          case 'comment':
            return t('summary.comment', { text: firstLine(action.body) });
          case 'create_subtask':
            return t('summary.subtask', { title: action.title });
        }
        return '';
      }
      case 'wait':
        return step.wait.kind === 'delay'
          ? t('summary.waitDelay', { duration: labels.duration(step.wait.minutes) })
          : t('summary.waitUntil', {
              field: t(`inspector.wait.fields.${step.wait.field}`),
              time: step.wait.time,
            });
    }
  };
}
