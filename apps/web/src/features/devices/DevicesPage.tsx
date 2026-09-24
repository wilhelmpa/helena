'use client';

import { useTranslations } from 'next-intl';
import SectionPageView from '@/components/common/page/SectionPageView';
import Shell from '@/components/layout/Shell';
import { ApiError } from '@/lib/api/core/client';
import DevicesConflicts from './components/DevicesConflicts';
import DevicesFolderStatus from './components/DevicesFolderStatus';
import DevicesGuide from './components/DevicesGuide';
import DevicesList from './components/DevicesList';
import DevicesNotice from './components/DevicesNotice';
import DevicesPendingList from './components/DevicesPendingList';
import DevicesServerCard from './components/DevicesServerCard';
import DevicesUnavailable from './components/DevicesUnavailable';
import { useDeviceSyncStatus } from './services/deviceSync.service';

export default function DevicesPage() {
  const t = useTranslations('devices');
  const status = useDeviceSyncStatus();
  const data = status.data;
  const forbidden = status.error instanceof ApiError && status.error.status === 403;

  return (
    <Shell globalHome globalTitle={t('title')} autoOpenGlobalChat={false}>
      <SectionPageView title={t('title')} description={t('description')}>
        <div className="flex flex-col gap-4">
          {status.isError ? (
            <DevicesNotice>{t(forbidden ? 'ownerOnly' : 'loadError')}</DevicesNotice>
          ) : null}
          {data && data.state !== 'ready' ? <DevicesUnavailable state={data.state} /> : null}
          {data?.server ? <DevicesServerCard server={data.server} /> : null}
          {data?.state === 'ready' ? (
            <>
              <DevicesPendingList pending={data.pendingDevices} />
              <DevicesFolderStatus folder={data.folder} />
              <DevicesList devices={data.devices} />
              {data.folder ? <DevicesConflicts /> : null}
            </>
          ) : null}
          {forbidden ? null : (
            <DevicesGuide
              lanAddress={data?.server?.lanAddress ?? null}
              collapsed={data?.state === 'ready' && data.devices.length > 0}
            />
          )}
        </div>
      </SectionPageView>
    </Shell>
  );
}
