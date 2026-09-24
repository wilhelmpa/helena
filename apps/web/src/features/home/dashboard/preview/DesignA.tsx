'use client';

import { useTranslations } from 'next-intl';
import { Activity, Bot, CalendarClock, FolderKanban, Gauge, Inbox, ListTodo } from 'lucide-react';
import { approvalsPath, globalAgentActivityPath, schedulesPath, tasksPath } from '@/utils/paths';
import { LIMITS_ADMIN_HREF } from '@/features/provider-limits/components/LimitAccountCard';
import DashboardCard from '../DashboardCard';
import NeedsYouRows from '../cards/NeedsYouRows';
import AgentsNowRows, { useAgentsNow } from '../cards/AgentsNowRows';
import MyTaskRows from '../cards/MyTaskRows';
import LimitsBody, { LimitsRefresh } from '../cards/LimitsBody';
import SystemRows from '../cards/SystemRows';
import ScheduleRows from '../cards/ScheduleRows';
import ProjectRows from '../cards/ProjectRows';
import { FigureTile, useHomeFigures } from '../cards/Figures';
import { useNeedsYou } from '../useNeedsYou';
import { Greeting, useDismissedPreview, useIsOwner } from './shared';

// Direction A, "Raster": a bento grid. Four figures on top, then every topic in a card of
// its own on a 12-column grid (3 columns wide, 2 on a tablet, 1 on a phone), the cards of
// a row equally tall; what needs the owner sits top left.
export default function DesignA() {
  const t = useTranslations('home');
  const tNav = useTranslations('nav');
  const owner = useIsOwner();
  const [dismissed, dismiss] = useDismissedPreview();
  const needs = useNeedsYou(dismissed);
  const figures = useHomeFigures();
  const agents = useAgentsNow();

  return (
    <div className="@container flex w-full flex-col gap-4 p-4">
      <Greeting className="px-1" />
      <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <FigureTile
          href={approvalsPath()}
          label={t('figures.decisions')}
          value={figures.decisions}
          status={(figures.decisions ?? 0) > 0 ? 'waiting' : undefined}
        />
        <FigureTile
          href={globalAgentActivityPath()}
          label={t('figures.running')}
          value={figures.running}
          status={(figures.running ?? 0) > 0 ? 'running' : undefined}
        />
        <FigureTile
          href={`${tasksPath()}?assignee=me`}
          label={t('figures.tasks')}
          value={figures.openTasks}
        />
        <FigureTile
          href={globalAgentActivityPath()}
          label={t('figures.failures')}
          value={needs.isPending ? null : needs.failures}
          status={needs.failures > 0 ? 'danger' : undefined}
        />
      </div>

      <div className="grid grid-flow-row-dense grid-cols-1 gap-4 @2xl:grid-cols-6 @5xl:grid-cols-12">
        <DashboardCard
          className="@2xl:col-span-6 @5xl:col-span-8"
          icon={<Inbox />}
          title={t('needsYou.title')}
          count={needs.items.length || null}
          href={approvalsPath()}
          hrefLabel={tNav('approvals')}
        >
          <NeedsYouRows data={needs} limit={5} onDismiss={dismiss} />
        </DashboardCard>
        <DashboardCard
          className="@2xl:col-span-3 @5xl:col-span-4"
          icon={<Bot />}
          title={t('agents.title')}
          count={agents.entries.length || null}
          href={globalAgentActivityPath()}
          hrefLabel={t('all')}
        >
          <AgentsNowRows limit={5} recent={3} />
        </DashboardCard>
        <DashboardCard
          className="@2xl:col-span-6 @5xl:col-span-8"
          icon={<ListTodo />}
          title={t('tasks.title')}
          count={figures.openTasks || null}
          href={`${tasksPath()}?assignee=me`}
          hrefLabel={t('all')}
        >
          <MyTaskRows limit={6} />
        </DashboardCard>
        {owner && (
          <DashboardCard
            className="@2xl:col-span-3 @5xl:col-span-4"
            icon={<Gauge />}
            title={t('limits.title')}
            actions={<LimitsRefresh />}
            href={LIMITS_ADMIN_HREF}
            hrefLabel={t('all')}
          >
            <LimitsBody />
          </DashboardCard>
        )}
        {owner && (
          <DashboardCard
            className="@2xl:col-span-3 @5xl:col-span-4"
            icon={<Activity />}
            title={t('system.title')}
          >
            <SystemRows />
          </DashboardCard>
        )}
        <DashboardCard
          className="@2xl:col-span-3 @5xl:col-span-4"
          icon={<CalendarClock />}
          title={t('schedules.title')}
          href={schedulesPath()}
          hrefLabel={t('all')}
        >
          <ScheduleRows limit={4} />
        </DashboardCard>
        <DashboardCard
          className="@2xl:col-span-3 @5xl:col-span-4"
          icon={<FolderKanban />}
          title={t('projects.title')}
        >
          <ProjectRows />
        </DashboardCard>
      </div>
    </div>
  );
}
