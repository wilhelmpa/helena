'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  LocalChrome,
  More,
  Page,
  PageTabs,
  PageToolbarSpacer,
  Section,
  Stack,
} from '@/design-system';
import { helenaSettingsPath } from './settingsModalCatalog';

// Helena › Einstellungen › Benachrichtigungen & Kanäle (owner, 28.09.): E-Mail-Versand and
// Telegram were pages of their own and tabs of "Benachrichtigungswege" again. One page, one
// tab per channel: the installation's sender (mail) or bot (Telegram) first — everything
// goes through it — and the team's own sender or bot, which only overrides it, folded
// under "Mehr". Each block saves on its own, in place.
const GodEmail = dynamic(() => import('@/features/god/GodEmailPage'));
const GodTelegram = dynamic(() => import('@/features/god/GodTelegramPage'));
const TeamChannels = dynamic(
  () => import('@/features/teams/components/notifications/TeamNotificationsSection'),
);

type Channel = 'email' | 'telegram';

export default function ChannelsSettings({ teamId, tab }: { teamId: number; tab?: string }) {
  const t = useTranslations('settings.channels');
  const current: Channel = tab === 'telegram' ? 'telegram' : 'email';
  return (
    <Page
      toolbar={
        <>
          <PageTabs<Channel>
            label={t('label')}
            value={current}
            items={(['email', 'telegram'] as const).map((value) => ({
              value,
              label: t(`tabs.${value}`),
              href: helenaSettingsPath('channels', value),
            }))}
          />
          <PageToolbarSpacer />
        </>
      }
    >
      <LocalChrome>
        <Stack gap={6}>
          <Section
            title={t(`${current}.installation`)}
            description={t(`${current}.installationHint`)}
          >
            {current === 'email' ? <GodEmail /> : <GodTelegram />}
          </Section>
          {teamId > 0 && (
            <More label={t(`${current}.team`)}>
              <TeamChannels teamId={teamId} channel={current} />
            </More>
          )}
        </Stack>
      </LocalChrome>
    </Page>
  );
}
