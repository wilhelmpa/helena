import { CalendarClock, CircleDot, FolderKanban, Rows3, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { StateType } from '@/lib/api/endpoints/columns';
import type { CrossProjectIssueFilters } from '@/lib/api/endpoints/issues';
import type { Project } from '@/lib/api/endpoints/projects';
import { STATE_TYPES } from '@/utils/fieldOptions';
import { byKey } from '@/utils/messageKey';
import {
  PageSearch,
  PageSelect,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import { PageFilterMenu } from '@/features/home/components/toolbar/PageFilterMenu';

export type HomeTaskGrouping = 'project' | 'state';

// What a filter holds when it is off.
const ANY = 'any';

// The Home task list's controls, in the header row like every page's: the search, the
// four filters behind one "Filter" menu (project, state, assignee, due) and the
// grouping.
export default function HomeTasksToolbar({
  projects,
  filters,
  onFiltersChange,
  search,
  onSearchChange,
  grouping,
  onGroupingChange,
}: {
  projects: Project[];
  filters: CrossProjectIssueFilters;
  onFiltersChange: (patch: CrossProjectIssueFilters) => void;
  search: string;
  onSearchChange: (search: string) => void;
  grouping: HomeTaskGrouping;
  onGroupingChange: (grouping: HomeTaskGrouping) => void;
}) {
  const t = useTranslations('workItems.allTasks');
  const stateType = byKey(useTranslations('display.stateTypes'));

  return (
    <PageToolbar>
      <PageToolbarSpacer />
      <PageSearch value={search} onChange={onSearchChange} placeholder={t('searchPlaceholder')} />
      <PageFilterMenu
        label={t('filter.title')}
        resetLabel={t('filter.reset')}
        onReset={() =>
          onFiltersChange({
            projectKey: undefined,
            stateType: 'open',
            assignee: undefined,
            due: undefined,
          })
        }
        filters={[
          {
            id: 'project',
            label: t('filter.project'),
            icon: FolderKanban,
            value: filters.projectKey ?? ANY,
            defaultValue: ANY,
            onChange: (value) => onFiltersChange({ projectKey: value === ANY ? undefined : value }),
            options: [
              { value: ANY, label: t('allProjects') },
              ...projects.map((project) => ({ value: project.key, label: project.name })),
            ],
          },
          {
            id: 'state',
            label: t('filter.state'),
            icon: CircleDot,
            value: filters.stateType ?? ANY,
            defaultValue: 'open',
            onChange: (value) =>
              onFiltersChange({
                stateType: value === ANY ? undefined : (value as 'open' | StateType),
              }),
            options: [
              { value: 'open', label: t('state.open') },
              { value: ANY, label: t('state.any') },
              ...STATE_TYPES.map((type) => ({ value: type, label: stateType(type) })),
            ],
          },
          {
            id: 'assignee',
            label: t('filter.assignee'),
            icon: UserRound,
            value: filters.assignee ?? ANY,
            defaultValue: ANY,
            onChange: (value) => onFiltersChange({ assignee: value === ANY ? undefined : value }),
            options: [
              { value: ANY, label: t('assignee.any') },
              { value: 'me', label: t('assignee.me') },
              { value: 'agents', label: t('assignee.agents') },
              { value: 'unassigned', label: t('assignee.unassigned') },
            ],
          },
          {
            id: 'due',
            label: t('filter.due'),
            icon: CalendarClock,
            value: filters.due ?? ANY,
            defaultValue: ANY,
            onChange: (value) =>
              onFiltersChange({ due: value === ANY ? undefined : (value as 'overdue' | 'week') }),
            options: [
              { value: ANY, label: t('due.any') },
              { value: 'overdue', label: t('due.overdue') },
              { value: 'week', label: t('due.week') },
            ],
          },
        ]}
      />
      <PageSelect
        label={t('filter.group')}
        icon={Rows3}
        value={grouping}
        onChange={onGroupingChange}
        options={[
          { value: 'project', label: t('groupBy.project') },
          { value: 'state', label: t('groupBy.state') },
        ]}
      />
    </PageToolbar>
  );
}
