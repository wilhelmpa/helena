'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { PageSelect } from '@/components/layout/PageToolbar';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import MailAccountSettings from '@/components/mail/MailAccountSettings';
import { useTeamsQuery } from '@/services/teams.service';

// Home settings: the mail accounts of the team and the rules that file its mail. With
// several teams the team is chosen in the header row.
export default function MailAccountsPage() {
  const t = useTranslations('nav');
  const tMail = useTranslations('mail.accounts');
  const teams = useTeamsQuery();
  const [teamId, setTeamId] = useState<number | null>(null);
  const current = teamId ?? teams.data?.[0]?.id ?? null;
  return (
    <Shell globalHome globalTitle={t('mailAccounts')} autoOpenGlobalChat={false}>
      <SectionPageView title={t('mailAccounts')} description={tMail('intro')} wide>
        {teams.isPending ? (
          <ListSkeleton rows={3} rowClassName="h-12" />
        ) : current != null ? (
          <MailAccountSettings
            key={current}
            teamId={current}
            page
            toolbarStart={
              (teams.data?.length ?? 0) > 1 ? (
                <PageSelect
                  label={tMail('team')}
                  icon={Users}
                  value={String(current)}
                  onChange={(value) => setTeamId(Number(value))}
                  options={(teams.data ?? []).map((team) => ({
                    value: String(team.id),
                    label: team.name,
                  }))}
                />
              ) : null
            }
          />
        ) : null}
      </SectionPageView>
    </Shell>
  );
}
