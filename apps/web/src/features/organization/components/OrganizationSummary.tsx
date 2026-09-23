'use client';

import { Bot, Network, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { organizationAgentRole } from '../organizationTree';

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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-2">
      {cards.map(({ key, value, icon: Icon }) => (
        <div key={key} className="flex h-8 items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" />
          <span className="text-md font-semibold tabular-nums">{value}</span>
          <span className="text-muted-foreground">{t(`summary.${key}`)}</span>
        </div>
      ))}
    </div>
  );
}
