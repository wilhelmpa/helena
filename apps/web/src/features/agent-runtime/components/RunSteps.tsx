import { Check, Circle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toolResultFailed } from '@/components/agent-message/toolOutcome';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';

// A run's steps as a checklist: each tool it called, done, failed or still running.
export default function RunSteps({ events }: { events: AgUiEvent[] }) {
  const t = useTranslations('agentRuntime.runs');
  const steps = new Map<
    string,
    { name: string; state: 'running' | 'done' | 'failed'; exitCode?: number | null }
  >();
  for (const event of events) {
    if (event.type === 'TOOL_CALL_START' && event.toolCallId && event.toolCallName) {
      steps.set(event.toolCallId, { name: event.toolCallName, state: 'running' });
    }
    if (event.type === 'TOOL_CALL_RESULT' && event.toolCallId) {
      const step = steps.get(event.toolCallId);
      if (step) {
        step.state = toolResultFailed({
          ...event.metadata,
          isError: event.metadata?.isError === true || event.isError === true,
        })
          ? 'failed'
          : 'done';
        step.exitCode =
          typeof event.metadata?.exitCode === 'number' ? event.metadata.exitCode : null;
      }
    }
  }
  if (!steps.size) return <p className="ds-run-note">{t('noSteps')}</p>;
  return (
    <ol className="ds-run-steps">
      {[...steps.entries()].map(([id, step]) => {
        const Icon = step.state === 'done' ? Check : step.state === 'failed' ? X : Circle;
        return (
          <li key={id} data-state={step.state}>
            <Icon aria-hidden="true" size={14} />
            <span dir="ltr">{step.name}</span>
            <span
              className={step.state === 'failed' && step.exitCode != null ? undefined : 'sr-only'}
            >
              {step.state === 'failed' && step.exitCode != null
                ? t('stepFailedExit', { code: step.exitCode })
                : t(`stepState.${step.state}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
