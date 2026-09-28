import { useTranslations } from 'next-intl';
import SettingsRow from '@/components/common/page/SettingsRow';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

import { Inline, Text } from '@/design-system';

// One state group's auto-archive threshold: the switch that turns archiving on for
// the group and the day count it waits. The day count stays visible while the group
// is off, disabled, so the stored value is still readable.
export default function SettingsAutoArchiveRow({
  title,
  description,
  on,
  days,
  editable,
  onToggle,
  onDays,
}: {
  title: string;
  description: string;
  on: boolean;
  days: string;
  editable: boolean;
  onToggle: (v: boolean) => void;
  onDays: (v: string) => void;
}) {
  const t = useTranslations('settings.configuration');

  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <Inline gap={3} className="flex shrink-0 items-center">
          <Input
            type="number"
            min={1}
            value={days}
            onChange={(e) => onDays(e.target.value)}
            disabled={!editable || !on}
            className="h-8 w-20"
            aria-label={`${title}: ${t('days')}`}
          />
          <Text as="span" size="xs" tone="muted">
            {t('days')}
          </Text>
          <Switch aria-label={title} checked={on} onCheckedChange={onToggle} disabled={!editable} />
        </Inline>
      }
    />
  );
}
