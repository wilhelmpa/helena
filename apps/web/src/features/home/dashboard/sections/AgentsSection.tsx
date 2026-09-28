'use client';

import { useTranslations } from 'next-intl';
import { Bot } from 'lucide-react';
import { globalAgentActivityPath } from '@/utils/paths';
import { formatDurationShort } from '@/utils/dates';
import Orb from '@/components/helena/Orb';
import { useAgentStatus } from '@/utils/helenaStatus';
import { RowEmpty, RowLink } from '@/components/common/page/RowList';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { DashboardSection, SkeletonRows } from '../DashboardParts';
import { MonoMeta } from '@/components/helena/DashboardPrimitives';
import { useHomeActiveActivity, HOME_ACTIVE_STATUSES } from '../../services/homeKpis.service';
import { Text } from '@/design-system';

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
  const seen = new Set<number>();
  return {
    running: items.filter((entry) => {
      if (!entry.agent || !HOME_ACTIVE_STATUSES.has(entry.status) || seen.has(entry.agent.id))
        return false;
      seen.add(entry.agent.id);
      return true;
    }),
    finished: items.filter((entry) => entry.status === 'success' && entry.agent),
    isPending: activity.isPending,
  };
}

// A row opens the task the agent works on, or else the agent's timeline.
function AgentRow({ entry, finished = false }: { entry: AgentActivityEntry; finished?: boolean }) {
  const t = useTranslations('home');
  const tActivity = useTranslations('agentActivity');
  const status = useAgentStatus(entry.agent!.id, {
    run: finished
      ? 'done'
      : entry.status === 'waiting' || entry.status === 'suspended'
        ? 'waiting'
        : 'running',
  });
  return (
    <RowLink
      href={globalAgentActivityPath()}
      icon={<Orb state={status} size="small" />}
      title={entry.agent!.name}
      detail={entry.issue?.title ?? entry.project?.name ?? tActivity(`kinds.${entry.kind}`)}
      trailing={
        <MonoMeta>
          {status === 'waiting' ? t('agents.waiting') : formatDurationShort(entry.at)}
        </MonoMeta>
      }
    />
  );
}

// "Läuft gerade": one row per agent at work (avatar, name, what it works on, since when),
// then "Zuletzt fertig", the three latest finished answers and runs, compact.
export default function AgentsSection() {
  const t = useTranslations('home');
  const { running, isPending } = useAgentsNow();
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
            <AgentRow key={entry.id} entry={entry} />
          ))}
        </>
      )}
    </DashboardSection>
  );
}

export function FinishedSection() {
  const t = useTranslations('home');
  const { finished, isPending } = useAgentsNow();
  return (
    <DashboardSection
      label={t('agents.finished')}
      count={finished.length}
      href={globalAgentActivityPath()}
      hrefLabel={t('links.activity')}
    >
      {isPending ? (
        <SkeletonRows count={3} />
      ) : finished.length ? (
        finished
          .slice(0, FINISHED_SHOWN)
          .map((entry) => <AgentRow key={entry.id} entry={entry} finished />)
      ) : (
        <Text as="p" size="xs" tone="muted" className="p-3">
          {t('agents.noFinished')}
        </Text>
      )}
    </DashboardSection>
  );
}
