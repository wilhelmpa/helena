'use client';

import { useTranslations } from 'next-intl';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import OrganizationTokenUsage from './OrganizationTokenUsage';
import { Inline, Stack, Text } from '@/design-system';

// What each agent of the project used against its own ceilings.
export default function OrganizationOrchestrationAgentUsage({
  agents,
}: {
  agents: OrganizationAgent[];
}) {
  const t = useTranslations('organization.tokens');
  if (agents.length === 0) return null;

  return (
    <Stack gap={2}>
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{t('agentsTitle')}</h3>
        <Text as="p" size="xs" tone="muted">
          {t('agentsHint')}
        </Text>
      </div>
      <Stack as="ul" gap={3}>
        {agents.map((agent) => (
          <Stack as="li" gap={2} key={agent.id}>
            <Inline gap={2} className="min-w-0">
              <Text as="span" size="sm" className="truncate font-medium" dir="auto">
                {agent.name}
              </Text>
              <AgentPausedBadge agent={agent} />
            </Inline>
            <OrganizationTokenUsage
              label={t('today')}
              used={agent.tokensToday}
              ceiling={agent.dailyTokenCeiling}
            />
            <OrganizationTokenUsage
              label={t('thisMonth')}
              used={agent.tokensThisMonth}
              ceiling={agent.monthlyTokenCeiling}
            />
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
