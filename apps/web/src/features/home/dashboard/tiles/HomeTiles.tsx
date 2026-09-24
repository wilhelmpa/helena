'use client';

import { useTranslations } from 'next-intl';
import { approvalsPath, globalAgentActivityPath, tasksPath } from '@/utils/paths';
import { dayKey, formatDurationShort, formatShortDate } from '@/utils/dates';
import { usePendingApprovalCount } from '@/services/approvals.service';
import { usePipelineApprovals } from '@/services/pipelines.service';
import { useProposalCount } from '@/features/agent-runtime/services/agentRuntime.service';
import { LIMITS_ADMIN_HREF } from '@/features/provider-limits/components/LimitAccountCard';
import { useAccountName } from '@/features/provider-limits/hooks/useAccountName';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { useProviderLimits } from '@/features/provider-limits/services/providerLimits.service';
import {
  BAR_CLASS,
  STATE_STATUS,
  barPercent,
  formatCountdown,
  orderedAccounts,
  windowLabel,
} from '@/features/provider-limits/utils/limitsFormat';
import type { LimitAccount } from '@/lib/api/endpoints/providerLimits';
import { useSystemHealthQuery } from '../../services/systemHealth.service';
import { FigureTile } from '../DashboardParts';
import { useAgentsNow } from '../sections/AgentsSection';
import { useMyOpenTasks } from '../sections/TasksSection';
import { openSystemDetails } from '../systemDetails';
import { systemSummary } from '../systemSummary';
import { useHomeDashboardContext } from '../useHomeDashboard';
import { useNeedsYou } from '../useNeedsYou';

// The built-in figure tiles of Start. Each counts what its section or page lists, from the
// same read, so a figure and its list never disagree.

// "Warten auf dich": approvals, workflow approval steps and proposals waiting for a
// decision. The sub-line names what is red first: problems of the system, then failures.
export function WaitingTile() {
  const t = useTranslations('home');
  const { owner, dismissed } = useHomeDashboardContext();
  const approvals = usePendingApprovalCount();
  const steps = usePipelineApprovals();
  const proposals = useProposalCount();
  const needs = useNeedsYou(dismissed, owner);
  const decisions =
    approvals.data == null
      ? null
      : approvals.data.count + (steps.data?.length ?? 0) + (proposals.data?.count ?? 0);
  const red = needs.problems > 0 || needs.failures > 0;
  return (
    <FigureTile
      href={approvalsPath()}
      label={t('widgets.waiting')}
      value={decisions}
      status={red ? 'danger' : (decisions ?? 0) > 0 ? 'waiting' : undefined}
      subTone={red ? 'danger' : 'default'}
      sub={
        needs.problems > 0
          ? t('figures.problems', { count: needs.problems })
          : needs.failures > 0
            ? t('figures.failed', { count: needs.failures })
            : decisions === 0
              ? t('figures.nothingWaits')
              : ''
      }
    />
  );
}

// "Agenten arbeiten": the agents working now, and who.
export function AgentsTile() {
  const t = useTranslations('home');
  const { running, finished, isPending } = useAgentsNow();
  const names = [...new Set(running.map((entry) => entry.agent!.name))];
  const last = finished[0];
  return (
    <FigureTile
      href={globalAgentActivityPath()}
      label={t('widgets.agents')}
      value={isPending ? null : names.length}
      status={names.length > 0 ? 'running' : undefined}
      sub={
        names.length > 0
          ? names.join(', ')
          : last
            ? t('figures.lastFinished', { time: formatDurationShort(last.at) })
            : t('figures.nobodyWorks')
      }
    />
  );
}

// "Meine Aufgaben": the reader's open tasks; how many are overdue, or when the next is due.
export function TasksTile() {
  const t = useTranslations('home');
  const query = useMyOpenTasks();
  const now = useNow(60_000);
  const today = now === null ? null : dayKey(new Date(now).toISOString());
  const items = query.data?.items ?? [];
  const overdue = today ? items.filter((issue) => issue.dueDate && issue.dueDate < today) : [];
  const next = today ? items.find((issue) => issue.dueDate && issue.dueDate >= today) : undefined;
  return (
    <FigureTile
      href={`${tasksPath()}?assignee=me`}
      label={t('widgets.tasks')}
      value={query.isPending ? null : (query.data?.total ?? 0)}
      subTone={overdue.length > 0 ? 'danger' : 'default'}
      sub={
        overdue.length > 0
          ? t('figures.overdue', { count: overdue.length })
          : next?.dueDate
            ? t('figures.nextDue', { date: formatShortDate(next.dueDate) })
            : ''
      }
    />
  );
}

// One plan limit: the fullest window's share with its bar, and when that window resets.
function LimitTile({ account, now }: { account: LimitAccount; now: number }) {
  const t = useTranslations('providerLimits');
  const name = useAccountName();
  const fullest = [...account.windows].sort((a, b) => barPercent(b) - barPercent(a))[0];
  const label = fullest ? windowLabel(fullest) : null;
  const reset = fullest?.resetsAt ? Date.parse(fullest.resetsAt) : null;
  const percent = fullest ? Math.round(barPercent(fullest)) : null;
  return (
    <FigureTile
      href={LIMITS_ADMIN_HREF}
      label={[name.provider(account), name.plan(account)].filter(Boolean).join(' · ')}
      value={percent === null ? '–' : `${percent} %`}
      status={account.state === 'ok' ? undefined : STATE_STATUS[account.state]}
      progress={
        fullest ? { percent: barPercent(fullest), className: BAR_CLASS[fullest.state] } : null
      }
      subTone={account.stale ? 'waiting' : 'default'}
      sub={
        account.stale
          ? t('staleSince', { time: formatDurationShort(account.observedAt) })
          : fullest && label
            ? [
                t(`window.${label.key}`, label.values),
                reset && reset > now ? t('resetsIn', { time: formatCountdown(reset - now) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : t('noWindows')
      }
    />
  );
}

// The plan limits, one tile per subscription (Claude, ChatGPT …), the tightest first. For
// the Administrator.
export function LimitsTiles() {
  const t = useTranslations('home');
  const limits = useProviderLimits(true);
  const now = useNow();
  if (!limits.data || now === null)
    return <FigureTile href={LIMITS_ADMIN_HREF} label={t('widgets.limits')} value={null} />;
  return (
    <>
      {orderedAccounts(limits.data.accounts).map((account) => (
        <LimitTile key={account.id} account={account} now={now} />
      ))}
    </>
  );
}

// "System": whether everything runs, in words, with the counts under it; opens the full
// health overview. For the Administrator.
export function SystemTile() {
  const t = useTranslations('home.system');
  const health = useSystemHealthQuery(true);
  const summary = health.data ? systemSummary(health.data) : null;
  return (
    <FigureTile
      onSelect={openSystemDetails}
      label={t('title')}
      status={summary?.status}
      value={
        !summary
          ? null
          : summary.problems.length === 0
            ? t('ok')
            : t('problems', { count: summary.problems.length })
      }
      subTone={
        summary?.status === 'danger'
          ? 'danger'
          : summary?.status === 'waiting'
            ? 'waiting'
            : 'default'
      }
      sub={
        summary
          ? t('summary', {
              services: `${summary.services.ok}/${summary.services.total}`,
              agents: `${summary.agents.synced}/${summary.agents.total}`,
            })
          : ''
      }
    />
  );
}
