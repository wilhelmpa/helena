import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { tasksPath } from '@/utils/paths';
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
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {t('myOpenTasks')} · {total}
        </h2>
        <Link href={tasksPath()} className="text-xs text-muted-foreground hover:text-foreground">
          {t('viewAll')}
        </Link>
      </div>
      {issues.length === 0 ? (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          {t('noOpenTasks')}
        </p>
      ) : (
        <div className="rounded-lg border bg-card p-1">
          {issues.map((issue) => (
            <HomeTaskRow key={issue.id} issue={issue} />
          ))}
        </div>
      )}
    </section>
  );
}
