import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { Routine, RoutineInput, RoutineMode } from '@/lib/api/endpoints/routines';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { parseScheduleInput } from '../utils/cronSchedule';
import { DEFAULT_TIMEZONE, isTimeZone } from '../utils/schedulePreview';
import { RoutineAgentField } from './RoutineAgentField';
import { RoutineCronInput } from './RoutineCronInput';
import { RoutineField } from './RoutineField';
import { RoutineModeField } from './RoutineModeField';
import { RoutineNextRuns } from './RoutineNextRuns';
import type { RoutineTask } from './RoutineTaskField';
import { RoutineTimezoneInput } from './RoutineTimezoneInput';

export function RoutineDialog({
  projectKey,
  agents,
  initial,
  saving,
  onSave,
  onClose,
}: {
  projectKey: string;
  agents: AiAgent[];
  initial?: Routine;
  saving: boolean;
  onSave: (value: RoutineInput) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('routines');
  const tCommon = useTranslations('common');
  const [agentId, setAgentId] = useState(
    String(initial?.agent?.id ?? (agents.find((a) => a.triggerOnAssign) ?? agents[0])?.id ?? ''),
  );
  const [title, setTitle] = useState(initial?.title ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [mode, setMode] = useState<RoutineMode>(initial?.mode ?? 'new');
  const [task, setTask] = useState<RoutineTask | null>(
    initial?.task
      ? {
          id: initial.task.id,
          identifier: `${projectKey}-${initial.task.number}`,
          title: initial.task.title,
        }
      : null,
  );
  const [scheduleInput, setScheduleInput] = useState(initial?.cron ?? 'Every weekday at 9:00 AM');
  const [timezone, setTimezone] = useState(initial?.timezone ?? DEFAULT_TIMEZONE);
  const agent = agents.find((a) => String(a.id) === agentId) ?? null;
  const schedule = parseScheduleInput(scheduleInput);
  const isValid =
    agent?.triggerOnAssign === true &&
    title.trim().length > 0 &&
    title.trim().length <= 300 &&
    instructions.trim().length > 0 &&
    instructions.trim().length <= 20_000 &&
    (mode === 'new' || task !== null) &&
    schedule.ok &&
    isTimeZone(timezone);

  async function submit() {
    if (!isValid || !agent || !schedule.ok) return;
    await onSave({
      agentId: agent.id,
      title: title.trim(),
      instructions: instructions.trim(),
      mode,
      taskId: mode === 'reopen' ? (task?.id ?? null) : null,
      cron: schedule.cron,
      timezone,
    });
  }

  return (
    <Modal
      title={initial ? t('editTitle') : t('newTitle')}
      description={t('dialogDescription')}
      scope={projectKey}
      onClose={onClose}
      wide
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <RoutineField htmlFor="routine-title" label={t('title')}>
            <Input
              id="routine-title"
              autoFocus
              required
              maxLength={300}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('titlePlaceholder')}
            />
          </RoutineField>
          <RoutineAgentField agents={agents} agentId={agentId} onChange={setAgentId} />
        </div>

        <RoutineModeField
          projectKey={projectKey}
          mode={mode}
          task={task}
          onModeChange={setMode}
          onTaskChange={setTask}
        />

        <RoutineField htmlFor="routine-instructions" label={t('instructions')}>
          <Textarea
            id="routine-instructions"
            required
            maxLength={20_000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={t('instructionsPlaceholder')}
            className="min-h-32 resize-y"
          />
          <p className="text-xs text-muted-foreground">
            {mode === 'new' ? t('instructionsHintNew') : t('instructionsHintReopen')}
          </p>
        </RoutineField>

        <div className="grid gap-4 border-t border-border/50 pt-4 sm:grid-cols-[2fr_1fr]">
          <RoutineField htmlFor="routine-schedule" label={t('schedule')}>
            <RoutineCronInput
              id="routine-schedule"
              value={scheduleInput}
              onChange={setScheduleInput}
            />
          </RoutineField>
          <RoutineField htmlFor="routine-timezone" label={t('timezone')}>
            <RoutineTimezoneInput id="routine-timezone" value={timezone} onChange={setTimezone} />
          </RoutineField>
        </div>
        {schedule.ok && <RoutineNextRuns cron={schedule.cron} timezone={timezone} />}

        <div className="flex justify-end gap-2 border-t border-border/50 pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={!isValid || saving}>
            {saving
              ? initial
                ? tCommon('saving')
                : t('creating')
              : initial
                ? t('save')
                : t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
