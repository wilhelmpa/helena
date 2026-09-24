'use client';

import { useTranslations } from 'next-intl';
import { Bot } from 'lucide-react';
import { agentActivityForAgentPath, issuePath } from '@/utils/paths';
import Avatar from '@/components/common/Avatar';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { RowEmpty, RowLink, RowList, SectionLabel } from '@/components/common/page/RowList';
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
// useHomeRunningAgentsCount uses for the KPI number, so the two never disagree. A row
// opens the task the agent works on, or else that agent's timeline.
export default function HomeAgentsNow() {
  const t = useTranslations('nav');
  const tActivity = useTranslations('agentActivity');
  const activity = useHomeActiveActivity();

  const running = (activity.data?.items ?? [])
    .filter((entry) => HOME_ACTIVE_STATUSES.has(entry.status) && entry.agent)
    .slice(0, LIMIT);

  return (
    <section className="min-w-0">
      <SectionLabel
        trailing={
          running.length > 0 ? (
            <span className="font-mono text-xs tabular-nums">{running.length}</span>
          ) : null
        }
      >
        {t('agentsNow')}
      </SectionLabel>
      <RowList className="bg-card">
        {running.length === 0 ? (
          <RowEmpty icon={<Bot />}>{t('agentsNowEmpty')}</RowEmpty>
        ) : (
          running.map((entry) => {
            const agent = entry.agent!;
            const href =
              entry.issue && entry.project
                ? issuePath(entry.project.key, entry.issue.sequenceNumber)
                : agentActivityForAgentPath(agent.id, entry.project?.key);
            return (
              <RowLink
                key={entry.id}
                href={href}
                icon={<Avatar name={agent.name} className="size-5" />}
                title={agent.name}
                detail={
                  entry.issue?.title ?? entry.project?.name ?? tActivity(`kinds.${entry.kind}`)
                }
                trailing={<StatusBadge status={statusOf(entry.status)} dotOnly />}
              />
            );
          })
        )}
      </RowList>
    </section>
  );
}
