'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { issuePath, projectPath } from '@/utils/paths';
import Avatar from '@/components/common/Avatar';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { useHomeActiveActivity, HOME_ACTIVE_STATUSES } from '../../services/homeKpis.service';

const LIMIT = 6;

// suspended/waiting read as the same amber "needs a decision" the rest of the app
// uses for a status; only an actually running/streaming/queued entry gets the
// brand-colored running dot.
function statusOf(raw: string): Status {
  if (raw === 'waiting' || raw === 'suspended') return 'waiting';
  return 'running';
}

// "Agenten gerade" (docs/volition-design-helena-ui.md "Start"): a live list of who
// is working on what, across every project — the same recent-activity read
// useHomeRunningAgentsCount uses for the KPI number, so the two never disagree.
export default function HomeAgentsNow() {
  const t = useTranslations('nav');
  const tActivity = useTranslations('agentActivity');
  const activity = useHomeActiveActivity();

  const running = (activity.data?.items ?? [])
    .filter((entry) => HOME_ACTIVE_STATUSES.has(entry.status) && entry.agent)
    .slice(0, LIMIT);

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{t('agentsNow')}</h2>
      {running.length === 0 ? (
        <div className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          {t('agentsNowEmpty')}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border bg-card">
          {running.map((entry) => {
            const href = entry.issue
              ? issuePath(entry.project!.key, entry.issue.sequenceNumber)
              : entry.project
                ? projectPath(entry.project.key)
                : '#';
            return (
              <Link
                key={entry.id}
                href={href}
                className="flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <Avatar name={entry.agent!.name} className="size-6 shrink-0 text-[10px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{entry.agent!.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {entry.issue?.title ?? entry.project?.name ?? tActivity(`kinds.${entry.kind}`)}
                  </div>
                </div>
                <StatusBadge status={statusOf(entry.status)} dotOnly className="shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
