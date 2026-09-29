import Link from 'next/link';
import { Bot, MessageSquare, Network, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentTokenCounts } from '@/components/common/agent-chat/AgentTokenCounts';
import { useRelativeTime } from '@/context/relativeTimeContext';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { formatElapsed } from '@/utils/agentUsage';
import { formatDateTime } from '@/utils/dates';
import { activityTask } from '../utils/activityDetails';
import AgentActivityDetails from './AgentActivityDetails';
import { Inline, Text } from '@/design-system';

const icon = {
  chat: MessageSquare,
  'agent-run': Bot,
  'agent-team-run': Network,
  'workflow-run': Workflow,
} as const;

const STATUSES = [
  'pending',
  'running',
  'streaming',
  'waiting',
  'suspended',
  'success',
  'failed',
  'canceled',
  'bailed',
  'skipped',
] as const;

const TRIGGERS = ['mention', 'delegation', 'field', 'schedule', 'manual', 'heartbeat'] as const;

function isOneOf<T extends string>(values: readonly T[], value: string | null): value is T {
  return value != null && (values as readonly string[]).includes(value);
}

// The app's one status vocabulary (StatusBadge) for a run's state.
function toneOf(status: string): Status {
  if (status === 'failed') return 'danger';
  if (status === 'success') return 'success';
  if (status === 'waiting' || status === 'suspended') return 'waiting';
  if (status === 'pending' || status === 'running' || status === 'streaming') return 'running';
  return 'idle';
}

export default function AgentActivityRow({
  entry,
  showProject,
}: {
  entry: AgentActivityEntry;
  showProject: boolean;
}) {
  const t = useTranslations('agentActivity');
  const relativeTime = useRelativeTime();
  const Icon = icon[entry.kind];
  const task = activityTask(entry);

  return (
    <li className="ds-activity-row">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground sm:mt-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium">{entry.agent?.name ?? entry.workflowId}</span>
        <Text as="span" size="xs" tone="muted">
          {t(`kinds.${entry.kind}`)}
        </Text>
        <StatusBadge status={toneOf(entry.status)}>
          {isOneOf(STATUSES, entry.status) ? t(`status.${entry.status}`) : entry.status}
        </StatusBadge>
        {showProject && entry.project && (
          <Text as="span" size="xs" tone="muted" className="font-mono">
            {entry.project.key}
          </Text>
        )}
        {task && (
          <Link
            href={task.href}
            className="max-w-full truncate text-xs text-foreground hover:underline"
            dir="auto"
          >
            {task.label}
          </Link>
        )}
        <Text as="span" size="xs" tone="muted" className="flex flex-wrap items-center gap-x-2">
          {entry.trigger && (
            <span>
              {isOneOf(TRIGGERS, entry.trigger) ? t(`triggers.${entry.trigger}`) : entry.trigger}
            </span>
          )}
          {entry.durationMs != null && <span dir="ltr">{formatElapsed(entry.durationMs)}</span>}
          <AgentTokenCounts input={entry.inputTokens} output={entry.outputTokens} />
          {entry.maxTurns != null && <span>{t('maxTurns', { count: entry.maxTurns })}</span>}
          {entry.runBudgetSeconds != null && (
            <span>{t('runBudget', { minutes: Math.round(entry.runBudgetSeconds / 60) })}</span>
          )}
        </Text>
      </div>
      <Inline gap={1} className="shrink-0 text-xs text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <time dateTime={entry.at}>{relativeTime(entry.at)}</time>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(entry.at)}</TooltipContent>
        </Tooltip>
        <AgentActivityDetails entry={entry} />
      </Inline>
    </li>
  );
}
