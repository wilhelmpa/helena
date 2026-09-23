import { useTranslations } from 'next-intl';
import type { DeviceSyncStatus } from '@/lib/api/endpoints/deviceSync';
import DevicesNotice from './DevicesNotice';

// Syncthing answers the API only once the package is installed and its setup has run.
export default function DevicesUnavailable({
  state,
}: {
  state: Exclude<DeviceSyncStatus['state'], 'ready'>;
}) {
  const t = useTranslations('devices.unavailable');
  return (
    <DevicesNotice title={t(`${state}Title`)}>
      {t.rich(state, { code: (chunks) => <code className="text-xs">{chunks}</code> })}
    </DevicesNotice>
  );
}
