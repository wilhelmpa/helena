'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { AgentActivityFilters as Filters } from '@/lib/api/endpoints/agentActivity';
import { useAgentActivityFeed } from '../services/agentActivity.service';
import AgentActivityToolbar from './AgentActivityToolbar';
import AgentActivityLiveRefresh from './AgentActivityLiveRefresh';
import AgentActivityRow from './AgentActivityRow';
import { ACTIVE_ACTIVITY_STATUSES } from '../utils/runningLink';

// One sync request reads at most 20 scopes for the whole screen, two per project here.
const WATCHED_PROJECTS = 6;

const KIND_VALUES = new Set(['chat', 'agent-run', 'agent-team-run', 'workflow-run']);

// The filters live in the address (?agent=12&kind=agent-run): Home's "Agenten gerade"
// opens the timeline on the one agent it names, and the back button returns to the same
// filters.
export function activityFiltersFromSearch(params: URLSearchParams): Filters {
  const agentId = Number(params.get('agent'));
  const kind = params.get('kind');
  return {
    ...(Number.isInteger(agentId) && agentId > 0 ? { agentId } : {}),
    ...(kind && KIND_VALUES.has(kind) ? { kind: kind as Filters['kind'] } : {}),
  };
}

// The agent timeline of a project, or of Home when projectKey is null, newest first.
export default function AgentActivityTimeline({
  projectKey,
  projectIds,
  agents,
}: {
  projectKey: string | null;
  projectIds: number[];
  agents: AiAgent[];
}) {
  const t = useTranslations('agentActivity');
  const tCommon = useTranslations('common');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = activityFiltersFromSearch(new URLSearchParams(searchParams.toString()));
  const feed = useAgentActivityFeed(projectKey, filters);
  const pages = feed.data?.pages ?? [];
  // ?status=running (the "N Agenten arbeiten" link): only what is still at work.
  const running = searchParams.get('status') === 'running';
  const items = pages
    .flatMap((page) => page.items)
    .filter((entry) => !running || ACTIVE_ACTIVITY_STATUSES.has(entry.status));

  const setFilters = (next: Filters, nextRunning = running) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextRunning) params.set('status', 'running');
    else params.delete('status');
    if (next.agentId) params.set('agent', String(next.agentId));
    else params.delete('agent');
    if (next.kind) params.set('kind', next.kind);
    else params.delete('kind');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      {projectIds.slice(0, WATCHED_PROJECTS).map((projectId) => (
        <AgentActivityLiveRefresh key={projectId} projectId={projectId} projectKey={projectKey} />
      ))}
      <AgentActivityToolbar
        filters={filters}
        onChange={setFilters}
        running={running}
        onRunning={(next) => setFilters(filters, next)}
        agents={agents}
      />
      {feed.isPending ? (
        <ListSkeleton rows={6} rowClassName="h-14" />
      ) : feed.isError ? (
        <EmptyState title={t('unavailable')} description={t('unavailableHint')}>
          <Button size="sm" variant="outline" onClick={() => void feed.refetch()}>
            {tCommon('reload')}
          </Button>
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState
          title={running ? t('noneRunning') : t('empty')}
          description={running ? t('noneRunningHint') : t('emptyHint')}
        />
      ) : (
        <ol className="ds-activity-list">
          {items.map((entry) => (
            <AgentActivityRow key={entry.id} entry={entry} showProject={projectKey == null} />
          ))}
        </ol>
      )}
      {feed.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          disabled={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          {feed.isFetchingNextPage ? tCommon('loading') : t('showMore')}
        </Button>
      )}
    </div>
  );
}
