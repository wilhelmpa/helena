import { Check, Circle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';

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
  return (
    <section aria-labelledby="run-steps-title" className="space-y-3">
      <h2 id="run-steps-title" className="text-sm font-semibold">
        {t('steps')}
      </h2>
      {steps.size ? (
        <ol className="space-y-2">
          {[...steps.entries()].map(([id, step]) => {
            const Icon = step.state === 'done' ? Check : step.state === 'failed' ? X : Circle;
            return (
              <li key={id} className="flex items-center gap-2 text-sm">
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span>{step.name}</span>
                <span className="sr-only">{t(`stepState.${step.state}`)}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noSteps')}</p>
      )}
    </section>
  );
}
