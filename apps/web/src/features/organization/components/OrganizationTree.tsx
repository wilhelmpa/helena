'use client';

import { Bot, Building2, Circle, Target } from 'lucide-react';
import type { Organization } from '@/lib/api/endpoints/organization';
import {
  buildOrganizationTree,
  type OrganizationAgentNode,
  type OrganizationDepartmentNode,
  type OrganizationGoalNode,
} from '../organizationTree';

const statusClass = {
  online: 'fill-emerald-500 text-emerald-500',
  degraded: 'fill-amber-500 text-amber-500',
  offline: 'fill-muted-foreground/40 text-muted-foreground/40',
};

function AgentNode({ node }: { node: OrganizationAgentNode }) {
  const { agent } = node;
  return (
    <li className="relative ps-5 before:absolute before:start-0 before:top-0 before:h-5 before:w-4 before:rounded-bl-md before:border-s before:border-b">
      <div className="rounded-md border bg-background p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-2">
            <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{agent.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {agent.roleTitle || `@${agent.username}`}
              </p>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Circle className={`size-2.5 ${statusClass[agent.runtimeState.status]}`} />
            {agent.runtimeState.adapter ?? agent.kind}
          </span>
        </div>
        {agent.projects.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {agent.projects.map((project) => (
              <span key={project.id} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                {project.key}
              </span>
            ))}
          </div>
        )}
        {agent.runtimeState.detail && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            {agent.runtimeState.detail}
          </p>
        )}
      </div>
      {node.reports.length > 0 && (
        <ul className="ms-3 border-s pt-3">
          {node.reports.map((report) => (
            <AgentNode key={report.agent.id} node={report} />
          ))}
        </ul>
      )}
    </li>
  );
}

function GoalNode({ node }: { node: OrganizationGoalNode }) {
  return (
    <li className="ps-4">
      <div className="flex items-center gap-2 text-sm">
        <Target className="size-3.5 text-muted-foreground" />
        <span>{node.goal.title}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {node.goal.status}
        </span>
      </div>
      {node.children.length > 0 && (
        <ul className="ms-2 space-y-2 border-s pt-2">
          {node.children.map((child) => (
            <GoalNode key={child.goal.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DepartmentNode({ node }: { node: OrganizationDepartmentNode }) {
  return (
    <li className="relative ps-6 before:absolute before:start-0 before:top-0 before:h-6 before:w-5 before:rounded-bl-md before:border-s before:border-b">
      <section className="rounded-lg border bg-muted/20 p-4">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          <h3 className="font-medium">{node.department?.name ?? 'Unassigned agents'}</h3>
        </div>
        {node.department?.description && (
          <p className="mt-1 text-xs text-muted-foreground">{node.department.description}</p>
        )}
        {node.agents.length > 0 && (
          <ul className="mt-4 space-y-3 border-s">
            {node.agents.map((agent) => (
              <AgentNode key={agent.agent.id} node={agent} />
            ))}
          </ul>
        )}
        {node.goals.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Goals</p>
            <ul className="space-y-2 border-s">
              {node.goals.map((goal) => (
                <GoalNode key={goal.goal.id} node={goal} />
              ))}
            </ul>
          </div>
        )}
      </section>
      {node.children.length > 0 && (
        <ul className="ms-4 space-y-4 border-s pt-4">
          {node.children.map((child) => (
            <DepartmentNode key={child.department?.id ?? 'unassigned'} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrganizationTree({ organization }: { organization: Organization }) {
  const tree = buildOrganizationTree(organization);
  if (tree.length === 0) {
    return <p className="text-sm text-muted-foreground">No organization structure yet.</p>;
  }
  return (
    <div className="min-w-[520px] overflow-x-auto pb-6">
      <ul className="space-y-5">
        {tree.map((node) => (
          <DepartmentNode key={node.department?.id ?? 'unassigned'} node={node} />
        ))}
      </ul>
    </div>
  );
}
