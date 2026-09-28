'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import Orb from '@/components/helena/Orb';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { useAgentStatus, type HelenaStatus } from '@/utils/helenaStatus';

export type ChartAgentNode = Node<
  {
    agent: OrganizationAgent;
    settings: AiAgent | null;
    trustLabel: string | null;
    state: HelenaStatus;
    decider: string | null;
    selected: boolean;
    reportCount: number;
    showCollapse: boolean;
    collapsed: boolean;
    onSelect: (id: number) => void;
    onToggle: (id: number) => void;
  },
  'agent'
>;

export default function OrganizationChartNode({ data }: NodeProps<ChartAgentNode>) {
  const t = useTranslations('organization.chart');
  const {
    agent,
    settings,
    trustLabel,
    state,
    decider,
    selected,
    reportCount,
    showCollapse,
    collapsed,
    onSelect,
    onToggle,
  } = data;
  const status = useAgentStatus(agent.id, {
    run: state === 'thinking' || state === 'tool' ? 'running' : state,
    tool: state === 'tool',
    runtimeStatus: agent.runtimeState.status,
  });
  const label = agent.isHome ? t('home') : agent.role === 'coordinator' ? t('coordinator') : agent.name;
  const model = settings?.model ?? t('standardModel');
  const reasoning = settings?.runtimePolicy.reasoningEffort ?? t('default');
  const trust = settings?.autopilotLevel;
  const leader = agent.isHome || agent.role === 'coordinator';
  const effectiveTrust =
    trustLabel ?? (trust == null ? t('projectDefault') : t('level', { level: trust }));
  const modelLine = [
    model,
    reasoning,
    agent.isHome ? t('allProjects') : agent.role === 'coordinator' ? effectiveTrust : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const statusColor = `var(--status-${status})`;
  return (
    <div
      className={`group relative rounded-[18px] border bg-[#111014] px-[18px] text-start shadow-[0_8px_22px_#0003] ${leader ? 'h-[92px] w-[280px] pt-2 pb-4' : 'h-[112px] w-[242px] pt-[14px] pb-4'} ${selected ? 'border-[#ae8bcf] ring-[3px] ring-[#ad8bd822]' : 'border-[#ffffff0f]'}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!border-0 !bg-transparent"
        isConnectable={false}
      />
      <button
        type="button"
        onClick={() => onSelect(agent.id)}
        className="w-full text-start focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-[#bdaaff]"
        aria-pressed={selected}
      >
        <span
          className="flex items-center gap-2 font-mono text-[10px] font-medium tracking-[.13em]"
          style={{ color: statusColor }}
        >
          <Orb
            state={status}
            size="small"
            className={`organization-orb organization-orb-${state} ${agent.isHome ? 'organization-orb-home' : ''}`}
          />
          {label}
        </span>
        <span
          className={`${leader ? 'mt-2' : 'mt-1'} block truncate text-[15px] font-medium text-[#eeeaf6]`}
          title={agent.name}
        >
          {agent.name}
        </span>
        <span
          className="mt-1 block truncate font-mono text-[11px] text-[#88808f]"
          title={modelLine}
        >
          {modelLine}
        </span>
        {!agent.isHome && agent.role !== 'coordinator' && (
          <span className="mt-1 block truncate text-[11px] text-[#96919f]">
            {t('decider')}: {decider ?? t('noDecider')} · {effectiveTrust}
          </span>
        )}
      </button>
      {showCollapse && reportCount > 0 && (
        <button
          type="button"
          onClick={() => onToggle(agent.id)}
          aria-label={t(collapsed ? 'expand' : 'collapse', { name: agent.name })}
          className="nodrag absolute end-3 top-3 rounded-full px-2 py-0.5 text-xs text-[#96919f] opacity-0 group-hover:opacity-100 hover:bg-[#26212d] hover:text-[#eeeaf6] focus-visible:opacity-100"
        >
          {collapsed ? '+' : '−'} {reportCount}
        </button>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!border-0 !bg-transparent"
        isConnectable={false}
      />
    </div>
  );
}
