'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { getAgentAutopilot } from '@/lib/api/endpoints/autopilot';
import { listDecisionLog } from '@/lib/api/endpoints/decisions';
import { listMemberRoutines } from '@/lib/api/endpoints/routines';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { qk } from '@/services/queryKeys';

export default function OrganizationAgentDetails({
  agent,
  settings,
  teamId,
  projectId,
  onEdit,
}: {
  agent: OrganizationAgent;
  settings: AiAgent | null;
  teamId: number;
  projectId?: number;
  onEdit: (id: number) => void;
}) {
  const t = useTranslations('organization.chart');
  const autopilot = useQuery({
    queryKey: qk.agentAutopilot(teamId, agent.id),
    queryFn: () => getAgentAutopilot(teamId, agent.id),
  });
  const decisions = useQuery({
    queryKey: ['decisions', teamId, 'chart-log', agent.id],
    queryFn: () => listDecisionLog(teamId, { agentId: agent.id, limit: 3 }),
  });
  const routines = useQuery({
    queryKey: [...qk.anyRoutines, 'chart-all'],
    queryFn: async () => {
      const items = [];
      for (let page = 1; ; page++) {
        const result = await listMemberRoutines({ page, pageSize: 100 });
        items.push(...result.items);
        if (items.length >= result.total || result.items.length === 0) return items;
      }
    },
  });
  const recent = decisions.data?.items ?? [];
  const schedules = (routines.data ?? []).filter((item) => item.agent?.id === agent.id);
  const budget = autopilot.data?.budgets
    .map((item) => `${item.limit} ${item.metric}/${item.period}`)
    .join(' · ');
  const last = recent[0];
  const effectiveLevels = autopilot.data?.projects
    .filter((project) => projectId == null || project.id === projectId)
    .map((project) => project.effective.level);
  const trustLevels = [...new Set(effectiveLevels ?? [])];
  const trustLabel = autopilot.data
    ? trustLevels.length === 1
      ? t('level', { level: trustLevels[0]! })
      : trustLevels.length > 1
        ? t('projectDependent')
        : autopilot.data.agentLevel == null
          ? t('projectDefault')
          : t('level', { level: autopilot.data.agentLevel })
    : '—';
  const runtime = settings?.runtimePolicy.runtime ?? agent.runtimeState.adapter ?? 'hermes';
  const fields = [
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
    [t('model'), settings?.model ?? t('standardModel')],
    [t('reasoning'), settings?.runtimePolicy.reasoningEffort ?? t('default')],
    [t('decider'), last?.backend ?? last?.model ?? t('noDecider')],
    [t('threshold'), last ? String(last.threshold) : '—'],
    [t('trust'), trustLabel],
    [
      t('budget'),
      budget ||
        [
          agent.dailyTokenCeiling != null
            ? t('tokensDay', { count: agent.dailyTokenCeiling })
            : null,
          agent.monthlyTokenCeiling != null
            ? t('tokensMonth', { count: agent.monthlyTokenCeiling })
            : null,
        ]
          .filter(Boolean)
          .join(' · ') ||
        t('noLimit'),
    ],
    [
      t('schedules'),
      routines.isPending || routines.isError
        ? '—'
        : schedules.length
          ? schedules.map((item) => item.title).join(' · ')
          : t('none'),
    ],
    [t('projects'), agent.projects.map((project) => project.name).join(' · ') || t('none')],
  ];
  return (
    <aside
      className={`flex min-h-[720px] w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-[22px] bg-[#0c0b0f] p-[22px] text-[#eeeaf6] shadow-[0_0_0_1px_#ffffff0c,0_18px_40px_#0005] xl:w-[330px] ${projectId == null ? 'xl:h-[calc(100vh-80px)]' : 'xl:mt-[3px] xl:h-[calc(100vh-48px)]'}`}
      aria-label={`${t('settings')}: ${agent.name}`}
    >
      <span className="font-mono text-[10px] font-medium tracking-[.23em] text-[#6f687a]">
        {t('settings')}
      </span>
      <h2 className="text-2xl font-medium tracking-[-.04em]">{agent.name}</h2>
      <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-3 text-[13px]">
        {fields.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[#88808f]">{label}</dt>
            <dd className="m-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <span className="mt-2 font-mono text-[10px] font-medium tracking-[.23em] text-[#6f687a]">
        {t('recent')}
      </span>
      {recent.length ? (
        recent.map((item) => (
          <div
            key={item.id}
            className="flex justify-between gap-2 rounded-xl bg-[#111014] px-3 py-2.5 text-xs"
          >
            <span
              className="min-w-0 truncate text-[#cfc6da]"
              title={item.question ?? item.subject ?? item.classId}
            >
              {item.question ?? item.subject ?? item.classId}
            </span>
            <span className="font-mono text-[#7ee0b8]">
              {item.confidence == null ? '—' : item.confidence.toFixed(2)}
            </span>
          </div>
        ))
      ) : (
        <p className="text-xs text-[#88808f]">{t('noneDecisions')}</p>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => onEdit(agent.id)}
        className="min-h-11 rounded-full border border-[#ffffff12] bg-[#141217] px-4 text-xs font-medium text-[#cfc6da] hover:bg-[#26212d]"
      >
        {t('editAll')}
      </button>
    </aside>
  );
}
