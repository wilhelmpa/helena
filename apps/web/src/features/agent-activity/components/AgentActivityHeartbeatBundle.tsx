import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRelativeTime } from '@/context/relativeTimeContext';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { Button, Inline, Text } from '@/design-system';
import AgentActivityRow from './AgentActivityRow';

// Heartbeats of one agent that found nothing to do, as one row of the history (owner, I):
// how many, and from when to when; "Anzeigen" lists them.
export default function AgentActivityHeartbeatBundle({
  agent,
  entries,
  showProject,
}: {
  agent: AgentActivityEntry['agent'];
  entries: AgentActivityEntry[];
  showProject: boolean;
}) {
  const t = useTranslations('agentActivity');
  const relativeTime = useRelativeTime();
  const [open, setOpen] = useState(false);
  const newest = entries[0]!;
  const oldest = entries.at(-1)!;
  return (
    <>
      <li className="ds-activity-row" data-bundle="heartbeats">
        <Text tone="muted">
          <HeartPulse size={16} aria-hidden="true" />
        </Text>
        <Inline gap={2} wrap grow>
          <Text weight="medium">{agent?.name ?? '–'}</Text>
          <Text size="xs" tone="muted">
            {t('idleHeartbeats', { count: entries.length })}
          </Text>
          {showProject && newest.project && (
            <Text size="xs" tone="muted" mono>
              {newest.project.key}
            </Text>
          )}
        </Inline>
        <Inline gap={2}>
          <Text size="xs" tone="muted">
            {t('between', { from: relativeTime(oldest.at), to: relativeTime(newest.at) })}
          </Text>
          <Button size="small" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('hide') : t('show')}
          </Button>
        </Inline>
      </li>
      {open &&
        entries.map((entry) => (
          <AgentActivityRow key={entry.id} entry={entry} showProject={showProject} />
        ))}
    </>
  );
}
