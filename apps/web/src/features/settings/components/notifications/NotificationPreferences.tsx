import { type ReactNode } from 'react';
import { Mail, Send } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import SettingsSection from '@/components/common/page/SettingsSection';
import NotificationTelegramAccount from './NotificationTelegramAccount';
import { NOTIFICATION_EVENTS } from '../../utils/notificationEvents';
import type { NotificationPreferencesForm } from '../../hooks/useNotificationPreferencesForm';
import { useTranslations } from 'next-intl';

import { Inline, Stack, Text, Card } from '@/design-system';

// A member's own notification preferences for the project: for each issue event, a
// checkbox per channel (email, Telegram). Visible to every member (each edits only
// their own). Email is sent to the account address; Telegram to the account connected
// in the member's profile, shown below. Delivery only happens for channels a project
// owner has configured. Save lives in the page header.

// Shared column template so the header labels line up with every event row.
const COLS = 'grid grid-cols-[1fr_5rem_5rem] items-center';

export default function NotificationPreferences({ form }: { form: NotificationPreferencesForm }) {
  const t = useTranslations('settings.notifications');
  const { emailEvents, setEmailEvents, telegramEvents, setTelegramEvents } = form;
  return (
    <Stack gap={5} className="flex flex-col">
      <SettingsSection title={t('eventsTitle')}>
        <Card pad="none" className="max-w-xl overflow-hidden">
          <div className={`${COLS} h-8 border-b px-3`}>
            <span />
            <ChannelHeader icon={<Mail className="size-3.5" />} label={t('email')} />
            <ChannelHeader icon={<Send className="size-3.5" />} label={t('telegram')} />
          </div>
          <div className="flex flex-col divide-y">
            {NOTIFICATION_EVENTS.map((event) => (
              <ChannelRow
                key={event}
                label={t(`events.${event}`)}
                emailChecked={emailEvents[event]}
                telegramChecked={telegramEvents[event]}
                onEmail={(v) => setEmailEvents({ ...emailEvents, [event]: v })}
                onTelegram={(v) => setTelegramEvents({ ...telegramEvents, [event]: v })}
              />
            ))}
          </div>
        </Card>
      </SettingsSection>

      <NotificationTelegramAccount />
    </Stack>
  );
}

function ChannelHeader({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <Inline as="span" gap={2} justify="center">
      <Text as="span" size="xs" tone="muted">
        {icon}
      </Text>
      <Text as="span" size="xs" tone="muted">
        {label}
      </Text>
    </Inline>
  );
}

function ChannelRow({
  label,
  emailChecked,
  telegramChecked,
  onEmail,
  onTelegram,
}: {
  label: string;
  emailChecked: boolean;
  telegramChecked: boolean;
  onEmail: (value: boolean) => void;
  onTelegram: (value: boolean) => void;
}) {
  return (
    <div className={`${COLS} min-h-10 px-3 py-1.5`}>
      <Text as="span" size="sm">
        {label}
      </Text>
      <div className="flex justify-center">
        <Checkbox
          checked={emailChecked}
          onCheckedChange={(v) => onEmail(v === true)}
          aria-label={`${label} — email`}
        />
      </div>
      <div className="flex justify-center">
        <Checkbox
          checked={telegramChecked}
          onCheckedChange={(v) => onTelegram(v === true)}
          aria-label={`${label} — Telegram`}
        />
      </div>
    </div>
  );
}
