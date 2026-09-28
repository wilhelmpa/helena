import { Input } from '@/components/ui/input';
import { useTranslations } from 'next-intl';
import { SettingsRow } from '@/design-system';

// How long a triggered run waits before the agent may pick it up, in minutes. Both
// the delegation trigger and each field trigger carry one.
export function AgentDelayInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('teams.agents');
  return (
    <SettingsRow label={t('runDelay')} description={t('runDelayHint')} htmlFor={id} nested>
      <span className="ds-inline-unit">
        <Input
          id={id}
          type="number"
          step="1"
          min="0"
          max="1440"
          className="w-20"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {t('minutes')}
      </span>
    </SettingsRow>
  );
}
