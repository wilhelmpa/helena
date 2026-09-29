'use client';

import { Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { organizationAgentRole, type OrganizationAgentRole } from '../organizationTree';
import { Box, Inline, Stack, Text } from '@/design-system';

const ROLES: OrganizationAgentRole[] = ['coordinator', 'specialist', 'reviewer', 'pool'];

const statusClass = {
  online: 'fill-status-success text-status-success',
  degraded: 'fill-status-waiting text-status-waiting',
  offline: 'fill-muted-foreground/40 text-muted-foreground/40',
};

// The project's agents grouped by their agent-team role, with the capabilities the Helena engine
// routes on.
export default function OrganizationOrchestrationTeam({ agents }: { agents: OrganizationAgent[] }) {
  const t = useTranslations('organization');

  return (
    <Stack as="section" gap={4} pad={4} className="rounded-md border bg-card">
      <div>
        <h2 className="text-md font-medium">{t('orchestration.teamTitle')}</h2>
        <Text as="p" size="xs" tone="muted">
          {t('orchestration.teamDescription')}
        </Text>
      </div>
      {ROLES.map((role) => {
        const members = agents.filter((agent) => organizationAgentRole(agent) === role);
        return (
          <Stack gap={2} key={role}>
            <h3 className="text-xs font-medium text-muted-foreground">
              {t(`roles.${role}`)} <span className="tabular-nums">{members.length}</span>
            </h3>
            {members.length === 0 ? (
              <Text as="p" size="sm" tone="muted">
                {t('values.none')}
              </Text>
            ) : (
              <ul className="divide-y rounded-md border">
                {members.map((agent) => (
                  <Box
                    as="li"
                    pad={3}
                    key={agent.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <Circle
                      className={`size-2.5 shrink-0 ${statusClass[agent.runtimeState.status]}`}
                    />
                    <div className="min-w-0 flex-1">
                      <Text as="p" size="sm" className="truncate font-medium" dir="auto">
                        {agent.name}
                      </Text>
                      <Text as="p" size="xs" tone="muted" className="truncate" dir="auto">
                        {agent.roleTitle || `@${agent.username}`}
                      </Text>
                    </div>
                    <Inline gap={1} wrap align="stretch">
                      <AgentPausedBadge agent={agent} />
                      {agent.capabilities.map((capability) => (
                        <Text
                          as="span"
                          size="xs"
                          tone="muted"
                          key={capability}
                          className="rounded-sm border px-1.5 py-0.5"
                        >
                          {capability}
                        </Text>
                      ))}
                    </Inline>
                  </Box>
                ))}
              </ul>
            )}
          </Stack>
        );
      })}
      <Text as="p" size="xs" tone="muted">
        {t('orchestration.editRoles')}
      </Text>
    </Stack>
  );
}
