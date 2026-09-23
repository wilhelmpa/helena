'use client';

import { Building2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import type { OrganizationDepartmentNode as DepartmentNode } from '../organizationTree';
import OrganizationAgentNode from './OrganizationAgentNode';
import OrganizationGoalNode from './OrganizationGoalNode';

export default function OrganizationDepartmentNode({
  node,
  agents,
}: {
  node: DepartmentNode;
  agents: OrganizationAgent[];
}) {
  const t = useTranslations('organization');
  return (
    <li className="relative ps-6 before:absolute before:start-0 before:top-0 before:h-6 before:w-5 before:rounded-bl-md before:border-s before:border-b">
      <section className="rounded-lg border bg-muted/20 p-4">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          <h3 className="font-medium">{node.department?.name ?? t('map.unassigned')}</h3>
        </div>
        {node.department?.description && (
          <p className="mt-1 text-xs text-muted-foreground">{node.department.description}</p>
        )}
        {node.agents.length > 0 && (
          <ul className="mt-4 space-y-3 border-s">
            {node.agents.map((agent) => (
              <OrganizationAgentNode key={agent.agent.id} node={agent} agents={agents} />
            ))}
          </ul>
        )}
        {node.goals.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t('tabs.goals')}</p>
            <ul className="space-y-2 border-s">
              {node.goals.map((goal) => (
                <OrganizationGoalNode key={goal.goal.id} node={goal} />
              ))}
            </ul>
          </div>
        )}
      </section>
      {node.children.length > 0 && (
        <ul className="ms-4 space-y-4 border-s pt-4">
          {node.children.map((child) => (
            <OrganizationDepartmentNode
              key={child.department?.id ?? 'unassigned'}
              node={child}
              agents={agents}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
