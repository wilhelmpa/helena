import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useRelativeTime } from '@/context/relativeTimeContext';
import type { PendingDevice } from '@/lib/api/endpoints/deviceSync';
import { useAcceptDevice } from '../services/deviceSync.service';
import { deviceName } from '../utils/deviceName';
import DevicesSection from './DevicesSection';

export default function DevicesPendingList({ pending }: { pending: PendingDevice[] }) {
  const t = useTranslations('devices.pending');
  const relativeTime = useRelativeTime();
  const accept = useAcceptDevice();
  if (pending.length === 0) return null;

  return (
    <DevicesSection title={t('title')} hint={t('hint')}>
      <ul className="divide-y">
        {pending.map((device) => (
          <li
            key={device.deviceId}
            className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{deviceName(device)}</p>
              <code dir="ltr" className="block text-xs break-all text-muted-foreground">
                {device.deviceId}
              </code>
              {device.requestedAt ? (
                <p className="text-xs text-muted-foreground">
                  {t('requested', {
                    time: relativeTime(device.requestedAt),
                    address: device.address,
                  })}
                </p>
              ) : null}
            </div>
            <Button size="sm" disabled={accept.isPending} onClick={() => accept.mutate(device)}>
              {t('accept')}
            </Button>
          </li>
        ))}
      </ul>
    </DevicesSection>
  );
}
