import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { Initiative } from '@/lib/api/endpoints/initiatives';
import type { InitiativesTab } from '@/utils/paths';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import InitiativeRow from './InitiativeRow';

// A project's goals as one framed list (docs/design-system.md §4 List, owner 28.09.: "Ziele
// schön"): each goal a row with its status dot, title and one line of detail on the left,
// its progress and state on the right. Sorting is a choice in the toolbar, not a column head.
export default function InitiativesList({
  initiatives,
  project,
  isLoading,
  statusTab,
}: {
  initiatives: Initiative[];
  project: ProjectDetail;
  isLoading: boolean;
  // The open status tab, absent on the tab that lists every status. An empty
  // status tab is a filtered view, not a first run, so it says so.
  statusTab: Exclude<InitiativesTab, 'all'> | undefined;
}) {
  const t = useTranslations('initiatives');
  const ownerById = new Map(project.assignees.map((a) => [a.userId, a]));

  if (isLoading) return <ListSkeleton className="ds-goal-list-pad" rowClassName="h-14" />;

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
    <div className="ds-goal-list-pad">
      <ul className="ds-goal-list" aria-label={t('title')}>
        {initiatives.map((it) => (
          <InitiativeRow
            key={it.id}
            initiative={it}
            projectKey={project.project.key}
            owner={it.ownerUserId ? (ownerById.get(it.ownerUserId) ?? null) : null}
          />
        ))}
      </ul>
    </div>
  );
}
