import { useTranslations } from 'next-intl';
import type { ModelCheck } from '@/lib/api/endpoints/agentRuntimeSync';

// The model and reasoning a run was configured with next to what its session really ran
// on, as its runner read them back. A mismatch is named: the run did not run as set.
export default function AgentRunModel({ check }: { check: ModelCheck }) {
  const t = useTranslations('teams.agents.runModel');
  const { configured, used, mismatch } = check;
  const configuredText = [configured.model ?? '–', configured.reasoning]
    .filter(Boolean)
    .join(' · ');
  const usedText = used ? [used.model ?? '–', used.reasoning].filter(Boolean).join(' · ') : null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{t('title')}</div>
      <div className="rounded-md bg-muted/50 p-2.5 text-xs">
        <p>
          {t('configured', { value: configuredText })}{' '}
          <span className="text-muted-foreground">({t(`source.${configured.source}`)})</span>
        </p>
        <p>{usedText ? t('used', { value: usedText }) : t('notReported')}</p>
        {mismatch.length > 0 && (
          <p className="font-medium text-status-waiting">
            {t('mismatch', { what: mismatch.map((part) => t(`part.${part}`)).join(', ') })}
          </p>
        )}
      </div>
    </div>
  );
}
