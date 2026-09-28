import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_TIMEZONE, isTimeZone } from '../utils/schedulePreview';
import { RoutineSuggestionsInput, type InputSuggestion } from './RoutineSuggestionsInput';
import { Text } from '@/design-system';

// Every IANA zone the browser knows, offered as the name is typed.
const ZONES: InputSuggestion[] = [
  ...new Set([
    DEFAULT_TIMEZONE,
    'UTC',
    ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []),
  ]),
].map((zone) => ({ value: zone, label: zone }));

export function RoutineTimezoneInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('routines');
  const messageId = useId();
  const valid = isTimeZone(value);
  return (
    <>
      <RoutineSuggestionsInput
        id={id}
        required
        maxLength={80}
        value={value}
        suggestions={ZONES}
        onValueChange={onChange}
        triggerLabel={t('showTimezones')}
        aria-invalid={!valid}
        aria-describedby={messageId}
      />
      <Text as="span" size="xs" tone="danger" id={messageId} className="block" aria-live="polite">
        {valid ? null : t('invalidTimezone')}
      </Text>
    </>
  );
}
