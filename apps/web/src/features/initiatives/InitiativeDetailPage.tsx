'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { revScope } from '@/utils/revScopes';
import { initiativePath, type InitiativeTab } from '@/utils/paths';
import { qk } from '@/services/queryKeys';
import { useInitiativeQuery } from '@/services/initiatives.service';
import { useLocalBoardSettings } from '@/hooks/useLocalBoardSettings';
import PageSkeleton from '@/components/common/skeleton/PageSkeleton';
import { PageTabs, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { FilterControl } from '@/components/layout/FilterBar';
import BoardDisplayControl from '@/features/work-items/components/BoardDisplayControl';
import InitiativeActions from './components/detail/InitiativeActions';
import InitiativeIssuesBoard, {
  INITIATIVE_BOARD_STORE_KEY,
} from './components/detail/InitiativeIssuesBoard';
import InitiativeOverview from './components/detail/InitiativeOverview';
import InitiativeProgress from './components/detail/InitiativeProgress';
import { Page } from '@/design-system';

// One initiative: its title, properties and description (Overview), how it is going
// (Progress) and the work items board over its linked issues (Issues). Each tab is
// its own route, so the open tab survives a reload; the route that mounts this page
// passes it. Everything the page offers is one header row (PageToolbar): the tabs,
// the board's filter and display on the Issues tab, and the initiative's menu.
export default function InitiativeDetailPage({ tab = 'overview' }: { tab?: InitiativeTab }) {
  const t = useTranslations('initiatives');
  const { project, customFields } = useShell();
  const params = useParams();
  const raw = Array.isArray(params.initiativeId) ? params.initiativeId[0] : params.initiativeId;
  const initiativeId = raw ? Number(raw) : null;

  const query = useInitiativeQuery(initiativeId);
  const projectKey = project?.project.key ?? '';
  // The Issues tab's layout, display and filters; held here because its controls
  // are in the header row.
  const board = useLocalBoardSettings(INITIATIVE_BOARD_STORE_KEY, initiativeId ?? 0);

  // Refetch the initiative (progress/health), its files, its linked Docs, its feed
  // and the board issues when its linked issues or its own fields change.
  useLiveRefresh({
    scope: initiativeId != null ? revScope.initiative(initiativeId) : null,
    targets: [
      qk.initiative(initiativeId ?? 0),
      qk.initiativeAttachments(initiativeId ?? 0),
      qk.initiativeFeed(initiativeId ?? 0),
      qk.boardIssues(projectKey),
    ],
    enabled: !!projectKey,
  });

  if (!project || initiativeId == null) return null;

  const initiative = query.data;

  return (
    <Page variant="fill">
      {initiative && (
        <PageToolbar>
          <PageTabs
            label={initiative.title}
            value={tab}
            items={(['overview', 'progress', 'issues'] as const).map((value) => ({
              value,
              label: t(`detailTabs.${value}`),
              href: initiativePath(projectKey, initiative.id, value),
            }))}
          />
          <PageToolbarSpacer />
          {tab === 'issues' && (
            <>
              <FilterControl
                filters={board.filters}
                onChange={board.setFilters}
                project={project}
                customFields={customFields}
              />
              <BoardDisplayControl
                view={board.view}
                onViewChange={board.changeView}
                settings={board.settings}
                onSettingsChange={board.changeSettings}
                customFields={customFields}
                issueTypes={project.issueTypes}
              />
            </>
          )}
          <InitiativeActions initiative={initiative} projectKey={projectKey} />
        </PageToolbar>
      )}
      {query.isLoading ? (
        <PageSkeleton className="mx-0 max-w-none" />
      ) : !initiative ? (
        <p className="p-4 text-sm text-muted-foreground">{t('notFound')}</p>
      ) : tab === 'issues' ? (
        <InitiativeIssuesBoard initiativeId={initiative.id} board={board} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'progress' ? (
            <InitiativeProgress initiative={initiative} project={project} />
          ) : (
            <InitiativeOverview initiative={initiative} project={project} />
          )}
        </div>
      )}
    </Page>
  );
}
