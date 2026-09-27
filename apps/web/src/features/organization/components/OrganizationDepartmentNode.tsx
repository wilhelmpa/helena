'use client';

import { Building2, LayoutTemplate, TriangleAlert, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  countAgents,
  type OrganizationDepartmentNode as DepartmentNode,
} from '../organizationTree';
import OrganizationAgentNode from './OrganizationAgentNode';
import OrganizationGoalNode from './OrganizationGoalNode';

// Only the 'unassigned' bucket is a real problem (a genuine orphan with no manager and
// no template flag): it gets the red treatment. 'none' (no department, but placed in
// the reporting chain) and 'templates' (pool templates) are normal states.
const KIND_ICON = {
  home: Users,
  department: Building2,
  none: Users,
  templates: LayoutTemplate,
  unassigned: TriangleAlert,
} as const;

export default function OrganizationDepartmentNode({
  node,
  work,
}: {
  node: DepartmentNode;
  work: Map<number, 'running' | 'waiting'>;
}) {
  const t = useTranslations('organization');
  // Home, and the top of a chain outside every department (a project's coordinator on
  // the project page, where Home is not shown), are roots, not a group called
  // "Ohne Abteilung": departments come from projects, so that label only confused.
  if (node.kind === 'home' || node.kind === 'none') return <PlainRoots node={node} work={work} />;
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
    <li className="relative ps-5 before:absolute before:start-0 before:top-0 before:h-4 before:w-4 before:rounded-es-md before:border-s before:border-b before:border-sidebar-border">
      <section>
        <div className="flex h-8 items-center gap-2 px-2">
          <Icon
            className={cn(
              'size-4 shrink-0 text-muted-foreground',
              isWarning && 'text-status-danger',
            )}
          />
          <h3 className={cn('text-sm font-medium', isWarning && 'text-status-danger')}>{label}</h3>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {countAgents(node)}
          </span>
          {(node.kind === 'unassigned' || node.department?.description) && (
            <span
              className={cn(
                'min-w-0 truncate text-xs',
                isWarning ? 'text-status-danger' : 'text-muted-foreground',
              )}
            >
              {node.kind === 'unassigned' ? t('map.unassignedHint') : node.department?.description}
            </span>
          )}
        </div>
        {node.agents.length > 0 && (
          <ul
            className={cn(
              'ms-4 border-s border-sidebar-border',
              isWarning && 'border-status-danger/40',
            )}
          >
            {node.agents.map((agent) => (
              <OrganizationAgentNode key={agent.agent.id} node={agent} work={work} />
            ))}
          </ul>
        )}
        {node.goals.length > 0 && (
          <div className="ms-4 mt-1 border-s border-sidebar-border ps-4">
            <p className="flex h-8 items-center text-xs font-medium text-muted-foreground">
              {t('tabs.goals')}
            </p>
            <ul className="space-y-1">
              {node.goals.map((goal) => (
                <OrganizationGoalNode key={goal.goal.id} node={goal} />
              ))}
            </ul>
          </div>
        )}
      </section>
      {node.children.length > 0 && (
        <ul className="ms-4 space-y-2 border-s border-sidebar-border pt-2">
          {node.children.map((child) => (
            <OrganizationDepartmentNode
              key={child.department?.id ?? child.kind}
              node={child}
              work={work}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// Agents shown as roots of the chart without a group header: the Home master (it is not
// "without a department", it is above them; the departments hang under it) and the top
// of a chain outside every department.
function PlainRoots({
  node,
  work,
}: {
  node: DepartmentNode;
  work: Map<number, 'running' | 'waiting'>;
}) {
  const t = useTranslations('organization');
  return (
    <>
      {node.agents.map((agent) => (
        <OrganizationAgentNode key={agent.agent.id} node={agent} work={work} />
      ))}
      {node.goals.length > 0 && (
        <li className="ms-4 mt-1 border-s border-sidebar-border ps-4">
          <p className="flex h-8 items-center text-xs font-medium text-muted-foreground">
            {t('tabs.goals')}
          </p>
          <ul className="space-y-1">
            {node.goals.map((goal) => (
              <OrganizationGoalNode key={goal.goal.id} node={goal} />
            ))}
          </ul>
        </li>
      )}
    </>
  );
}
