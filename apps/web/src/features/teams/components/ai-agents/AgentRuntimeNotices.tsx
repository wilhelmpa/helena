import { Notice } from '@/design-system';
import { useTranslations } from 'next-intl';
import type { AgentRuntimeState } from '@/lib/api/endpoints/agents';

// What the runner found in the agent's Hermes home that Plan does not manage: files and
// plugin links it put back, and jobs in Hermes' own scheduler.
export default function AgentRuntimeNotices({ state }: { state: AgentRuntimeState }) {
  const t = useTranslations('teams.agents.abilities.learning');
  const restored = [...new Set(state.restored)];
  const cronJobs = state.inventory?.cronJobs ?? 0;
  if (restored.length === 0 && cronJobs === 0) return null;

  return (
    <div className="space-y-2">
      {restored.length > 0 && (
        <Notice>
          {t('restored')}{' '}
          <span dir="ltr" className="font-mono text-xs">
            {restored.join(', ')}
          </span>
        </Notice>
      )}
      {cronJobs > 0 && <Notice tone="danger">{t('cronJobs', { count: cronJobs })}</Notice>}
    </div>
  );
}
