'use client';

import { Bot, Network, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { organizationAgentRole } from '../organizationTree';
import { Box, Inline, Text } from '@/design-system';

export default function OrganizationSummary({ agents }: { agents: OrganizationAgent[] }) {
  const t = useTranslations('organization');
  const coordinators = agents.filter(
    (agent) => organizationAgentRole(agent) === 'coordinator',
  ).length;
  const specialists = agents.filter(
    (agent) => organizationAgentRole(agent) === 'specialist',
  ).length;
  const cards = [
    { key: 'pool', value: agents.length, icon: Bot },
    { key: 'coordinators', value: coordinators, icon: Network },
    { key: 'specialists', value: specialists, icon: UsersRound },
  ] as const;

  // Plain figures in one line, like Home's KPI row: a count, not a control, so no frame.
  return (
    <Box padX={2} className="flex flex-wrap items-center gap-x-5 gap-y-1">
      {cards.map(({ key, value, icon: Icon }) => (
        <Inline gap={2} key={key} className="h-8 text-sm">
          <Icon className="size-4 text-muted-foreground" />
          <Text as="span" size="md" className="font-semibold tabular-nums">
            {value}
          </Text>
          <span className="text-muted-foreground">{t(`summary.${key}`)}</span>
        </Inline>
      ))}
    </Box>
  );
}
