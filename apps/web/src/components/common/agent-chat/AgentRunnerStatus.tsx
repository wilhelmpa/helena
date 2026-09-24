import { Radio } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { cn } from '@/lib/utils';
import { formatDurationShort } from '@/utils/dates';
import { AgentTemplateBadge } from './AgentTemplateBadge';
import { isRunnerOnline } from './runnerOnline';

// Whether an external agent's runner is connected right now. The agent has no runner
// until someone starts one, so "never connected" is a normal state and reads
// differently from "went offline". `compact` drops to the bare state for places that
// already say what it is about, such as a section header.
//
// The strings sit in the settings namespace, where the runner is set up; the chat shows
// the same three states rather than wording its own.
//
// A pool template runs nowhere by design (it has no project, so no runner ever polls
// for it) — that must never read as "offline"/"never connected", which says a runner
// *should* be there and is not. `copyCount`, when the caller has the team's agent list
// handy, is forwarded to the template badge; every caller that does not simply omits it.
export function AgentRunnerStatus({
  agent,
  compact = false,
  copyCount,
}: {
  // Null while the agent is still being created: nothing can have connected yet.
  agent: AiAgent | null;
  compact?: boolean;
  copyCount?: number;
}) {
  const t = useTranslations('teams.agents');
  if (agent?.template) return <AgentTemplateBadge copyCount={copyCount} />;
  const lastSeen = agent?.lastSeenAt ?? null;
  const online = isRunnerOnline(agent);

  let label: string;
  if (online) label = compact ? t('runnerStateOnline') : t('runnerOnline');
  else if (lastSeen) label = compact ? t('runnerStateOffline') : t('runnerOffline');
  else label = compact ? t('runnerStateNone') : t('runnerNever');

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Radio
        className={cn(
          'size-3 shrink-0',
          online ? 'text-status-success' : 'text-muted-foreground/60',
        )}
      />
      {label}
      {/* How long it has been gone is the useful half of "offline", so it survives
          the compact form — shortened to the bare duration. */}
      {!online && lastSeen && (
        <span className="text-muted-foreground/70">
          {compact
            ? `· ${formatDurationShort(lastSeen)}`
            : `· ${t('runnerSeen', { time: formatDurationShort(lastSeen) })}`}
        </span>
      )}
    </span>
  );
}
