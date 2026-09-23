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

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
      {cards.map(({ key, value, icon: Icon }) => (
        <div key={key} className="flex items-center gap-3 rounded-lg border bg-background p-3">
          <Icon className="size-4 text-muted-foreground" />
          <div>
            <p className="text-xl leading-none font-semibold">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t(`summary.${key}`)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
