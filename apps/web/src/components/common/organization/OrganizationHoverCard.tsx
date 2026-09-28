'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { OrganizationAgent, OrganizationDepartment } from '@/lib/api/endpoints/organization';
import type { HelenaStatus } from '@/utils/helenaStatus';
import type { ChartHover } from './OrganizationChartFlow';
import type { RingGroup, RingTask } from './organizationRingLayout';

const CARD_WIDTH = 260;

// The small info card next to a hovered (or keyboard-focused) node. It never takes a
// click: the node itself opens the settings, so the card shows what a glance needs and
// how to go on.
export default function OrganizationHoverCard({
  hover,
  agent,
  data,
  settings,
  status,
  trustLabel,
  decider,
  taskCount,
  showTasks,
}: {
  hover: ChartHover;
  agent: OrganizationAgent | null;
  data: Record<string, unknown>;
  settings: AiAgent | null;
  status: HelenaStatus | null;
  trustLabel: string | null;
  decider: string | null;
  taskCount: number;
  showTasks: boolean;
}) {
  const t = useTranslations('organization.chart');
  const tStatus = useTranslations('common.status');
  const { rect, width, height } = hover;
  const right = rect.left + rect.width + 12 + CARD_WIDTH <= width;
  const left = right
    ? rect.left + rect.width + 12
    : Math.max(8, Math.min(width - CARD_WIDTH - 8, rect.left - CARD_WIDTH - 12));
  const top = Math.max(8, Math.min(height - 180, rect.top));

  let body: ReactNode = null;
  if (hover.node.type === 'group') {
    const group = data.group as RingGroup;
    body = (
      <>
        <p className="truncate text-sm font-medium">{group.label}</p>
        <p className="text-xs text-muted-foreground">
          {t('agentCount', { count: group.members.length })}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('hintGroup')}</p>
      </>
    );
  } else if (hover.node.type === 'task') {
    const task = data.task as RingTask & { stateName?: string };
    body = (
      <>
        <p className="font-mono text-[10px] text-muted-foreground">{task.identifier}</p>
        <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
        {task.stateName && <p className="text-xs text-muted-foreground">{task.stateName}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">{t('hintTask')}</p>
      </>
    );
  } else if (agent) {
    const runtime = settings?.runtimePolicy.runtime ?? agent.runtimeState.adapter ?? 'hermes';
    const rows: [string, string][] = [
      [
        t('runtime'),
        runtime === 'hermes'
          ? 'Hermes'
          : runtime === 'claude'
            ? 'Claude Code'
            : runtime === 'codex'
              ? 'Codex'
              : runtime,
      ],
      [
        t('model'),
        [
          settings?.model ?? t('standardModel'),
          settings?.runtimePolicy.reasoningEffort ?? t('default'),
        ].join(' · '),
      ],
      [
        t('trust'),
        trustLabel ??
          (settings?.autopilotLevel == null
            ? t('projectDefault')
            : t('level', { level: settings.autopilotLevel })),
      ],
      [t('decider'), decider ?? t('noDecider')],
      [t('projects'), agent.projects.map((project) => project.key).join(' · ') || t('none')],
    ];
    if (showTasks) rows.push([t('tasks'), String(taskCount)]);
    body = (
      <>
        <p className="flex items-center gap-2 font-mono text-[10px] tracking-[.12em] text-muted-foreground">
          {status && <span>{tStatus(status).toUpperCase()}</span>}
        </p>
        <p className="truncate text-sm font-medium">{agent.name}</p>
        <dl className="mt-1 grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="m-0 truncate" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t('hintAgent')}</p>
      </>
    );
  } else {
    const department = data.department as OrganizationDepartment | null;
    if (!department) return null;
    body = (
      <>
        <p className="truncate text-sm font-medium">{department.name}</p>
        <p className="text-xs text-muted-foreground">
          {t('agentCount', { count: Number(data.count ?? 0) })}
        </p>
      </>
    );
  }
  return (
    <div
      role="tooltip"
      className="organization-hover-card pointer-events-none absolute z-20 hidden flex-col gap-0.5 rounded-xl bg-popover p-3 text-popover-foreground shadow-[0_0_0_1px_var(--border),0_12px_32px_color-mix(in_srgb,var(--foreground)_14%,transparent)] [@media(hover:hover)]:flex"
      style={{ left, top, width: CARD_WIDTH }}
    >
      {body}
    </div>
  );
}
