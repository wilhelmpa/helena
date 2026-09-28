import Link from 'next/link';
import { Bot, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Routine } from '@/lib/api/endpoints/routines';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { aiTeamPath } from '@/utils/paths';
import { useCronDescription } from '../hooks/useCronDescription';
import { formatInZone } from '../utils/schedulePreview';
import { RoutineActionsMenu, type RoutineActions } from './RoutineActionsMenu';
import { RoutineLastRun } from './RoutineLastRun';
import { RoutineMentionsLine } from './RoutineMentions';
import { Inline, Stack, Text } from '@/design-system';

// One routine on a phone, where the table has no room: the same facts stacked in one
// row of the list — title and switch, agent and project, when it runs, how it last ran.
export function RoutineItem({
  routine,
  showProject,
  actions,
}: {
  routine: Routine;
  showProject: boolean;
  actions?: RoutineActions;
}) {
  const t = useTranslations('routines');
  const describe = useCronDescription();
  return (
    <Stack as="li" gap={2} padX={3} padY={3} className="text-sm">
      <Inline gap={2}>
        <p dir="auto" className="min-w-0 flex-1 truncate font-medium" title={routine.instructions}>
          {showProject ? (
            <Link
              href={aiTeamPath(routine.projectKey, 'schedules')}
              className="underline-offset-2 hover:underline"
            >
              {routine.title}
            </Link>
          ) : (
            routine.title
          )}
        </p>
        {actions?.canEdit ? (
          <Switch
            checked={routine.enabled}
            onCheckedChange={actions.onToggle}
            aria-label={t('runOnSchedule')}
          />
        ) : (
          <StatusBadge status={routine.enabled ? 'success' : 'idle'}>
            {routine.enabled ? t('active') : t('paused')}
          </StatusBadge>
        )}
        {actions && <RoutineActionsMenu actions={actions} />}
      </Inline>
      <p
        className={cn(
          'flex min-w-0 items-center gap-1 text-xs',
          routine.agent ? 'text-muted-foreground' : 'text-destructive',
        )}
      >
        <Bot className="size-3.5 shrink-0" />
        <span className="truncate">{routine.agent?.name ?? t('agentLeft')}</span>
        {showProject && (
          <Link
            href={aiTeamPath(routine.projectKey, 'schedules')}
            className="ms-auto shrink-0 font-mono text-muted-foreground hover:underline"
          >
            {routine.projectKey}
          </Link>
        )}
      </p>
      <RoutineMentionsLine mentions={routine.mentions} />
      <Text as="p" size="xs" tone="muted" className="flex min-w-0 items-center gap-1">
        <Clock className="size-3.5 shrink-0" />
        <span className="truncate text-foreground" title={routine.cron}>
          {describe(routine.cron) ?? routine.cron}
        </span>
      </Text>
      <Text as="p" size="xs" tone="muted" className="ps-4.5 tabular-nums">
        {routine.nextRunAt
          ? t('nextRunAt', { time: formatInZone(routine.nextRunAt, routine.timezone) })
          : t('paused')}{' '}
        · {routine.timezone}
      </Text>
      <RoutineLastRun routine={routine} canEdit={actions?.canEdit ?? false} />
    </Stack>
  );
}
