import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
        <Alert>
          <AlertDescription>
            {t('restored')}{' '}
            <span dir="ltr" className="font-mono text-xs">
              {restored.join(', ')}
            </span>
          </AlertDescription>
        </Alert>
      )}
      {cronJobs > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{t('cronJobs', { count: cronJobs })}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
