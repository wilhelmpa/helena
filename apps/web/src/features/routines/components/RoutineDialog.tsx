import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type {
  Routine,
  RoutineCatchUp,
  RoutineGateMode,
  RoutineGateSource,
  RoutineInput,
  RoutineMode,
} from '@/lib/api/endpoints/routines';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import { useEngineSettings } from '@/services/engine.service';
import { parseScheduleInput } from '../utils/cronSchedule';
import { DEFAULT_TIMEZONE, isTimeZone } from '../utils/schedulePreview';
import { RoutineAgentField } from './RoutineAgentField';
import { RoutineCronInput } from './RoutineCronInput';
import { RoutineField } from './RoutineField';
import { RoutineGateField } from './RoutineGateField';
import { RoutineMentionsPreview } from './RoutineMentions';
import { RoutineModeField } from './RoutineModeField';
import { RoutineNextRuns } from './RoutineNextRuns';
import type { RoutineTask } from './RoutineTaskField';
import { RoutineTimezoneInput } from './RoutineTimezoneInput';
import { Box, Inline, Stack, Text, FieldFrame } from '@/design-system';

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
  const [scheduleInput, setScheduleInput] = useState(initial?.cron ?? '0 9 * * 1-5');
  // A new routine runs in the instance's time zone unless it names another.
  const defaultZone = useEngineSettings().data?.defaultTimezone ?? DEFAULT_TIMEZONE;
  const [chosenZone, setTimezone] = useState<string | null>(initial?.timezone ?? null);
  const timezone = chosenZone ?? defaultZone;
  const [catchUp, setCatchUp] = useState<RoutineCatchUp>(initial?.catchUp ?? 'skip');
  const [gateMode, setGateMode] = useState<RoutineGateMode>(initial?.gateMode ?? 'shadow');
  const [gateSource, setGateSource] = useState<RoutineGateSource>(initial?.gateSource ?? 'none');
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
    isTimeZone(timezone) &&
    (gateMode !== 'active' || gateSource !== 'none');

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
      catchUp,
      gateMode,
      gateSource,
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
      <Stack
        as="form"
        gap={4}

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

        {/* Markdown like the task it becomes, and "@" offers the project's agents: each
            agent it mentions starts on the task too, on every run. */}
        <RoutineField label={t('instructions')}>
          <FieldFrame area className="max-h-72 min-h-32 overflow-y-auto text-sm">
            <MarkdownEditor
              className="flex min-h-28 flex-col"
              defaultValue={initial?.instructions ?? ''}
              onChange={setInstructions}
              placeholder={t('instructionsPlaceholder')}
              ariaLabel={t('instructions')}
            />
          </FieldFrame>
          <Text as="p" size="xs" tone="muted">
            {mode === 'new' ? t('instructionsHintNew') : t('instructionsHintReopen')}{' '}
            {t('mentionsHint')}
          </Text>
          <RoutineMentionsPreview
            projectKey={projectKey}
            instructions={instructions}
            agentId={agent?.id ?? null}
          />
        </RoutineField>

        <Box padTop={4} className="grid gap-4 border-t border-border/50 sm:grid-cols-[2fr_1fr]">
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
        </Box>
        {schedule.ok && <RoutineNextRuns cron={schedule.cron} timezone={timezone} />}
        <RoutineField htmlFor="routine-catch-up" label={t('catchUp')}>
          <Select value={catchUp} onValueChange={(value) => setCatchUp(value as RoutineCatchUp)}>
            <SelectTrigger id="routine-catch-up" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">{t('catchUpSkip')}</SelectItem>
              <SelectItem value="once">{t('catchUpOnce')}</SelectItem>
            </SelectContent>
          </Select>
          <Text as="p" size="xs" tone="muted">
            {t('catchUpHint')}
          </Text>
        </RoutineField>

        <RoutineGateField
          mode={gateMode}
          source={gateSource}
          onModeChange={setGateMode}
          onSourceChange={(source) => {
            setGateSource(source);
            if (gateMode === 'active') setGateMode('shadow');
          }}
        />

        <Inline
          gap={2}
          padTop={4}
          justify="end"
          align="stretch"
          className="border-t border-border/50"
        >
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
        </Inline>
      </Stack>
    </Modal>
  );
}
