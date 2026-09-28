import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { Initiative, InitiativeSort } from '@/lib/api/endpoints/initiatives';
import type { InitiativesTab } from '@/utils/paths';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { cn } from '@/lib/utils';
import InitiativeRow, { INITIATIVE_COLUMN_CLASS } from './InitiativeRow';

// Columns in table order. A `sort` key marks the column as sortable; progress and
// health are derived per row and cannot be sorted server-side. `width` is the
// column's share on a wide screen; a phone keeps the name and the progress.
type ColumnKey = 'name' | 'priority' | 'owner' | 'target' | 'progress' | 'health';

const COLUMNS: { key: ColumnKey; sort?: InitiativeSort; width: string }[] = [
  { key: 'name', sort: 'title', width: 'md:w-[34%]' },
  { key: 'priority', sort: 'priority', width: 'w-[10%]' },
  { key: 'owner', sort: 'owner', width: 'w-[22%]' },
  { key: 'target', sort: 'targetDate', width: 'w-[12%]' },
  { key: 'progress', width: 'w-28 md:w-[12%]' },
  { key: 'health', width: 'w-[10%]' },
];

export default function InitiativesList({
  initiatives,
  project,
  isLoading,
  statusTab,
  sort,
  dir,
  onSort,
}: {
  initiatives: Initiative[];
  project: ProjectDetail;
  isLoading: boolean;
  // The open status tab, absent on the tab that lists every status. An empty
  // status tab is a filtered view, not a first run, so it says so.
  statusTab: Exclude<InitiativesTab, 'all'> | undefined;
  sort: InitiativeSort | undefined;
  dir: 'asc' | 'desc' | undefined;
  onSort: (key: InitiativeSort) => void;
}) {
  const t = useTranslations('initiatives');
  const ownerById = new Map(project.assignees.map((a) => [a.userId, a]));

  if (isLoading) return <ListSkeleton className="p-4" rowClassName="h-10" />;

  if (initiatives.length === 0) {
    if (statusTab)
      return (
        <EmptyState title={t(`emptyTab.${statusTab}`)} description={t('emptyTabDescription')} />
      );
    // "Neues Ziel" is the toolbar's primary action, so the empty state does not
    // repeat it.
    return <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />;
  }

  return (
    <div className="min-w-0 p-4">
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table className="table-fixed">
          <colgroup>
            {COLUMNS.map((col) => (
              <col
                key={col.key}
                className={cn(
                  col.width,
                  INITIATIVE_COLUMN_CLASS[col.key]?.replace('table-cell', 'table-column'),
                )}
              />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    'px-3 text-xs font-normal text-muted-foreground',
                    INITIATIVE_COLUMN_CLASS[col.key],
                  )}
                >
                  {col.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.sort!)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {t(`columns.${col.key}`)}
                      {sort === col.sort &&
                        (dir === 'desc' ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronUp className="size-3.5" />
                        ))}
                    </button>
                  ) : (
                    t(`columns.${col.key}`)
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {initiatives.map((it) => (
              <InitiativeRow
                key={it.id}
                initiative={it}
                projectKey={project.project.key}
                owner={it.ownerUserId ? (ownerById.get(it.ownerUserId) ?? null) : null}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
