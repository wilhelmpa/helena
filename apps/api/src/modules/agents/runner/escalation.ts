import { parseLocalModelId } from '@helena/sdk';
import {
  escalate,
  type EscalationFailure,
  type EscalationSettings,
} from '#modules/escalation/rules';

export interface FailedRunForEscalation {
  agentId: number;
  projectId: number;
  issueId: number | null;
  runtime: string;
  agentModel: string | null;
  model: string | null;
  configuredModel: string | null;
  modelSource: string | null;
  attempts: number;
  error: string | null;
}

export function failureKind(error: string | null): EscalationFailure {
  if (/test(?:s)? (?:failed|failing)|(?:failed|failing) test/i.test(error ?? ''))
    return 'tests-failed';
  if (/\b(loop|repeated|stuck|resume limit)\b/i.test(error ?? '')) return 'loop';
  if (/\b(timeout|timed out|time limit|deadline)\b/i.test(error ?? '')) return 'timeout';
  return 'error';
}

export function failedRunEscalation(
  settings: EscalationSettings,
  run: FailedRunForEscalation,
): { model: string; reason: string } | null {
  if (run.runtime !== 'claude' && run.runtime !== 'codex') return null;
  if (
    run.modelSource !== 'local' &&
    !parseLocalModelId(run.model) &&
    !parseLocalModelId(run.configuredModel)
  )
    return null;
  const decision = escalate(settings, {
    agentId: run.agentId,
    projectId: run.projectId,
    taskId: run.issueId,
    failure: failureKind(run.error),
    localAttempts: Math.max(1, run.attempts),
  });
  if (!decision.model) return null;
  const compatible = (model: string | null) =>
    model && (run.runtime === 'claude' ? model.startsWith('claude-') : model.startsWith('gpt-'));
  const model = compatible(decision.model)
    ? decision.model
    : compatible(run.agentModel)
      ? run.agentModel!
      : run.runtime === 'claude'
        ? 'claude-opus-5-5'
        : 'gpt-6-sol';
  return { model, reason: decision.detail ?? decision.reason };
}
