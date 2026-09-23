import { useTranslations } from 'next-intl';
import { Check, Minus } from 'lucide-react';

// The state of a setting for a reader who may not change it, in the row its control
// would take.
export function TeamSettingState({ on }: { on: boolean }) {
  const t = useTranslations('teams.settingState');
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
      {on ? <Check className="size-4 text-status-success" /> : <Minus className="size-4" />}
      {t(on ? 'on' : 'off')}
    </span>
  );
}
