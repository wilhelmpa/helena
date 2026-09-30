'use client';

import { Card } from '@/design-system';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { formatDateTime } from '@/utils/dates';
import type { PolicyDecisionEntry, PolicyOutcome } from '@/lib/api/endpoints/autopilot';
import { usePolicyDecisions } from '@/services/autopilot.service';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import AutopilotLevelBadge from './AutopilotLevelBadge';

const FILTERS: (PolicyOutcome | 'all')[] = ['all', 'needs-approval', 'deny', 'allow'];
const ADAPTERS = [
  'hermes',
  'claude',
  'codex',
  'mcp',
  'gateway',
  'workflow',
  'approval',
  'chat',
] as const;
const PAGE = 25;

// The policy engine's decisions in the project, newest first: who wanted to do what, in
// which category, at which level, and how it came out. Plain reads are not logged.
export default function PolicyDecisionLog({ projectKey }: { projectKey: string }) {
  const t = useTranslations('autopilot');
  const [filter, setFilter] = useState<PolicyOutcome | 'all'>('all');
  const [pages, setPages] = useState(1);
  const query = usePolicyDecisions(
    projectKey,
    { page: 1, pageSize: PAGE * pages },
    filter === 'all' ? undefined : filter,
  );
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div className="space-y-3">
      <div role="tablist" className="flex flex-wrap gap-1">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => {
              setFilter(value);
              setPages(1);
            }}
            className={cn(
              'h-8 rounded-md px-2.5 text-sm transition-colors',
              filter === value
                ? 'bg-accent font-medium'
                : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {value === 'all' ? t('logAll') : t(`outcome.${value}`)}
          </button>
        ))}
      </div>
      <Card pad="none" className="overflow-hidden">
        {query.isLoading ? (
          <div className="p-3">
            <ListSkeleton rows={4} rowClassName="h-8" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('logEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((entry) => (
              <DecisionRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </Card>
      {items.length < total && (
        <Button variant="outline" size="sm" onClick={() => setPages((n) => n + 1)}>
          {t('logMore')}
        </Button>
      )}
    </div>
  );
}

function DecisionRow({ entry }: { entry: PolicyDecisionEntry }) {
  const t = useTranslations('autopilot');
  const relativeTime = useRelativeTime();
  const adapter = (ADAPTERS as readonly string[]).includes(entry.adapter)
    ? t(`adapter.${entry.adapter as (typeof ADAPTERS)[number]}`)
    : entry.adapter;
  return (
    <li className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            'shrink-0',
            entry.outcome === 'deny' && 'border-status-danger/40 text-status-danger',
            entry.outcome === 'needs-approval' && 'border-status-waiting/40 text-status-waiting',
          )}
        >
          {t(`outcome.${entry.outcome}`)}
        </Badge>
        <span className="shrink-0 text-xs font-medium">{t(`categoryLabel.${entry.category}`)}</span>
        <span
          className="min-w-0 truncate font-mono text-xs text-muted-foreground"
          title={entry.summary ?? ''}
        >
          {entry.summary ?? entry.tool}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <AutopilotLevelBadge level={entry.level} />
        <span className="truncate">
          {entry.agentName ?? '—'} · {adapter}
        </span>
        <time
          dateTime={entry.createdAt}
          title={formatDateTime(entry.createdAt)}
          className="tabular-nums"
        >
          {relativeTime(entry.createdAt)}
        </time>
      </div>
    </li>
  );
}
