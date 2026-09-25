'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { PushDevice } from '@/lib/api/endpoints/push';
import SectionPageView from '@/components/common/page/SectionPageView';
import {
  thisDevice,
  useLocalPushSubscription,
  usePushMutations,
  usePushOverview,
  usePushSupport,
} from './services/push.service';
import PushDevicesSection from './components/PushDevicesSection';
import PushThisDeviceSection from './components/PushThisDeviceSection';

// Konto → Benachrichtigungen (docs/helena-decisions/push.md): Web Push to this browser and
// the person's other devices, with the kinds of messages each one receives.
export default function AccountNotificationsPage() {
  const t = useTranslations('account.notifications');
  const support = usePushSupport();
  const overview = usePushOverview();
  const local = useLocalPushSubscription(support === 'supported');
  const { test } = usePushMutations();
  const device = thisDevice(overview.data, local.data?.endpoint);

  const sendTest = (target: PushDevice) =>
    test.mutate(target.id, {
      onSuccess: (result) => {
        if (result.ok) toast.success(t('thisDevice.testSent'));
        else if (result.gone) toast.error(t('devices.gone'));
        else toast.error(t('thisDevice.testFailed', { error: result.error ?? '' }));
      },
    });

  return (
    <SectionPageView title={t('title')}>
      <div className="space-y-6">
        <PushThisDeviceSection
          support={support}
          overview={overview.data}
          device={device}
          onTest={sendTest}
        />
        <PushDevicesSection overview={overview.data} currentId={device?.id} onTest={sendTest} />
      </div>
    </SectionPageView>
  );
}
