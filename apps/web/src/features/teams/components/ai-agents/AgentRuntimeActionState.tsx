import { useTranslations } from 'next-intl';
import type { RuntimeAction } from '@/lib/api/endpoints/agentLearning';

// Whether the owner's newest action on a learned skill or a memory file still waits for
// the runner, or why it failed.
export default function AgentRuntimeActionState({ action }: { action: RuntimeAction | null }) {
  const t = useTranslations('teams.agents.abilities.learning');
  if (!action) return null;
  return action.error === null ? (
    <span className="block text-xs text-muted-foreground">{t('waiting')}</span>
  ) : (
    <span className="block text-xs text-destructive">{t('failed', { error: action.error })}</span>
  );
}
