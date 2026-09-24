'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RowList, SectionLabel } from '@/components/common/page/RowList';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { approvalsPath, globalAgentActivityPath, tasksPath } from '@/utils/paths';
import { cn } from '@/lib/utils';
import { LIMITS_ADMIN_HREF } from '@/features/provider-limits/components/LimitAccountCard';
import { useAccountName } from '@/features/provider-limits/hooks/useAccountName';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { useProviderLimits } from '@/features/provider-limits/services/providerLimits.service';
import {
  BAR_CLASS,
  barPercent,
  formatCountdown,
  orderedAccounts,
  windowLabel,
} from '@/features/provider-limits/utils/limitsFormat';
import type { LimitAccount } from '@/lib/api/endpoints/providerLimits';
import { dayKey } from '@/utils/dates';
import { useSystemHealthQuery } from '../../services/systemHealth.service';
import HomeSystemHealth from '../../components/home/HomeSystemHealth';
import { CardLink } from '../DashboardCard';
import NeedsYouRows from '../cards/NeedsYouRows';
import AgentsNowRows, { useAgentsNow } from '../cards/AgentsNowRows';
import MyTaskRows, { useMyOpenTasks } from '../cards/MyTaskRows';
import ScheduleRows from '../cards/ScheduleRows';
import ProjectRows from '../cards/ProjectRows';
import { FigureTile, useHomeFigures } from '../cards/Figures';
import { systemSummary } from '../systemSummary';
import { useNeedsYou } from '../useNeedsYou';
import { Greeting, useDismissedPreview, useIsOwner } from './shared';

// A plan limit as a figure: the fullest window's share, its bar, and when it resets.
function LimitTile({ account, now }: { account: LimitAccount; now: number }) {
  const t = useTranslations('providerLimits');
  const name = useAccountName();
  const fullest = [...account.windows].sort((a, b) => barPercent(b) - barPercent(a))[0];
  const label = fullest ? windowLabel(fullest) : null;
  const reset = fullest?.resetsAt ? Date.parse(fullest.resetsAt) : null;
  return (
    <FigureTile
      href={LIMITS_ADMIN_HREF}
      label={[name.provider(account), name.plan(account)].filter(Boolean).join(' · ')}
      value={fullest ? `${Math.round(barPercent(fullest))} %` : '–'}
      meta={
        fullest && label
          ? [
              t(`window.${label.key}`, label.values),
              reset && reset > now ? t('resetsIn', { time: formatCountdown(reset - now) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
    >
      {fullest && (
        <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className={cn('block h-full rounded-full', BAR_CLASS[fullest.state])}
            style={{ width: `${barPercent(fullest)}%` }}
          />
        </span>
      )}
    </FigureTile>
  );
}

// The system as a figure: its state in words, the counts under it; opens the overview.
function SystemTile() {
  const t = useTranslations('home.system');
  const [open, setOpen] = useState(false);
  const health = useSystemHealthQuery(true);
  const summary = health.data ? systemSummary(health.data) : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-col gap-1 rounded-lg border border-sidebar-border bg-card px-3 py-2.5 text-start transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
      >
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('title')}
          {summary && <StatusBadge status={summary.status} dotOnly className="ms-auto" />}
        </span>
        <span className="truncate text-xl font-semibold">
          {!summary
            ? '–'
            : summary.problems.length === 0
              ? t('ok')
              : t('problems', { count: summary.problems.length })}
        </span>
        <span className="truncate text-xs text-muted-foreground tabular-nums">
          {summary
            ? t('summary', {
                services: `${summary.services.ok}/${summary.services.total}`,
                agents: `${summary.agents.synced}/${summary.agents.total}`,
                logins: `${summary.logins.ok}/${summary.logins.total}`,
              })
            : ''}
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
        >
          <DialogTitle>{t('title')}</DialogTitle>
          <HomeSystemHealth />
        </DialogContent>
      </Dialog>
    </>
  );
}

// A group inside the "Heute" frame: the sidebar's 12px label, then its rows.
function TodayGroup({
  label,
  count,
  trailing,
  children,
}: {
  label: ReactNode;
  count?: number | null;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-px">
      <SectionLabel
        as="h3"
        trailing={
          <span className="flex items-center gap-1">
            {count ? <span className="font-mono tabular-nums">{count}</span> : null}
            {trailing}
          </span>
        }
      >
        {label}
      </SectionLabel>
      {children}
    </div>
  );
}

// Direction C, "Kennzahlen und Heute": one row of figures at the top — what waits, who
// works, the owner's tasks, every plan limit and the system, each a tile that opens its
// details — and below them one frame "Heute" that lists what to do and what happens, in
// the order it matters, in two columns on a wide screen. The projects close the page.
export default function DesignC() {
  const t = useTranslations('home');
  const tNav = useTranslations('nav');
  const owner = useIsOwner();
  const [dismissed, dismiss] = useDismissedPreview();
  const needs = useNeedsYou(dismissed);
  const figures = useHomeFigures();
  const agents = useAgentsNow();
  const tasks = useMyOpenTasks(8);
  const limits = useProviderLimits(owner);
  const now = useNow();
  const today = now === null ? null : dayKey(new Date(now).toISOString());
  const overdue =
    today === null
      ? 0
      : (tasks.data?.items ?? []).filter((issue) => issue.dueDate && issue.dueDate < today).length;

  return (
    <div className="@container flex w-full flex-col gap-4 p-4">
      <Greeting className="px-1" />
      <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-3 @5xl:grid-cols-6">
        <FigureTile
          href={approvalsPath()}
          label={t('figures.decisions')}
          value={figures.decisions}
          status={(figures.decisions ?? 0) > 0 ? 'waiting' : undefined}
          meta={needs.failures > 0 ? `${needs.failures} ${t('needsYou.failed')}` : ' '}
        />
        <FigureTile
          href={globalAgentActivityPath()}
          label={t('figures.running')}
          value={figures.running}
          status={(figures.running ?? 0) > 0 ? 'running' : undefined}
          meta={agents.entries[0]?.agent?.name ?? ' '}
        />
        <FigureTile
          href={`${tasksPath()}?assignee=me`}
          label={t('figures.tasks')}
          value={figures.openTasks}
          meta={overdue > 0 ? `${overdue} ${t('tasks.overdue')}` : ' '}
        />
        {owner &&
          limits.data &&
          now !== null &&
          orderedAccounts(limits.data.accounts).map((account) => (
            <LimitTile key={account.id} account={account} now={now} />
          ))}
        {owner && <SystemTile />}
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
        <RowList className="bg-card">
          <TodayGroup
            label={t('needsYou.title')}
            count={needs.items.length}
            trailing={<CardLink href={approvalsPath()}>{tNav('approvals')}</CardLink>}
          >
            <NeedsYouRows data={needs} limit={5} onDismiss={dismiss} />
          </TodayGroup>
          <TodayGroup
            label={t('today.running')}
            count={agents.entries.length}
            trailing={<CardLink href={globalAgentActivityPath()}>{t('all')}</CardLink>}
          >
            <AgentsNowRows limit={4} />
          </TodayGroup>
        </RowList>
        <RowList className="bg-card">
          <TodayGroup
            label={t('today.due')}
            count={figures.openTasks}
            trailing={<CardLink href={`${tasksPath()}?assignee=me`}>{t('all')}</CardLink>}
          >
            <MyTaskRows limit={6} />
          </TodayGroup>
          <TodayGroup label={t('today.next')}>
            <ScheduleRows limit={3} />
          </TodayGroup>
        </RowList>
      </div>

      <section className="min-w-0">
        <SectionLabel>{t('projects.title')}</SectionLabel>
        <ProjectRows tiles />
      </section>
    </div>
  );
}
