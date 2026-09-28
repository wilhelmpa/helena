'use client';

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Organization } from '@/lib/api/endpoints/organization';
import { listAgentActivity } from '@/lib/api/endpoints/agentActivity';
import { listDecisionLog } from '@/lib/api/endpoints/decisions';
import { getProjectAutopilot } from '@/lib/api/endpoints/autopilot';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { qk } from '@/services/queryKeys';
import OrganizationAgentDetails from './OrganizationAgentDetails';
import OrganizationChartNode, { type ChartAgentNode } from './OrganizationChartNode';
import { organizationChartAgents } from './organizationChartAgents';
import { organizationChartLayout } from './organizationChartLayout';
import { organizationChartState } from './organizationChartState';
import { useOrganizationToolStates } from './useOrganizationToolStates';

const nodeTypes = { agent: OrganizationChartNode };

export default function OrganizationChart({
  organization,
  projectId,
  onEdit,
}: {
  organization: Organization;
  projectId?: number;
  onEdit: (id: number) => void;
}) {
  const t = useTranslations('organization.chart');
  const tNav = useTranslations('nav');
  const project = organization.projects.find((item) => item.id === projectId);
  const agentsQuery = useAiAgentsQuery(organization.teamId);
  const trustProjects = organization.projects.filter((item) =>
    projectId == null
      ? organization.agents.some((agent) =>
          agent.projects.some((project) => project.id === item.id),
        )
      : item.id === projectId,
  );
  const trustQueries = useQueries({
    queries: trustProjects.map((item) => ({
      queryKey: qk.projectAutopilot(item.key),
      queryFn: () => getProjectAutopilot(item.key),
    })),
  });
  const decisions = useQuery({
    queryKey: ['decisions', organization.teamId, 'chart-log'],
    queryFn: () => listDecisionLog(organization.teamId, { limit: 100 }),
  });
  const activity = useQuery({
    queryKey: qk.agentActivity(project?.key ?? null, { window: 100 }),
    queryFn: () => listAgentActivity(project?.key ?? null, { limit: 100 }, null),
    refetchInterval: 15_000,
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const agents = useMemo(
    () => organizationChartAgents(organization.agents, projectId),
    [organization.agents, projectId],
  );
  const byId = useMemo(
    () => new Map((agentsQuery.data ?? []).map((agent) => [agent.id, agent])),
    [agentsQuery.data],
  );
  const specialists = agents
    .filter((agent) => !agent.isHome && agent.role !== 'coordinator')
    .sort((a, b) => a.name.localeCompare(b.name));
  const selected =
    agents.find((agent) => agent.id === selectedId) ??
    specialists[Math.floor(specialists.length / 2)] ??
    agents.find((agent) => !agent.isHome) ??
    agents[0];
  const eyebrow =
    `${project?.name ?? tNav('sidebarHome')} · ${tNav('sidebarAutomation')}`.toUpperCase();
  const eyebrowColor = project?.key.toUpperCase().startsWith('VERVE')
    ? '#f0997b'
    : project
      ? '#7ee0b8'
      : '#bdaaff';
  const entries = useMemo(() => activity.data?.items ?? [], [activity.data]);
  const usingTools = useOrganizationToolStates(organization.teamId, entries);
  const delegating = useMemo(
    () =>
      new Set(
        entries
          .filter(
            (entry) =>
              entry.trigger === 'delegation' &&
              ['pending', 'running', 'streaming'].includes(entry.status) &&
              entry.agent,
          )
          .map((entry) => entry.agent!.id),
      ),
    [entries],
  );
  const deciderByAgent = useMemo(() => {
    const result = new Map<number, string>();
    for (const item of decisions.data?.items ?? []) {
      if (item.agentId != null && !result.has(item.agentId) && (item.backend || item.model))
        result.set(item.agentId, item.backend ?? item.model!);
    }
    return result;
  }, [decisions.data]);
  const trustByAgent = new Map<number, Set<number>>();
  for (const query of trustQueries) {
    for (const entry of query.data?.agents ?? []) {
      const levels = trustByAgent.get(entry.id) ?? new Set<number>();
      levels.add(entry.effective.level);
      trustByAgent.set(entry.id, levels);
    }
  }
  const layout = useMemo(
    () => organizationChartLayout(agents, collapsed, delegating),
    [agents, collapsed, delegating],
  );
  const nodes: ChartAgentNode[] = layout.nodes.map((node) => {
    const agent = node.data.agent as (typeof agents)[number];
    const levels = trustByAgent.get(agent.id);
    return {
      ...node,
      type: 'agent',
      data: {
        agent,
        settings: byId.get(agent.id) ?? null,
        trustLabel:
          levels?.size === 1
            ? t('level', { level: [...levels][0]! })
            : levels && levels.size > 1
              ? t('projectDependent')
              : null,
        decider: deciderByAgent.get(agent.id) ?? null,
        state: organizationChartState(agent, entries, usingTools.has(agent.id)),
        selected: selected?.id === agent.id,
        reportCount: node.data.reportCount as number,
        showCollapse: projectId == null,
        collapsed: collapsed.has(agent.id),
        onSelect: setSelectedId,
        onToggle: (id: number) =>
          setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
      },
    };
  });
  if (agents.length === 0)
    return <p className="rounded-[18px] bg-[#111014] p-6 text-sm text-[#96919f]">{t('empty')}</p>;
  return (
    <div
      className={`min-w-0 xl:ps-7 xl:pe-4 ${projectId == null ? '' : 'project-organization-chart pt-[6px]'}`}
    >
      <div className="flex min-w-0 flex-col gap-7 xl:flex-row">
        <section
          className={`flex min-h-[720px] min-w-0 flex-1 flex-col ${projectId == null ? 'h-[calc(100vh-80px)]' : 'h-[calc(100vh-48px)]'}`}
          aria-label={t('home')}
        >
          <header className={projectId == null ? 'mb-[34px]' : 'mb-[29px]'}>
            <p
              className="mb-[10px] font-mono text-[10px] font-medium tracking-[.23em]"
              style={{ color: eyebrowColor }}
            >
              {eyebrow}
            </p>
            <h1 className="text-[38px] leading-[1.04] font-[520] tracking-[-.05em] text-[#eeeaf6]">
              {tNav('sidebarTeamDeciders')}
            </h1>
          </header>
          <div className="h-[360px] overflow-hidden">
            <ReactFlow
              nodes={nodes}
              edges={layout.edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              fitView
              fitViewOptions={{ padding: 0, maxZoom: 1 }}
              minZoom={0.05}
              maxZoom={1.5}
              colorMode="dark"
              style={{ background: 'transparent' }}
              proOptions={{ hideAttribution: true }}
            >
              {projectId == null && <Controls showInteractive={false} position="top-left" />}
            </ReactFlow>
          </div>
          {delegating.size > 0 && (
            <p className="mt-auto font-mono text-[10px] tracking-[.09em] text-[#6f687a]">
              {t('delegation', {
                agents: agents
                  .filter((agent) => delegating.has(agent.id))
                  .map((agent) => agent.name)
                  .join(' · '),
              })}
            </p>
          )}
        </section>
        {selected && (
          <OrganizationAgentDetails
            agent={selected}
            settings={byId.get(selected.id) ?? null}
            teamId={organization.teamId}
            projectId={projectId}
            onEdit={onEdit}
          />
        )}
      </div>
    </div>
  );
}
