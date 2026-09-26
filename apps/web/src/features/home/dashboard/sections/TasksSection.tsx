'use client';

import { useTranslations } from 'next-intl';
import { ListTodo } from 'lucide-react';
import { RowEmpty } from '@/components/common/page/RowList';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { dayKey } from '@/utils/dates';
import { tasksPath } from '@/utils/paths';
import DashboardTaskRow from './DashboardTaskRow';
import { DashboardSection, SkeletonRows } from '../DashboardParts';
import { useCrossProjectIssuesQuery } from '../../services/tasks.service';

const PAGE = { page: 1, pageSize: 20 };
const FILTERS = { assignee: 'me', stateType: 'open' } as const;
const SHOWN = 6;

// The reader's open tasks, soonest due first: one read for the section and the tile.
export function useMyOpenTasks() {
  return useCrossProjectIssuesQuery(PAGE, FILTERS);
}

// "Meine Aufgaben": the reader's open tasks, with the way to all of them.
export default function TasksSection() {
  const t = useTranslations('home');
  const query = useMyOpenTasks();
  const now = useNow(60_000);
  const today = now === null ? null : dayKey(new Date(now).toISOString());
  const issues = query.data?.items ?? [];
  return (
    <DashboardSection
      label={t('widgets.my-tasks')}
      count={query.data?.total}
      href={`${tasksPath()}?assignee=me`}
      hrefLabel={t('links.all')}
    >
      {query.isPending ? (
        <SkeletonRows count={SHOWN} />
      ) : issues.length === 0 ? (
        <RowEmpty icon={<ListTodo />}>{t('tasks.empty')}</RowEmpty>
      ) : (
        issues
          .slice(0, SHOWN)
          .map((issue) => <DashboardTaskRow key={issue.id} issue={issue} today={today} />)
      )}
    </DashboardSection>
  );
}
