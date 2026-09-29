'use client';

import Link from 'next/link';
import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import { AgentTemplateBadge } from '@/components/common/agent-chat/AgentTemplateBadge';
import Orb from '@/components/helena/Orb';
import { useAgentStatus } from '@/utils/helenaStatus';
import { teamListPath, teamOrganizationPath } from '@/utils/paths';
import {
  organizationAgentRole,
  type OrganizationAgentNode as AgentNode,
} from '../organizationTree';
import OrganizationDepartmentNode from './OrganizationDepartmentNode';
import { Box, Text } from '@/design-system';

// One agent in the organization chart: a sidebar-style row joined to its manager by the
// tree line — name, role, what it can do and where it works on one line, its runtime on
// the right. The row opens the agent's settings sheet on the agents page
// (/agents?agent=<id>), where everything shown here is edited; its reports hang under it.
export default function OrganizationAgentNode({
  node,
  work,
}: {
  node: AgentNode;
  work: Map<number, 'running' | 'waiting'>;
}) {
  const t = useTranslations('organization');
  const { agent } = node;
  const status = useAgentStatus(agent.id, {
    run: work.get(agent.id),
    runtimeStatus: agent.runtimeState.status,
  });
  const role = organizationAgentRole(agent);
  const detail = [
    agent.roleTitle || `@${agent.username}`,
    agent.capabilities.length > 0 ? agent.capabilities.join(' · ') : null,
  ]
    .filter(Boolean)
    .join(' — ');

  return (
    <Box
      as="li"
      padStart={4}
      className="relative before:absolute before:start-0 before:top-0 before:h-4 before:w-3 before:rounded-es-md before:border-s before:border-b before:border-sidebar-border"
    >
      <Link
        href={teamListPath(teamOrganizationPath(), `agent=${agent.id}`)}
        className="group flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
      >
        <Bot className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        {!agent.template && <Orb state={status} />}
        <span className="min-w-0 shrink truncate font-medium">{agent.name}</span>
        <Text as="span" size="xs" tone="muted" className="shrink-0 max-sm:hidden">
          {t(`roles.${role}`)}
        </Text>
        <AgentPausedBadge agent={agent} />
        <Text as="span" size="xs" tone="muted" className="min-w-0 flex-1 truncate max-sm:hidden">
          {detail}
        </Text>
        {agent.projects.length > 0 && (
          <Text as="span" size="xs" tone="muted" className="shrink-0 font-mono max-md:hidden">
            {agent.projects.map((project) => project.key).join(' ')}
          </Text>
        )}
        {agent.template ? (
          // A pool template runs nowhere by design — its own runtimeState.status
          // defaults to 'offline' the same as an agent whose runner actually dropped,
          // which is exactly the mix-up this badge exists to avoid.
          <AgentTemplateBadge />
        ) : (
          <Text as="span" size="xs" tone="muted" className="ms-auto hidden shrink-0 sm:inline">
            {agent.runtimeState.adapter ?? agent.kind}
          </Text>
        )}
      </Link>
      {(node.reports.length > 0 || (node.departments?.length ?? 0) > 0) && (
        <ul className="ms-4 border-s border-sidebar-border">
          {/* Home only: its departments first, then the reports that belong to none. */}
          {node.departments?.map((department) => (
            <OrganizationDepartmentNode
              key={department.department?.id ?? department.kind}
              node={department}
              work={work}
            />
          ))}
          {node.reports.map((report) => (
            <OrganizationAgentNode key={report.agent.id} node={report} work={work} />
          ))}
        </ul>
      )}
    </Box>
  );
}
