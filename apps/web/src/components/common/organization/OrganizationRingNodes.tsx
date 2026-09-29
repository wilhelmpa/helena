'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useLocale, useTranslations } from 'next-intl';
import BudgetBar from '@/components/helena/BudgetBar';
import { formatBudgetAmount } from '@/features/autopilot/utils/autopilotFormat';
import Orb from '@/components/helena/Orb';
import type { OrganizationDepartment } from '@/lib/api/endpoints/organization';
import { useChartAgentStatus, type ChartAgentData } from './OrganizationChartNode';
import type { RingGroup, RingTask } from './organizationRingLayout';

// Clicks on these nodes are handled by the chart (OrganizationChartFlow's onNodeClick),
// so a click and a double click can be told apart and a keyboard Enter on the button
// takes the same way.

// One invisible handle in the middle, so the ring's straight lines run from center to
// center and disappear under the opaque nodes.
function CenterHandles() {
  const style = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  const className = '!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent';
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={style}
        className={className}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={style}
        className={className}
        isConnectable={false}
      />
    </>
  );
}

export type RingHubNode = Node<
  Partial<ChartAgentData> & {
    count: number;
    accent?: string;
    department: OrganizationDepartment | null;
  },
  'hub'
>;

function HubAgentStatus({ data }: { data: ChartAgentData }) {
  const status = useChartAgentStatus(data);
  return <Orb state={status} size="small" />;
}

// The middle of the ring: Home, a department, a coordinator or a single agent, as a
// breathing orb.
export function OrganizationRingHub({ data }: NodeProps<RingHubNode>) {
  const t = useTranslations('organization.chart');
  const { agent, department, selected, count, accent } = data;
  const eyebrow = department
    ? t('department')
    : agent?.isHome
      ? t('master')
      : agent?.role === 'coordinator'
        ? t('coordinator')
        : agent?.role === 'reviewer'
          ? t('reviewer')
          : t('specialist');
  return (
    <div className="ds-ring-node ds-ring-hub-box">
      <CenterHandles />
      <button
        type="button"
        aria-pressed={agent ? Boolean(selected) : undefined}
        aria-label={agent?.name ?? department?.name}
        className="organization-ring-hub ds-ring-hub"
        style={{ ['--ring-accent' as string]: accent ?? 'var(--brand)' }}
      >
        {agent && data.signals ? <HubAgentStatus data={data as ChartAgentData} /> : null}
        <span className="ds-ring-eyebrow">{eyebrow}</span>
        <span className="ds-ring-hub-name">{agent?.name ?? department?.name}</span>
        <span className="ds-ring-meta">{t('agentCount', { count })}</span>
      </button>
    </div>
  );
}

export type RingGroupNode = Node<{ group: RingGroup; dimmed: boolean }, 'group'>;

// A department, or a project, on the inner ring. A click opens its own ring.
export function OrganizationRingGroup({ data }: NodeProps<RingGroupNode>) {
  const t = useTranslations('organization.chart');
  const locale = useLocale();
  const { group, dimmed } = data;
  return (
    <div className="ds-ring-node ds-ring-group-box" data-dimmed={dimmed || undefined}>
      <CenterHandles />
      <button
        type="button"
        aria-label={t('openLevel', { name: group.label })}
        title={t('openLevel', { name: group.label })}
        data-throttled={group.throttled ? 'true' : undefined}
        className="organization-ring-group ds-ring-group"
        style={{ ['--ring-accent' as string]: group.accent }}
      >
        {group.tag && <span className="ds-ring-eyebrow ds-ring-tag">{group.tag}</span>}
        <span className="ds-ring-group-name">{group.label}</span>
        <span className="ds-ring-meta">
          {group.budget
            ? formatBudgetAmount(group.budget.metric, group.budget.used, locale)
            : t('agentCount', { count: group.members.length })}
        </span>
        {group.budget && (
          <BudgetBar
            budget={group.budget}
            className="organization-ring-budget"
            label={t('budgetUsed', { percent: Math.round(group.budget.ratio * 100) })}
          />
        )}
      </button>
    </div>
  );
}

export type RingPillNode = Node<ChartAgentData & { accent: string; head: boolean }, 'pill'>;

// An agent on the outer ring.
export function OrganizationRingPill({ data }: NodeProps<RingPillNode>) {
  const t = useTranslations('organization.chart');
  const status = useChartAgentStatus(data);
  const { agent, selected, dimmed, head, accent } = data;
  const role = agent.isHome
    ? t('home')
    : agent.role === 'coordinator'
      ? t('coordinator')
      : agent.role === 'reviewer'
        ? t('reviewer')
        : null;
  return (
    <div
      className="ds-ring-node"
      data-dimmed={dimmed || undefined}
      data-selected={selected || undefined}
    >
      <CenterHandles />
      <button
        type="button"
        aria-pressed={selected}
        aria-label={agent.name}
        aria-keyshortcuts="Shift+Enter"
        className="organization-ring-pill ds-ring-pill"
        data-head={head || undefined}
        style={{ ['--ring-accent' as string]: accent }}
      >
        <Orb
          state={status}
          size="small"
          className={`organization-orb organization-orb-${status} ${agent.isHome ? 'organization-orb-home' : ''}`}
        />
        <span className="ds-ring-pill-text">
          {role && <span className="ds-ring-eyebrow">{role}</span>}
          <span className="ds-ring-pill-name">{agent.name}</span>
        </span>
      </button>
    </div>
  );
}

export type RingTaskNode = Node<{ task: RingTask; more: number; dimmed?: boolean }, 'task'>;

// A current task of an agent, on the outermost ring. A click opens it as a sheet.
export function OrganizationRingTask({ data }: NodeProps<RingTaskNode>) {
  const t = useTranslations('organization.chart');
  const { task, more, dimmed } = data;
  return (
    <div className="ds-ring-node" data-dimmed={dimmed || undefined}>
      <CenterHandles />
      <button
        type="button"
        title={`${task.identifier} · ${task.title}`}
        aria-label={t('openTask', { identifier: task.identifier, title: task.title })}
        className="organization-ring-task ds-ring-task"
        style={{ ['--ring-accent' as string]: task.color }}
      >
        <span aria-hidden="true" className="ds-ring-task-dot" />
        <span className="ds-ring-meta">{task.identifier}</span>
        <span className="ds-ring-task-title">{task.title}</span>
        {more > 0 && <span className="ds-ring-meta">+{more}</span>}
      </button>
    </div>
  );
}
