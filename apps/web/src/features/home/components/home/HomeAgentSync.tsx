import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/common/page/StatusBadge';
import type { AgentSyncSummary } from '@/lib/api/endpoints/god';
import { syncStatus } from '@/features/teams/utils/agentProfileSync';
import { Box, Inline, Text } from '@/design-system';

// Whether every agent's runtime runs on its settings in Helena: how many are in sync, and
// each one that is not, with why. A report, not a control.
export default function HomeAgentSync({ summary }: { summary: AgentSyncSummary }) {
  const t = useTranslations('god.systemHealth.agentSync');
  const ts = useTranslations('teams.agents.profileSync');
  if (summary.total === 0) return null;
  return (
    <Box as="ul" pad={1} className="rounded-md border bg-card">
      <Inline as="li" gap={2} padX={2} className="h-8 min-w-0 text-sm">
        <StatusBadge status={summary.synced === summary.total ? 'success' : 'waiting'} dotOnly />
        <span className="min-w-0 truncate">{t('title')}</span>
        <Text as="span" size="xs" tone="muted" className="ms-auto shrink-0">
          {t('synced', { synced: summary.synced, total: summary.total })}
        </Text>
      </Inline>
      {summary.agents.map((agent) => (
        <Inline
          as="li"
          gap={2}
          padX={2}
          key={agent.id}
          className="h-8 min-w-0 text-sm"
          title={agent.drift.join(', ') || undefined}
        >
          <StatusBadge status={syncStatus(agent.state)} dotOnly />
          <span className="min-w-0 truncate">@{agent.username}</span>
          <Text as="span" size="xs" tone="muted" className="ms-auto shrink-0">
            {agent.issues?.some((issue) => issue.code === 'not-signed-in')
              ? ts('issues.notSignedInShort')
              : agent.issues?.some((issue) => issue.code === 'runtime-missing')
                ? ts('issues.runtimeMissingShort')
                : agent.issues?.some((issue) => issue.code === 'sandbox-unavailable')
                  ? ts('issues.sandboxUnavailableShort')
                  : ts(`state.${agent.state}`)}
          </Text>
        </Inline>
      ))}
    </Box>
  );
}
