'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { AgentActivityFilters as Filters } from '@/lib/api/endpoints/agentActivity';
import { useAgentActivityFeed } from '../services/agentActivity.service';
import AgentActivityFilters from './AgentActivityFilters';
import AgentActivityLiveRefresh from './AgentActivityLiveRefresh';
import AgentActivityRow from './AgentActivityRow';

// One sync request reads at most 20 scopes for the whole screen, two per project here.
const WATCHED_PROJECTS = 6;

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
  const [filters, setFilters] = useState<Filters>({});
  const feed = useAgentActivityFeed(projectKey, filters);
  const pages = feed.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const notice = pages.find((page) => page.notice)?.notice ?? null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {projectIds.slice(0, WATCHED_PROJECTS).map((projectId) => (
        <AgentActivityLiveRefresh key={projectId} projectId={projectId} projectKey={projectKey} />
      ))}
      <AgentActivityFilters filters={filters} onChange={setFilters} agents={agents} />
      {notice && (
        <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
          {t(`notice.${notice}`)}
        </p>
      )}
      {feed.isPending ? (
        <ListSkeleton rows={6} rowClassName="h-14" />
      ) : feed.isError ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : items.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ol className="divide-y rounded-lg border">
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
