'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import type { PushDevice, PushOverview } from '@/lib/api/endpoints/push';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/utils/dates';
import AccountSection from '@/features/account/components/AccountSection';
import AccountPreferenceRow from '@/features/account/components/preferences/AccountPreferenceRow';
import { usePushMutations } from '../services/push.service';
import { PushPermissionError } from '../services/pushBrowser';
import { useCategoryText } from '../utils/categoryText';
import type { PushSupport } from '../utils/pushSupport';
import PushHint, { type PushHintKind } from './PushHint';

// Konto → Benachrichtigungen, "Push auf diesem Gerät": the switch for this browser, its
// categories once it is on, and a test message.
export default function PushThisDeviceSection({
  support,
  overview,
  device,
  onTest,
}: {
  support: PushSupport | null;
  overview: PushOverview | undefined;
  device: PushDevice | undefined;
  onTest: (device: PushDevice) => void;
}) {
  const t = useTranslations('account.notifications.thisDevice');
  const tHints = useTranslations('account.notifications.hints');
  const text = useCategoryText();
  const { enable, disable, update } = usePushMutations();

  const publicKey = overview?.publicKey ?? null;
  const hint: PushHintKind | null =
    support === null
      ? null
      : support !== 'supported'
        ? support
        : overview && !publicKey
          ? 'noKey'
          : null;
  const busy = enable.isPending || disable.isPending;
  const on = Boolean(device);

  const toggle = (next: boolean) => {
    if (next) {
      if (!publicKey) return;
      enable.mutate(
        { publicKey },
        {
          onSuccess: () => toast.success(t('enabled')),
          onError: (error) =>
            toast.error(
              error instanceof PushPermissionError
                ? tHints('denied.title')
                : t('enableFailed', { error: error instanceof Error ? error.message : '' }),
            ),
        },
      );
    } else {
      disable.mutate(device?.id ?? null, { onSuccess: () => toast.success(t('disabled')) });
    }
  };

  const status = !on
    ? t('off')
    : device?.lastSuccessAt
      ? t('lastDelivered', { when: formatDateTime(device.lastSuccessAt) })
      : t('never');

  return (
    <AccountSection
      title={t('title')}
      description={t('description')}
      flush
      actions={
        device ? (
          <Button variant="outline" size="sm" onClick={() => onTest(device)}>
            <Send className="size-4" />
            {t('test')}
          </Button>
        ) : undefined
      }
    >
      {hint && <PushHint kind={hint} />}
      <AccountPreferenceRow label={t('switch')} description={status}>
        <Switch
          checked={on}
          disabled={hint !== null || support === null || !overview || busy}
          onCheckedChange={toggle}
          aria-label={t('switch')}
        />
      </AccountPreferenceRow>
      {device &&
        (overview?.categories ?? []).map((category) => (
          <AccountPreferenceRow
            key={category.id}
            label={text(category.label)}
            description={text(category.description)}
          >
            <Switch
              checked={device.categories[category.id] === true}
              onCheckedChange={(checked) =>
                update.mutate({ id: device.id, categories: { [category.id]: checked } })
              }
              aria-label={text(category.label)}
            />
          </AccountPreferenceRow>
        ))}
    </AccountSection>
  );
}
