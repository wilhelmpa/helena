'use client';

import { Building2, LayoutTemplate, TriangleAlert, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { OrganizationDepartmentNode as DepartmentNode } from '../organizationTree';
import OrganizationAgentNode from './OrganizationAgentNode';
import OrganizationGoalNode from './OrganizationGoalNode';

// Only the 'unassigned' bucket is a real problem (a genuine orphan with no manager and
// no template flag): it gets the red treatment. 'none' (no department, but placed in
// the reporting chain) and 'templates' (pool templates) are normal states.
const KIND_ICON = {
  department: Building2,
  none: Users,
  templates: LayoutTemplate,
  unassigned: TriangleAlert,
} as const;

export default function OrganizationDepartmentNode({ node }: { node: DepartmentNode }) {
  const t = useTranslations('organization');
  const Icon = KIND_ICON[node.kind];
  const label =
    node.department?.name ??
    (node.kind === 'templates'
      ? t('map.templates')
      : node.kind === 'unassigned'
        ? t('map.unassigned')
        : t('map.noDepartment'));
  const isWarning = node.kind === 'unassigned';
  return (
    <li className="relative ps-6 before:absolute before:start-0 before:top-0 before:h-6 before:w-5 before:rounded-bl-md before:border-s before:border-b">
      <section
        className={cn(
          'rounded-lg border bg-muted/20 p-4',
          isWarning && 'border-destructive/40 bg-destructive/5',
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn('size-4 text-muted-foreground', isWarning && 'text-destructive')} />
          <h3 className={cn('font-medium', isWarning && 'text-destructive')}>{label}</h3>
        </div>
        {node.kind === 'unassigned' && (
          <p className="mt-1 text-xs text-destructive/80">{t('map.unassignedHint')}</p>
        )}
        {node.department?.description && (
          <p className="mt-1 text-xs text-muted-foreground">{node.department.description}</p>
        )}
        {node.agents.length > 0 && (
          <ul className="mt-4 space-y-3 border-s">
            {node.agents.map((agent) => (
              <OrganizationAgentNode key={agent.agent.id} node={agent} />
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
            <OrganizationDepartmentNode key={child.department?.id ?? child.kind} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
