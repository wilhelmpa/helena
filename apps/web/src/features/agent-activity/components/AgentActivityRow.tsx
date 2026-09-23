import Link from 'next/link';
import { Bot, MessageSquare, Network, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentTokenCounts } from '@/components/common/agent-chat/AgentTokenCounts';
import { useRelativeTime } from '@/context/relativeTimeContext';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { formatElapsed } from '@/utils/agentUsage';
import { formatDateTime } from '@/utils/dates';
import { activityTask } from '../utils/activityDetails';
import AgentActivityDetails from './AgentActivityDetails';

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

const TRIGGERS = ['mention', 'delegation', 'field', 'schedule', 'manual'] as const;

function isOneOf<T extends string>(values: readonly T[], value: string | null): value is T {
  return value != null && (values as readonly string[]).includes(value);
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
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{entry.agent?.name ?? entry.workflowId}</span>
          <span className="text-xs text-muted-foreground">{t(`kinds.${entry.kind}`)}</span>
          <Badge variant={entry.status === 'failed' ? 'destructive' : 'outline'}>
            {isOneOf(STATUSES, entry.status) ? t(`status.${entry.status}`) : entry.status}
          </Badge>
          {showProject && entry.project && <Badge variant="secondary">{entry.project.key}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task && (
            <Link href={task.href} className="truncate text-foreground hover:underline" dir="auto">
              {task.label}
            </Link>
          )}
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
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <time dateTime={entry.at}>{relativeTime(entry.at)}</time>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(entry.at)}</TooltipContent>
        </Tooltip>
        <AgentActivityDetails entry={entry} />
      </div>
    </li>
  );
}
