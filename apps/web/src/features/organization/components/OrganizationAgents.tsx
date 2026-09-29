'use client';

import { useTranslations } from 'next-intl';
import type { OrganizationAgent, OrganizationDepartment } from '@/lib/api/endpoints/organization';
import OrganizationAgentCard from './OrganizationAgentCard';
import { Text } from '@/design-system';

export default function OrganizationAgents({
  teamId,
  agents,
  departments,
}: {
  teamId: number;
  agents: OrganizationAgent[];
  departments: OrganizationDepartment[];
}) {
  const t = useTranslations('organization');

  if (agents.length === 0) {
    return (
      <Text as="p" size="sm" tone="muted" className="rounded-md border bg-card px-3 py-2">
        {t('agents.empty')}
      </Text>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {agents.map((agent) => (
        <OrganizationAgentCard
          key={agent.id}
          teamId={teamId}
          agent={agent}
          agents={agents}
          departments={departments}
        />
      ))}
    </div>
  );
}
