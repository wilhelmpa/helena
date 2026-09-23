import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ListTodo } from 'lucide-react';
import { tasksPath } from '@/utils/paths';
import { RowEmpty, RowList, SectionLabel } from '@/components/common/page/RowList';
import { useCrossProjectIssuesQuery } from '../../services/tasks.service';
import HomeTaskRow from '../HomeTaskRow';

const PREVIEW = { page: 1, pageSize: 5 };

// The open tasks assigned to the reader, soonest due first, with the way to the full
// list.
export default function HomeOpenTasks() {
  const t = useTranslations('workItems.allTasks');
  const query = useCrossProjectIssuesQuery(PREVIEW, { assignee: 'me', stateType: 'open' });
  const issues = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  if (query.isPending) return null;

  return (
    <section className="min-w-0">
      <SectionLabel
        trailing={
          <Link
            href={tasksPath()}
            className="rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('viewAll')}
          </Link>
        }
      >
        {t('myOpenTasks')} · <span className="font-mono tabular-nums">{total}</span>
      </SectionLabel>
      <RowList>
        {issues.length === 0 ? (
          <RowEmpty icon={<ListTodo />}>{t('noOpenTasks')}</RowEmpty>
        ) : (
          issues.map((issue) => <HomeTaskRow key={issue.id} issue={issue} />)
        )}
      </RowList>
    </section>
  );
}
