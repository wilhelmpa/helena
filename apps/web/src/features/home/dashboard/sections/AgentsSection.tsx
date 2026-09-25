'use client';

import { useTranslations } from 'next-intl';
import { Bot, CircleCheck } from 'lucide-react';
import { agentActivityForAgentPath, globalAgentActivityPath, issuePath } from '@/utils/paths';
import { formatDurationShort } from '@/utils/dates';
import Avatar from '@/components/common/Avatar';
import StatusBadge from '@/components/common/page/StatusBadge';
import { RowEmpty, RowLink } from '@/components/common/page/RowList';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { DashboardSection, SectionSubLabel, SkeletonRows } from '../DashboardParts';
import { useHomeActiveActivity, HOME_ACTIVE_STATUSES } from '../../services/homeKpis.service';

const RUNNING_SHOWN = 5;
const FINISHED_SHOWN = 3;

// Who works on what right now, and what finished last, across every project: the same
// recent-activity read the "Agenten arbeiten" tile counts, so the two never disagree.
export function useAgentsNow(): {
  running: AgentActivityEntry[];
  finished: AgentActivityEntry[];
  isPending: boolean;
} {
  const activity = useHomeActiveActivity();
  const items = activity.data?.items ?? [];
  return {
    running: items.filter((entry) => HOME_ACTIVE_STATUSES.has(entry.status) && entry.agent),
    finished: items.filter((entry) => entry.status === 'success' && entry.agent),
    isPending: activity.isPending,
  };
}

// A row opens the task the agent works on, or else the agent's timeline.
function entryHref(entry: AgentActivityEntry): string {
  return entry.issue && entry.project
    ? issuePath(entry.project.key, entry.issue.sequenceNumber)
    : agentActivityForAgentPath(entry.agent!.id, entry.project?.key);
}

// A waiting or suspended entry reads as the amber "needs a decision"; everything else
// that is open runs.
const paused = (status: string) => status === 'waiting' || status === 'suspended';

// "Läuft gerade": one row per agent at work (avatar, name, what it works on, since when),
// then "Zuletzt fertig", the three latest finished answers and runs, compact.
export default function AgentsSection() {
  const t = useTranslations('home');
  const tActivity = useTranslations('agentActivity');
  const { running, finished, isPending } = useAgentsNow();
  const what = (entry: AgentActivityEntry) =>
    entry.issue?.title ?? entry.project?.name ?? tActivity(`kinds.${entry.kind}`);
  return (
    <DashboardSection
      label={t('widgets.running')}
      count={running.length}
      href={globalAgentActivityPath()}
      hrefLabel={t('links.activity')}
    >
      {isPending ? (
        <SkeletonRows count={4} />
      ) : (
        <>
          {running.length === 0 && <RowEmpty icon={<Bot />}>{t('agents.empty')}</RowEmpty>}
          {running.slice(0, RUNNING_SHOWN).map((entry) => (
            <RowLink
              key={entry.id}
              href={entryHref(entry)}
              icon={<Avatar name={entry.agent!.name} className="size-5" />}
              title={entry.agent!.name}
              detail={what(entry)}
              trailing={
                <>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {paused(entry.status) ? t('agents.waiting') : formatDurationShort(entry.at)}
                  </span>
                  <StatusBadge status={paused(entry.status) ? 'waiting' : 'running'} dotOnly />
                </>
              }
            />
          ))}
          {finished.length > 0 && (
            <>
              <SectionSubLabel>{t('agents.finished')}</SectionSubLabel>
              {finished.slice(0, FINISHED_SHOWN).map((entry) => (
                <RowLink
                  key={entry.id}
                  href={entryHref(entry)}
                  className="h-7"
                  icon={<CircleCheck className="size-3.5! text-status-success!" />}
                  title={<span className="text-muted-foreground">{entry.agent!.name}</span>}
                  detail={what(entry)}
                  trailing={
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDurationShort(entry.at)}
                    </span>
                  }
                />
              ))}
            </>
          )}
        </>
      )}
    </DashboardSection>
  );
}
