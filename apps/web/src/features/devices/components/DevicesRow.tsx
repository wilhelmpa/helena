import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useRelativeTime } from '@/context/relativeTimeContext';
import type { SyncDevice } from '@/lib/api/endpoints/deviceSync';
import { cn } from '@/lib/utils';
import { useRemoveDevice } from '../services/deviceSync.service';
import { deviceName } from '../utils/deviceName';

export default function DevicesRow({ device }: { device: SyncDevice }) {
  const t = useTranslations('devices.devices');
  const relativeTime = useRelativeTime();
  const remove = useRemoveDevice();
  const [confirming, setConfirming] = useState(false);
  const name = deviceName(device);

  let state: 'paused' | 'connected' | 'disconnected' = 'disconnected';
  if (device.paused) state = 'paused';
  else if (device.connected) state = 'connected';

  let seen = t('neverSeen');
  if (device.connected) seen = device.address ?? '';
  else if (device.lastSeenAt) seen = t('lastSeen', { time: relativeTime(device.lastSeenAt) });

  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          state === 'connected' ? 'bg-emerald-500' : 'bg-muted-foreground/40',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {name}{' '}
          <code dir="ltr" className="text-xs font-normal text-muted-foreground">
            {device.deviceId.split('-')[0]}
          </code>
        </p>
        <p className="text-xs text-muted-foreground">
          {t(state)} · {seen}
        </p>
        {device.sharesFolder ? null : (
          <p className="text-xs text-amber-700 dark:text-amber-300">{t('notShared')}</p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        {t('remove')}
      </Button>
      {confirming ? (
        <ConfirmDialog
          title={t('removeTitle', { name })}
          confirmLabel={t('remove')}
          onConfirm={async () => {
            await remove.mutateAsync(device.deviceId);
            setConfirming(false);
          }}
          onClose={() => setConfirming(false)}
        >
          <p className="text-sm text-muted-foreground">{t('removeBody')}</p>
        </ConfirmDialog>
      ) : null}
    </li>
  );
}
