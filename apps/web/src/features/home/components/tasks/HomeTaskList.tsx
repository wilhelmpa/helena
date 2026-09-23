import { useTranslations } from 'next-intl';
import type { CrossProjectIssue } from '@/lib/api/endpoints/issues';
import { STATE_TYPES } from '@/utils/fieldOptions';
import { byKey } from '@/utils/messageKey';
import HomeTaskRow from '../HomeTaskRow';
import type { HomeTaskGrouping } from './HomeTasksFilters';

interface TaskGroup {
  key: string;
  name: string;
  issues: CrossProjectIssue[];
}

// The tasks of one page, grouped by project in the order the list reaches them, or
// by state type in workflow order.
function groupTasks(
  issues: CrossProjectIssue[],
  grouping: HomeTaskGrouping,
  stateLabel: (stateType: string) => string,
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const issue of issues) {
    const key = grouping === 'project' ? issue.projectKey : issue.stateType;
    let group = groups.get(key);
    if (!group) {
      const name =
        grouping === 'project' ? `${issue.projectName} (${issue.projectKey})` : stateLabel(key);
      groups.set(key, (group = { key, name, issues: [] }));
    }
    group.issues.push(issue);
  }
  const list = [...groups.values()];
  if (grouping === 'state')
    list.sort(
      (a, b) =>
        STATE_TYPES.indexOf(a.key as (typeof STATE_TYPES)[number]) -
        STATE_TYPES.indexOf(b.key as (typeof STATE_TYPES)[number]),
    );
  return list;
}

export default function HomeTaskList({
  issues,
  grouping,
}: {
  issues: CrossProjectIssue[];
  grouping: HomeTaskGrouping;
}) {
  const stateLabel = byKey(useTranslations('display.stateTypes'));
  return (
    <div className="space-y-4">
      {groupTasks(issues, grouping, stateLabel).map((group) => (
        <section key={group.key}>
          <h2 className="mb-1 px-2 text-xs font-medium text-muted-foreground">
            {group.name} · {group.issues.length}
          </h2>
          <div className="rounded-lg border bg-card p-1">
            {group.issues.map((issue) => (
              <HomeTaskRow key={issue.id} issue={issue} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
