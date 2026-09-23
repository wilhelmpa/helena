import { useTranslations } from 'next-intl';
import type { StateType } from '@/lib/api/endpoints/columns';
import type { CrossProjectIssueFilters } from '@/lib/api/endpoints/issues';
import type { Project } from '@/lib/api/endpoints/projects';
import { STATE_TYPES } from '@/utils/fieldOptions';
import { byKey } from '@/utils/messageKey';
import SearchInput from '@/components/common/SearchInput';
import DisplaySettingsSelect from '@/components/layout/DisplaySettingsSelect';

export type HomeTaskGrouping = 'project' | 'state';

// What a select shows when its filter is off: Radix gives an empty value no item.
const ANY = 'any';

// The filters above the Home task list, and how the list is grouped.
export default function HomeTasksFilters({
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
  onFiltersChange: (filters: CrossProjectIssueFilters) => void;
  search: string;
  onSearchChange: (search: string) => void;
  grouping: HomeTaskGrouping;
  onGroupingChange: (grouping: HomeTaskGrouping) => void;
}) {
  const t = useTranslations('workItems.allTasks');
  const stateType = byKey(useTranslations('display.stateTypes'));
  const set = (patch: CrossProjectIssueFilters) => onFiltersChange({ ...filters, ...patch });
  const orAny = (value: string) => (value === ANY ? undefined : value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder={t('searchPlaceholder')}
        className="w-full sm:w-64"
      />
      <DisplaySettingsSelect
        value={filters.projectKey ?? ANY}
        onChange={(v) => set({ projectKey: orAny(v) })}
        options={[
          { value: ANY, label: t('allProjects') },
          ...projects.map((p) => ({ value: p.key, label: p.name })),
        ]}
      />
      <DisplaySettingsSelect
        value={filters.stateType ?? ANY}
        onChange={(v) => set({ stateType: orAny(v) as 'open' | StateType | undefined })}
        options={[
          { value: 'open', label: t('state.open') },
          { value: ANY, label: t('state.any') },
          ...STATE_TYPES.map((s) => ({ value: s, label: stateType(s) })),
        ]}
      />
      <DisplaySettingsSelect
        value={filters.assignee ?? ANY}
        onChange={(v) => set({ assignee: orAny(v) })}
        options={[
          { value: ANY, label: t('assignee.any') },
          { value: 'me', label: t('assignee.me') },
          { value: 'agents', label: t('assignee.agents') },
          { value: 'unassigned', label: t('assignee.unassigned') },
        ]}
      />
      <DisplaySettingsSelect
        value={filters.due ?? ANY}
        onChange={(v) => set({ due: orAny(v) as 'overdue' | 'week' | undefined })}
        options={[
          { value: ANY, label: t('due.any') },
          { value: 'overdue', label: t('due.overdue') },
          { value: 'week', label: t('due.week') },
        ]}
      />
      <DisplaySettingsSelect
        value={grouping}
        onChange={(v) => onGroupingChange(v as HomeTaskGrouping)}
        options={[
          { value: 'project', label: t('groupBy.project') },
          { value: 'state', label: t('groupBy.state') },
        ]}
      />
    </div>
  );
}
