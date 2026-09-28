import { Check, Circle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';

// A run's steps as a checklist: each tool it called, done, failed or still running.
export default function RunSteps({ events }: { events: AgUiEvent[] }) {
  const t = useTranslations('agentRuntime.runs');
  const steps = new Map<string, { name: string; state: 'running' | 'done' | 'failed' }>();
  for (const event of events) {
    if (event.type === 'TOOL_CALL_START' && event.toolCallId && event.toolCallName) {
      steps.set(event.toolCallId, { name: event.toolCallName, state: 'running' });
    }
    if (event.type === 'TOOL_CALL_RESULT' && event.toolCallId) {
      const step = steps.get(event.toolCallId);
      if (step) step.state = event.metadata?.isError || event.isError ? 'failed' : 'done';
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
            <span className="sr-only">{t(`stepState.${step.state}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}
