'use client';

import { useTranslations } from 'next-intl';
import { Bot, CircleCheck } from 'lucide-react';
import { agentActivityForAgentPath, issuePath } from '@/utils/paths';
import { formatDurationShort } from '@/utils/dates';
import Avatar from '@/components/common/Avatar';
import StatusBadge from '@/components/common/page/StatusBadge';
import { RowEmpty, RowLink, SectionLabel } from '@/components/common/page/RowList';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { SkeletonRows } from '../DashboardCard';
import { useHomeActiveActivity, HOME_ACTIVE_STATUSES } from '../../services/homeKpis.service';

// Who works on what right now, across every project: the same recent-activity read the
// running figure counts, so the two never disagree.
export function useAgentsNow(): {
  entries: AgentActivityEntry[];
  finished: AgentActivityEntry[];
  isPending: boolean;
} {
  const activity = useHomeActiveActivity();
  const items = activity.data?.items ?? [];
  const entries = items.filter((entry) => HOME_ACTIVE_STATUSES.has(entry.status) && entry.agent);
  const finished = items.filter((entry) => entry.status === 'success' && entry.agent);
  return { entries, finished, isPending: activity.isPending };
}

// A waiting or suspended entry reads as the amber "needs a decision"; everything else
// that is open runs.
function waiting(status: string): boolean {
  return status === 'waiting' || status === 'suspended';
}

// One agent at work: its avatar, its name, what it works on, since when. The row opens
// the task, or else the agent's timeline.
// `recent` also lists that many of the latest finished answers and runs, under a label.
export default function AgentsNowRows({ limit, recent = 0 }: { limit: number; recent?: number }) {
  const t = useTranslations('home');
  const tActivity = useTranslations('agentActivity');
  const { entries, finished, isPending } = useAgentsNow();
  if (isPending) return <SkeletonRows count={Math.min(2, limit)} />;
  const done = finished.slice(0, recent);
  return (
    <>
      {entries.length === 0 && <RowEmpty icon={<Bot />}>{t('agents.empty')}</RowEmpty>}
      {entries.slice(0, limit).map((entry) => {
        const agent = entry.agent!;
        const href =
          entry.issue && entry.project
            ? issuePath(entry.project.key, entry.issue.sequenceNumber)
            : agentActivityForAgentPath(agent.id, entry.project?.key);
        const pause = waiting(entry.status);
        return (
          <RowLink
            key={entry.id}
            href={href}
            icon={<Avatar name={agent.name} className="size-5" />}
            title={agent.name}
            detail={entry.issue?.title ?? entry.project?.name ?? tActivity(`kinds.${entry.kind}`)}
            trailing={
              <>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {pause ? t('agents.waiting') : formatDurationShort(entry.at)}
                </span>
                <StatusBadge status={pause ? 'waiting' : 'running'} dotOnly />
              </>
            }
          />
        );
      })}
      {done.length > 0 && (
        <>
          <SectionLabel as="h3">{t('agents.finished')}</SectionLabel>
          {done.map((entry) => {
            const agent = entry.agent!;
            return (
              <RowLink
                key={entry.id}
                href={
                  entry.issue && entry.project
                    ? issuePath(entry.project.key, entry.issue.sequenceNumber)
                    : agentActivityForAgentPath(agent.id, entry.project?.key)
                }
                icon={<CircleCheck className="text-status-success!" />}
                title={agent.name}
                detail={
                  entry.issue?.title ?? entry.project?.name ?? tActivity(`kinds.${entry.kind}`)
                }
                trailing={
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDurationShort(entry.at)}
                  </span>
                }
              />
            );
          })}
        </>
      )}
    </>
  );
}
