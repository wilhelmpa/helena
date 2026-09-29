'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { NotificationSettings } from '@/lib/api/endpoints/notificationSettings';
import { Check, Mail, Send } from 'lucide-react';
import {
  PageActions,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import { useEmailForm } from '../../hooks/useEmailForm';
import { useTelegramForm } from '../../hooks/useTelegramForm';
import EmailSettings from './EmailSettings';
import TelegramSettings from './TelegramSettings';

export type NotificationTab = 'email' | 'telegram';

// One tab per channel, each saving on its own: the channel tabs and Save sit in the
// header's toolbar row; Save acts on the active tab and is enabled once that tab has
// an unsaved change.
export default function TeamNotificationProviders({
  teamId,
  settings,
  channel,
}: {
  teamId: number;
  settings: NotificationSettings;
  // One channel only, without the tabs (Benachrichtigungen & Kanäle has its own).
  channel?: NotificationTab;
}) {
  const t = useTranslations('teams.notifications');
  const tCommon = useTranslations('common');
  const [ownTab, setTab] = useState<NotificationTab>('email');
  const tab = channel ?? ownTab;
  const emailForm = useEmailForm(teamId, settings);
  const telegramForm = useTelegramForm(teamId, settings);
  const active = tab === 'email' ? emailForm : telegramForm;

  return (
    <>
      <PageToolbar>
        {!channel && (
          <PageTabs<NotificationTab>
            label={t('email')}
            value={tab}
            onChange={setTab}
            items={[
              { value: 'email', label: t('email'), icon: Mail },
              { value: 'telegram', label: t('telegram'), icon: Send },
            ]}
          />
        )}
        <PageToolbarSpacer />
        <PageActions
          primary={{
            id: 'save',
            label: active.saving ? tCommon('saving') : tCommon('save'),
            icon: Check,
            onClick: () => void active.save(),
            disabled: !active.dirty || active.saving,
          }}
        />
      </PageToolbar>

      {tab === 'email' ? (
        <EmailSettings form={emailForm} />
      ) : (
        <TelegramSettings form={telegramForm} />
      )}
    </>
  );
}
