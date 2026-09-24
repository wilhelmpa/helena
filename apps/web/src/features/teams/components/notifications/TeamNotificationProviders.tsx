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
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useEmailForm } from '../../hooks/useEmailForm';
import { useTelegramForm } from '../../hooks/useTelegramForm';
import EmailSettings from './EmailSettings';
import TelegramSettings from './TelegramSettings';

type NotificationTab = 'email' | 'telegram';

// One tab per channel, each saving on its own: the channel tabs and Save sit in the
// header's toolbar row; Save acts on the active tab and is enabled once that tab has
// an unsaved change.
export default function TeamNotificationProviders({
  teamId,
  settings,
}: {
  teamId: number;
  settings: NotificationSettings;
}) {
  const t = useTranslations('teams.notifications');
  const tCommon = useTranslations('common');
  const [tab, setTab] = useState<NotificationTab>('email');
  const emailForm = useEmailForm(teamId, settings);
  const telegramForm = useTelegramForm(teamId, settings);
  const active = tab === 'email' ? emailForm : telegramForm;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as NotificationTab)} className="gap-0">
      <PageToolbar>
        <PageTabs<NotificationTab>
          label={t('email')}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'email', label: t('email'), icon: Mail },
            { value: 'telegram', label: t('telegram'), icon: Send },
          ]}
        />
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

      <TabsContent value="email" className="mt-0">
        <EmailSettings form={emailForm} />
      </TabsContent>

      <TabsContent value="telegram" className="mt-0">
        <TelegramSettings form={telegramForm} />
      </TabsContent>
    </Tabs>
  );
}
