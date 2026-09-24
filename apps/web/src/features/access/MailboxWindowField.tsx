'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export interface WindowValue {
  all: boolean;
  days: number;
}

// "Abrufzeitraum in Tagen": how far back a mailbox imports, 30 days unless the owner
// says otherwise; switched to "all mail" it imports everything.
export function MailboxWindowField({
  value,
  onChange,
}: {
  value: WindowValue;
  onChange: (value: WindowValue) => void;
}) {
  const t = useTranslations('access.mailbox');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mailbox-days">{t('fetchDays')}</Label>
          <Input
            id="mailbox-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={36500}
            className="w-28"
            disabled={value.all}
            value={value.days}
            onChange={(event) =>
              onChange({
                ...value,
                days: Math.max(1, Math.min(36500, Number(event.target.value) || 1)),
              })
            }
          />
        </div>
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
          <Switch checked={value.all} onCheckedChange={(all) => onChange({ ...value, all })} />
          {t('fetchAll')}
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t('fetchDaysHint')}</p>
    </div>
  );
}
