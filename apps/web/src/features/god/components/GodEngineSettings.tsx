'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { EngineSettingsAdmin } from '@/lib/api/endpoints/god';
import { useUpdateEngineSettingsAdmin } from '../services/god.service';

import { Inline } from '@/design-system';

// Every IANA zone the browser knows, offered as the name is typed.
const ZONES =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value.length > 0;
  } catch {
    return false;
  }
}

// The Helena engine's instance settings: the time zone routines, workflow schedules and
// wait steps use when they name none. Without one set here it is the server's.
export default function GodEngineSettings({ settings }: { settings: EngineSettingsAdmin }) {
  const t = useTranslations('god.general');
  const tCommon = useTranslations('common');
  const update = useUpdateEngineSettingsAdmin();
  const listId = useId();
  const [zone, setZone] = useState(settings.defaultTimezone);
  const valid = isTimeZone(zone.trim());

  async function save(next: string | null) {
    try {
      const saved = await update.mutateAsync(next);
      setZone(saved.defaultTimezone);
      toast.success(t('savedTimezone'));
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  return (
    <SettingsSection title={t('engine')}>
      <SettingsCard>
        <SettingsRow
          title={t('timezone')}
          description={t('timezoneHint', { server: settings.serverTimezone })}
          control={
            <Inline gap={2} justify="end" wrap className="flex flex-wrap items-center justify-end">
              <Input
                className="w-48"
                dir="ltr"
                list={listId}
                maxLength={80}
                value={zone}
                disabled={update.isPending}
                aria-label={t('timezone')}
                aria-invalid={!valid}
                onChange={(event) => setZone(event.target.value)}
              />
              <datalist id={listId}>
                {ZONES.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <Button
                size="sm"
                variant="outline"
                disabled={!valid || update.isPending || zone.trim() === settings.defaultTimezone}
                onClick={() => void save(zone.trim())}
              >
                {update.isPending ? tCommon('saving') : tCommon('save')}
              </Button>
              {settings.timezoneSet && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={update.isPending}
                  onClick={() => void save(null)}
                >
                  {t('timezoneServer')}
                </Button>
              )}
            </Inline>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
