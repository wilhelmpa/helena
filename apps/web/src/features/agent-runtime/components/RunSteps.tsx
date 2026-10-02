import { Check, Circle, Minus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  exitedNonzero,
  toolResultFailed,
  type ToolOutcome,
} from '@/components/agent-message/toolOutcome';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';

type StepState = 'running' | 'done' | 'exited' | 'failed';

// A run's steps as a checklist: each tool it called, done, ended with a code, failed or
// still running.
export default function RunSteps({ events }: { events: AgUiEvent[] }) {
  const t = useTranslations('agentRuntime.runs');
  const steps = new Map<string, { name: string; state: StepState; exitCode: number | null }>();
  for (const event of events) {
    if (event.type === 'TOOL_CALL_START' && event.toolCallId && event.toolCallName) {
      steps.set(event.toolCallId, { name: event.toolCallName, state: 'running', exitCode: null });
    }
    if (event.type === 'TOOL_CALL_RESULT' && event.toolCallId) {
      const step = steps.get(event.toolCallId);
      if (step) {
        const exitCode =
          typeof event.metadata?.exitCode === 'number' ? event.metadata.exitCode : null;
        const result = {
          isError: event.metadata?.isError === true || event.isError === true,
          outcome: event.metadata?.outcome as ToolOutcome | undefined,
          exitCode,
        };
        step.exitCode = exitCode;
        step.state = toolResultFailed(result)
          ? 'failed'
          : exitedNonzero(result)
            ? 'exited'
            : 'done';
      }
    }
  }
  if (!steps.size) return <p className="ds-run-note">{t('noSteps')}</p>;
  return (
    <ol className="ds-run-steps">
      {[...steps.entries()].map(([id, step]) => {
        const Icon =
          step.state === 'done'
            ? Check
            : step.state === 'failed'
              ? X
              : step.state === 'exited'
                ? Minus
                : Circle;
        const code = step.state === 'exited' || step.state === 'failed' ? step.exitCode : null;
        return (
          <li key={id} data-state={step.state}>
            <Icon aria-hidden="true" size={14} />
            <span dir="ltr">{step.name}</span>
            <span className={code != null ? undefined : 'sr-only'}>
              {code != null
                ? t(step.state === 'failed' ? 'stepFailedExit' : 'stepExited', { code })
                : t(`stepState.${step.state === 'exited' ? 'done' : step.state}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
