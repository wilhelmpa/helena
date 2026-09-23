'use client';

import { Bot, Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import {
  organizationAgentRole,
  type OrganizationAgentNode as AgentNode,
} from '../organizationTree';

const statusClass = {
  online: 'fill-emerald-500 text-emerald-500',
  degraded: 'fill-amber-500 text-amber-500',
  offline: 'fill-muted-foreground/40 text-muted-foreground/40',
};

export default function OrganizationAgentNode({ node }: { node: AgentNode }) {
  const t = useTranslations('organization');
  const { agent } = node;
  const role = organizationAgentRole(agent);

  return (
    <li className="relative ps-5 before:absolute before:start-0 before:top-0 before:h-5 before:w-4 before:rounded-bl-md before:border-s before:border-b">
      <div className="rounded-md border bg-background p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-2">
            <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-medium">{agent.name}</p>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t(`roles.${role}`)}
                </span>
                <AgentPausedBadge agent={agent} />
              </div>
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
        {agent.capabilities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {agent.capabilities.map((capability) => (
              <span
                key={capability}
                className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {capability}
              </span>
            ))}
          </div>
        )}
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
        // space-y-3 matches the sibling gap OrganizationDepartmentNode already uses for
        // a department's own (flat) agent list — the one spacing step already in use
        // for "cards of the same kind, one under another" anywhere in this tree, kept
        // here so every level (Home's coordinators, a coordinator's specialists) reads
        // the same. No dedicated spacing token exists in this branch's base yet
        // (hub/helena-design, not merged here, is where that is meant to land); this
        // is the plain Tailwind step to swap for that token once it exists.
        <ul className="ms-3 space-y-3 border-s pt-3">
          {node.reports.map((report) => (
            <OrganizationAgentNode key={report.agent.id} node={report} />
          ))}
        </ul>
      )}
    </li>
  );
}
