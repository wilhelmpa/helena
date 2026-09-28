'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useTranslations } from 'next-intl';
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
  return <Orb state={status} size="small" className="mb-0.5" />;
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
    <div className="relative size-[136px]">
      <CenterHandles />
      <button
        type="button"
        aria-pressed={agent ? Boolean(selected) : undefined}
        aria-label={agent?.name ?? department?.name}
        className={`organization-ring-hub flex size-full cursor-pointer flex-col items-center justify-center gap-1 rounded-full border bg-card text-card-foreground focus-visible:outline-2 focus-visible:outline-brand ${selected ? 'border-brand ring-[3px] ring-brand/25' : ''}`}
        style={
          selected
            ? undefined
            : { borderColor: `color-mix(in srgb, ${accent ?? 'var(--brand)'} 60%, transparent)` }
        }
      >
        {agent && data.signals ? <HubAgentStatus data={data as ChartAgentData} /> : null}
        <span
          className="font-mono text-[9px] font-medium tracking-[.18em]"
          style={{ color: accent ?? 'var(--brand)' }}
        >
          {eyebrow}
        </span>
        <span className="line-clamp-2 max-w-[116px] px-2 text-center text-[17px] leading-tight font-medium tracking-[-.03em]">
          {agent?.name ?? department?.name}
        </span>
        <span className="font-mono text-[9px] tracking-[.08em] text-muted-foreground">
          {t('agentCount', { count })}
        </span>
      </button>
    </div>
  );
}

export type RingGroupNode = Node<{ group: RingGroup; dimmed: boolean }, 'group'>;

// A department, or a project, on the inner ring. A click opens its own ring.
export function OrganizationRingGroup({ data }: NodeProps<RingGroupNode>) {
  const t = useTranslations('organization.chart');
  const { group, dimmed } = data;
  return (
    <div
      className={`relative size-[112px] transition-opacity duration-200 ${dimmed ? 'opacity-30' : ''}`}
    >
      <CenterHandles />
      <button
        type="button"
        aria-label={t('openLevel', { name: group.label })}
        title={t('openLevel', { name: group.label })}
        className="organization-ring-group flex size-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full border bg-card px-2 text-center text-card-foreground transition-transform duration-200 hover:scale-[1.04] focus-visible:outline-2 focus-visible:outline-brand motion-reduce:transition-none motion-reduce:hover:scale-100"
        style={{
          borderColor: `color-mix(in srgb, ${group.accent} 55%, transparent)`,
          boxShadow: `0 0 28px color-mix(in srgb, ${group.accent} 16%, transparent)`,
        }}
      >
        {group.tag && (
          <span
            className="max-w-[96px] truncate font-mono text-[8px] font-medium tracking-[.14em] uppercase"
            style={{ color: group.accent }}
          >
            {group.tag}
          </span>
        )}
        <span className="line-clamp-2 max-w-[96px] text-xs leading-tight font-medium">
          {group.label}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">
          {t('agentCount', { count: group.members.length })}
        </span>
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
      className={`relative transition-opacity duration-200 ${dimmed ? 'opacity-30' : ''}`}
      data-selected={selected || undefined}
    >
      <CenterHandles />
      <button
        type="button"
        aria-pressed={selected}
        aria-label={agent.name}
        aria-keyshortcuts="Shift+Enter"
        className={`organization-ring-pill flex h-[34px] max-w-[220px] min-w-[112px] cursor-pointer items-center gap-2 rounded-full border bg-card ps-3 pe-3.5 text-start text-card-foreground transition-[border-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-brand ${selected ? 'border-brand ring-[3px] ring-brand/20' : 'border-border hover:border-muted-foreground/50'}`}
        style={
          head && !selected
            ? { borderColor: `color-mix(in srgb, ${accent} 45%, transparent)` }
            : undefined
        }
      >
        <Orb
          state={status}
          size="small"
          className={`organization-orb organization-orb-${status} ${agent.isHome ? 'organization-orb-home' : ''}`}
        />
        <span className="flex min-w-0 flex-col leading-none">
          {role && (
            <span
              className="truncate font-mono text-[8px] font-medium tracking-[.13em]"
              style={{ color: accent }}
            >
              {role}
            </span>
          )}
          <span className={`truncate text-xs ${head ? 'font-medium' : ''} ${role ? 'mt-0.5' : ''}`}>
            {agent.name}
          </span>
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
    <div className={`relative transition-opacity duration-200 ${dimmed ? 'opacity-30' : ''}`}>
      <CenterHandles />
      <button
        type="button"
        title={`${task.identifier} · ${task.title}`}
        aria-label={t('openTask', { identifier: task.identifier, title: task.title })}
        className="organization-ring-task flex h-[26px] max-w-[190px] min-w-[76px] cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card/90 ps-2 pe-2.5 text-start text-card-foreground hover:border-muted-foreground/50 focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: task.color, boxShadow: `0 0 6px ${task.color}` }}
        />
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {task.identifier}
        </span>
        <span className="truncate text-[11px]">{task.title}</span>
        {more > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">+{more}</span>
        )}
      </button>
    </div>
  );
}
