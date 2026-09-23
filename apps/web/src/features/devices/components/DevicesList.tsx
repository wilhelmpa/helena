import { useTranslations } from 'next-intl';
import type { SyncDevice } from '@/lib/api/endpoints/deviceSync';
import DevicesRow from './DevicesRow';
import DevicesSection from './DevicesSection';

export default function DevicesList({ devices }: { devices: SyncDevice[] }) {
  const t = useTranslations('devices.devices');
  return (
    <DevicesSection title={t('title')}>
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y">
          {devices.map((device) => (
            <DevicesRow key={device.deviceId} device={device} />
          ))}
        </ul>
      )}
    </DevicesSection>
  );
}
