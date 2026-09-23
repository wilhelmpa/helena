'use client';

import Link from 'next/link';
import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import { AgentTemplateBadge } from '@/components/common/agent-chat/AgentTemplateBadge';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { agentsPath } from '@/utils/paths';
import {
  organizationAgentRole,
  type OrganizationAgentNode as AgentNode,
} from '../organizationTree';

const RUNTIME_STATUS: Record<'online' | 'degraded' | 'offline', Status> = {
  online: 'success',
  degraded: 'waiting',
  offline: 'idle',
};

// One agent in the organization chart: a sidebar-style row joined to its manager by the
// tree line — name, role, what it can do and where it works on one line, its runtime on
// the right. The row opens the agent's settings sheet on the agents page
// (/agents?agent=<id>), where everything shown here is edited; its reports hang under it.
export default function OrganizationAgentNode({ node }: { node: AgentNode }) {
  const t = useTranslations('organization');
  const { agent } = node;
  const role = organizationAgentRole(agent);
  const detail = [
    agent.roleTitle || `@${agent.username}`,
    agent.capabilities.length > 0 ? agent.capabilities.join(' · ') : null,
  ]
    .filter(Boolean)
    .join(' — ');

  return (
    <li className="relative ps-4 before:absolute before:start-0 before:top-0 before:h-4 before:w-3 before:rounded-es-md before:border-s before:border-b before:border-sidebar-border">
      <Link
        href={`${agentsPath()}?${new URLSearchParams({ agent: String(agent.id) })}`}
        className="group flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
      >
        <Bot className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        <span className="shrink-0 truncate font-medium">{agent.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{t(`roles.${role}`)}</span>
        <AgentPausedBadge agent={agent} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground max-sm:hidden">
          {detail}
        </span>
        {agent.projects.length > 0 && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground max-md:hidden">
            {agent.projects.map((project) => project.key).join(' ')}
          </span>
        )}
        {agent.template ? (
          // A pool template runs nowhere by design — its own runtimeState.status
          // defaults to 'offline' the same as an agent whose runner actually dropped,
          // which is exactly the mix-up this badge exists to avoid.
          <AgentTemplateBadge />
        ) : (
          <span className="ms-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <StatusBadge status={RUNTIME_STATUS[agent.runtimeState.status]} dotOnly />
            {agent.runtimeState.adapter ?? agent.kind}
          </span>
        )}
      </Link>
      {agent.runtimeState.detail && (
        <p className="ps-8 text-xs text-status-waiting">{agent.runtimeState.detail}</p>
      )}
      {node.reports.length > 0 && (
        <ul className="ms-4 border-s border-sidebar-border">
          {node.reports.map((report) => (
            <OrganizationAgentNode key={report.agent.id} node={report} />
          ))}
        </ul>
      )}
    </li>
  );
}
