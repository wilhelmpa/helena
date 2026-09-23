'use client';

import { Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { organizationAgentRole, type OrganizationAgentRole } from '../organizationTree';

const ROLES: OrganizationAgentRole[] = ['coordinator', 'specialist', 'reviewer', 'pool'];

const statusClass = {
  online: 'fill-emerald-500 text-emerald-500',
  degraded: 'fill-amber-500 text-amber-500',
  offline: 'fill-muted-foreground/40 text-muted-foreground/40',
};

// The project's agents grouped by their agent-team role, with the capabilities Mastra
// routes on.
export default function OrganizationOrchestrationTeam({ agents }: { agents: OrganizationAgent[] }) {
  const t = useTranslations('organization');

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-medium">{t('orchestration.teamTitle')}</h2>
        <p className="text-xs text-muted-foreground">{t('orchestration.teamDescription')}</p>
      </div>
      {ROLES.map((role) => {
        const members = agents.filter((agent) => organizationAgentRole(agent) === role);
        return (
          <div key={role} className="space-y-1.5">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t(`roles.${role}`)} <span className="tabular-nums">{members.length}</span>
            </h3>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('values.none')}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {members.map((agent) => (
                  <li key={agent.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5">
                    <Circle
                      className={`size-2.5 shrink-0 ${statusClass[agent.runtimeState.status]}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" dir="auto">
                        {agent.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" dir="auto">
                        {agent.roleTitle || `@${agent.username}`}
                        {agent.kind === 'internal' && ` · ${t('orchestration.internal')}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {agent.capabilities.map((capability) => (
                        <span
                          key={capability}
                          className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {capability}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">{t('orchestration.editRoles')}</p>
    </section>
  );
}
