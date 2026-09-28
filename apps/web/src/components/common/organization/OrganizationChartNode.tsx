'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import Orb from '@/components/helena/Orb';
import BudgetBar, { fullestBudget } from '@/components/helena/BudgetBar';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { useAgentStatus, type StatusSignals } from '@/utils/helenaStatus';

// What every chart node of an agent carries, in the tree and in the ring.
export interface ChartAgentData extends Record<string, unknown> {
  agent: OrganizationAgent;
  settings: AiAgent | null;
  trustLabel: string | null;
  signals: StatusSignals;
  decider: string | null;
  selected: boolean;
  dimmed: boolean;
  reportCount: number;
  showCollapse: boolean;
  collapsed: boolean;
  onToggle: (id: number) => void;
}

export type ChartAgentNode = Node<ChartAgentData, 'agent'>;

// The shared status of a chart agent: the Orb's state from the same signals the rest
// of Helena uses (ui-system.md §1).
export function useChartAgentStatus(data: ChartAgentData) {
  return useAgentStatus(data.agent.id, data.signals);
}

const handle = '!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent';

export default function OrganizationChartNode({ data }: NodeProps<ChartAgentNode>) {
  const t = useTranslations('organization.chart');
  const {
    agent,
    settings,
    trustLabel,
    decider,
    selected,
    dimmed,
    reportCount,
    showCollapse,
    collapsed,
    onToggle,
  } = data;
  const status = useChartAgentStatus(data);
  const budget = fullestBudget(agent.budgets);
  const label = agent.isHome
    ? t('home')
    : agent.role === 'coordinator'
      ? t('coordinator')
      : agent.role === 'reviewer'
        ? t('reviewer')
        : t('specialist');
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
  const statusWord =
    status === 'thinking' ||
    status === 'tool' ||
    status === 'waiting' ||
    status === 'error' ||
    status === 'throttled' ||
    status === 'offline'
      ? t(status)
      : null;
  return (
    <div
      data-selected={selected || undefined}
      data-throttled={agent.throttled && !selected ? 'true' : undefined}
      className={`organization-card group relative rounded-[18px] border bg-card px-[18px] text-start text-card-foreground shadow-[0_8px_22px_color-mix(in_srgb,var(--foreground)_6%,transparent)] transition-[opacity,border-color,box-shadow] duration-200 ${leader ? 'h-[92px] w-[280px] pt-2 pb-4' : 'h-[112px] w-[242px] pt-[14px] pb-4'} ${selected ? 'border-brand ring-[3px] ring-brand/20' : 'border-border hover:border-muted-foreground/40'} ${dimmed ? 'opacity-30' : ''}`}
    >
      <Handle type="target" position={Position.Top} className={handle} isConnectable={false} />
      <Handle
        id="side"
        type="target"
        position={Position.Left}
        className={handle}
        isConnectable={false}
      />
      {/* The click reaches the chart (onNodeClick), which tells a click (settings) from a
          double click (the agent's own ring). */}
      <button
        type="button"
        aria-keyshortcuts="Shift+Enter"
        className="w-full cursor-pointer text-start focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-brand"
        aria-pressed={selected}
        aria-label={agent.name}
      >
        <span className="flex items-center gap-2 font-mono text-[10px] font-medium tracking-[.13em] text-muted-foreground">
          <HeartbeatRing agent={agent}>
            <Orb
              state={status}
              size="small"
              className={`organization-orb organization-orb-${status} ${agent.isHome ? 'organization-orb-home' : ''}`}
            />
          </HeartbeatRing>
          <span className="truncate">
            {label}
            {agent.throttled ? ` · ${t('throttled')}` : statusWord ? ` · ${statusWord}` : ''}
          </span>
        </span>
        <span
          className={`${leader ? 'mt-2' : 'mt-1'} block truncate text-[15px] font-medium`}
          title={agent.name}
        >
          {agent.name}
        </span>
        <span
          className="mt-1 block truncate font-mono text-[11px] text-muted-foreground"
          title={modelLine}
        >
          {modelLine}
        </span>
        {!leader && (
          <span className="mt-1 block truncate text-[11px] text-muted-foreground">
            {t('decider')}: {decider ?? t('noDecider')} · {effectiveTrust}
          </span>
        )}
        {budget && (
          <BudgetBar
            budget={budget}
            className="organization-budget"
            label={t('budgetUsed', { percent: Math.round(budget.ratio * 100) })}
          />
        )}
      </button>
      {showCollapse && reportCount > 0 && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(agent.id);
          }}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'expand' : 'collapse', { name: agent.name })}
          className={`nodrag absolute end-3 top-2 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100 ${collapsed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          {collapsed ? '+' : '−'} {reportCount}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className={handle} isConnectable={false} />
      <Handle
        id="rail"
        type="source"
        position={Position.Bottom}
        className={handle}
        style={{ left: 20 }}
        isConnectable={false}
      />
    </div>
  );
}

// The heartbeat ring (hub/pc-heartbeats): around the orb of an agent with a heartbeat, a
// thin ring that fills from its last beat to its next.
function HeartbeatRing({ agent, children }: { agent: OrganizationAgent; children: ReactNode }) {
  if (!agent.heartbeatIntervalMinutes) return <>{children}</>;
  const last = agent.heartbeatLastAt ? Date.parse(agent.heartbeatLastAt) : null;
  const next = agent.heartbeatNextAt ? Date.parse(agent.heartbeatNextAt) : null;
  // eslint-disable-next-line react-hooks/purity -- a snapshot is enough; it moves on each refetch
  const now = Date.now();
  const beat = last != null && next != null && next > last ? (now - last) / (next - last) : 0;
  return (
    <span
      className="ds-heartbeat-ring"
      // The beat is due (or overdue): the ring swings out until the next run starts.
      data-due={next != null && next <= now ? 'true' : undefined}
      style={{ '--beat': Math.max(0, Math.min(1, beat)) } as CSSProperties}
    >
      {children}
    </span>
  );
}
