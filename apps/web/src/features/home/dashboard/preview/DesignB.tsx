'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Bot, CircleCheck, ListTodo } from 'lucide-react';
import { RowList, SectionLabel } from '@/components/common/page/RowList';
import { approvalsPath, globalAgentActivityPath, schedulesPath, tasksPath } from '@/utils/paths';
import { LIMITS_ADMIN_HREF } from '@/features/provider-limits/components/LimitAccountCard';
import { CardLink } from '../DashboardCard';
import NeedsYouRows from '../cards/NeedsYouRows';
import AgentsNowRows, { useAgentsNow } from '../cards/AgentsNowRows';
import MyTaskRows from '../cards/MyTaskRows';
import LimitsBody, { LimitsRefresh } from '../cards/LimitsBody';
import SystemRows from '../cards/SystemRows';
import ScheduleRows from '../cards/ScheduleRows';
import ProjectRows from '../cards/ProjectRows';
import { FigureRow, useHomeFigures } from '../cards/Figures';
import { useNeedsYou } from '../useNeedsYou';
import { Greeting, useDismissedPreview, useIsOwner } from './shared';

// A group as the sidebar draws one: the 12px label above, the rows in a hairline frame.
function Group({
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
    <section className="min-w-0">
      <SectionLabel
        trailing={
          <span className="flex items-center gap-1">
            {count ? <span className="font-mono tabular-nums">{count}</span> : null}
            {trailing}
          </span>
        }
      >
        {label}
      </SectionLabel>
      <RowList className="bg-card">{children}</RowList>
    </section>
  );
}

// Direction B, "Liste und Leiste": the page reads like the sidebar. On the left the work,
// top to bottom (what needs the owner, who works, the owner's tasks); on the right a
// narrow rail with the state of things (figures, limits, system, what runs next, the
// projects). Under 900px the rail follows the work.
export default function DesignB() {
  const t = useTranslations('home');
  const tNav = useTranslations('nav');
  const owner = useIsOwner();
  const [dismissed, dismiss] = useDismissedPreview();
  const needs = useNeedsYou(dismissed);
  const figures = useHomeFigures();
  const agents = useAgentsNow();

  return (
    <div className="@container w-full p-4">
      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Greeting className="px-2" />
          <Group
            label={t('needsYou.title')}
            count={needs.items.length}
            trailing={<CardLink href={approvalsPath()}>{tNav('approvals')}</CardLink>}
          >
            <NeedsYouRows data={needs} limit={6} onDismiss={dismiss} twoLine />
          </Group>
          <Group
            label={t('agents.title')}
            count={agents.entries.length}
            trailing={<CardLink href={globalAgentActivityPath()}>{t('all')}</CardLink>}
          >
            <AgentsNowRows limit={6} recent={3} />
          </Group>
          <Group
            label={t('tasks.title')}
            count={figures.openTasks}
            trailing={<CardLink href={`${tasksPath()}?assignee=me`}>{t('all')}</CardLink>}
          >
            <MyTaskRows limit={8} />
          </Group>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 @4xl:pt-14">
          <Group label={t('figures.title')}>
            <FigureRow
              href={approvalsPath()}
              icon={<CircleCheck />}
              label={t('figures.decisions')}
              value={figures.decisions}
              status={(figures.decisions ?? 0) > 0 ? 'waiting' : undefined}
            />
            <FigureRow
              href={globalAgentActivityPath()}
              icon={<Bot />}
              label={t('figures.running')}
              value={figures.running}
              status={(figures.running ?? 0) > 0 ? 'running' : undefined}
            />
            <FigureRow
              href={`${tasksPath()}?assignee=me`}
              icon={<ListTodo />}
              label={t('figures.tasks')}
              value={figures.openTasks}
            />
            <FigureRow
              href={globalAgentActivityPath()}
              icon={<AlertTriangle />}
              label={t('figures.failures')}
              value={needs.isPending ? null : needs.failures}
              status={needs.failures > 0 ? 'danger' : undefined}
            />
          </Group>
          {owner && (
            <Group
              label={t('limits.title')}
              trailing={
                <>
                  <LimitsRefresh />
                  <CardLink href={LIMITS_ADMIN_HREF}>{t('all')}</CardLink>
                </>
              }
            >
              <LimitsBody />
            </Group>
          )}
          {owner && (
            <Group label={t('system.title')}>
              <SystemRows compact />
            </Group>
          )}
          <Group
            label={t('schedules.title')}
            trailing={<CardLink href={schedulesPath()}>{t('all')}</CardLink>}
          >
            <ScheduleRows limit={4} />
          </Group>
          <Group label={t('projects.title')}>
            <ProjectRows />
          </Group>
        </aside>
      </div>
    </div>
  );
}
