import { useId } from 'react';
import { RoutineSuggestionsInput, type InputSuggestion } from './RoutineSuggestionsInput';
import { useTranslations } from 'next-intl';
import { parseScheduleInput } from '../utils/cronSchedule';
import { useCronDescription } from '../hooks/useCronDescription';

// A preset writes its cron expression into the input, which reads the same in every
// language; its label and the line under the input are in the reader's.
const SCHEDULE_PRESETS = [
  { value: '*/15 * * * *', labelKey: 'presetEvery15Minutes' },
  { value: '0 * * * *', labelKey: 'presetEveryHour' },
  { value: '0 9 * * 1-5', labelKey: 'presetEveryWeekdayAt9' },
  { value: '0 9 * * *', labelKey: 'presetEveryDayAt9' },
] as const;

export function RoutineCronInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('routines');
  const describe = useCronDescription();
  const result = parseScheduleInput(value);
  const messageId = useId();
  const scheduleSuggestions: InputSuggestion[] = SCHEDULE_PRESETS.map((preset) => ({
    value: preset.value,
    label: t(preset.labelKey),
    description: preset.value,
  }));

  return (
    <>
      <RoutineSuggestionsInput
        id={id}
        required
        maxLength={120}
        value={value}
        suggestions={scheduleSuggestions}
        onValueChange={onChange}
        triggerLabel={t('showPresets')}
        placeholder={t('inputPlaceholder')}
        aria-invalid={!result.ok}
        aria-describedby={messageId}
      />
      <span
        id={messageId}
        className={
          result.ok ? 'block text-xs text-muted-foreground' : 'block text-xs text-destructive'
        }
        aria-live="polite"
      >
        {result.ok
          ? successMessage(result, describe(result.cron) ?? result.cron, t)
          : t('invalidSchedule')}
      </span>
    </>
  );
}

function successMessage(
  result: Extract<ReturnType<typeof parseScheduleInput>, { ok: true }>,
  description: string,
  t: ReturnType<typeof useTranslations<'routines'>>,
): React.ReactNode {
  if (result.source === 'cron') return t('runs', { description });
  return (
    <>
      {t('cronLabel')} <code className="font-mono">{result.cron}</code> ·{' '}
      {t('runsSuffix', { description })}
    </>
  );
}
