'use client';

import { useTranslations } from 'next-intl';
import { RowEmpty, RowList } from '@/components/common/page/RowList';
import type { OrganizationAgent, OrganizationDepartment } from '@/lib/api/endpoints/organization';
import OrganizationAgentCard from './OrganizationAgentCard';

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
      <RowList className="bg-card">
        <RowEmpty>{t('agents.empty')}</RowEmpty>
      </RowList>
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
