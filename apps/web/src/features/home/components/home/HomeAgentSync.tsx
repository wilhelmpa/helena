import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/common/page/StatusBadge';
import type { AgentSyncSummary } from '@/lib/api/endpoints/god';
import { syncStatus } from '@/features/teams/utils/agentProfileSync';

// Whether every agent's runtime runs on its settings in Helena: how many are in sync, and
// each one that is not, with why. A report, not a control.
export default function HomeAgentSync({ summary }: { summary: AgentSyncSummary }) {
  const t = useTranslations('god.systemHealth.agentSync');
  const ts = useTranslations('teams.agents.profileSync');
  if (summary.total === 0) return null;
  return (
    <ul className="rounded-md border bg-card p-1">
      <li className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm">
        <StatusBadge status={summary.synced === summary.total ? 'success' : 'waiting'} dotOnly />
        <span className="min-w-0 truncate">{t('title')}</span>
        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
          {t('synced', { synced: summary.synced, total: summary.total })}
        </span>
      </li>
      {summary.agents.map((agent) => (
        <li
          key={agent.id}
          className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm"
          title={agent.drift.join(', ') || undefined}
        >
          <StatusBadge status={syncStatus(agent.state)} dotOnly />
          <span className="min-w-0 truncate">@{agent.username}</span>
          <span className="ms-auto shrink-0 text-xs text-muted-foreground">
            {agent.issues?.some((issue) => issue.code === 'not-signed-in')
              ? ts('issues.notSignedInShort')
              : agent.issues?.some((issue) => issue.code === 'runtime-missing')
                ? ts('issues.runtimeMissingShort')
                : agent.issues?.some((issue) => issue.code === 'sandbox-unavailable')
                  ? ts('issues.sandboxUnavailableShort')
                  : ts(`state.${agent.state}`)}
          </span>
        </li>
      ))}
    </ul>
  );
}
