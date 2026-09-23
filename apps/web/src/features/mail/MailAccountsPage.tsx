'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import MailAccountSettings from '@/components/mail/MailAccountSettings';
import { useTeamsQuery } from '@/services/teams.service';

// Home settings: the mail accounts of the team and the rules that file its mail.
export default function MailAccountsPage() {
  const t = useTranslations('nav');
  const teams = useTeamsQuery();
  const [teamId, setTeamId] = useState<number | null>(null);
  const current = teamId ?? teams.data?.[0]?.id ?? null;
  return (
    <Shell globalHome globalTitle={t('mailAccounts')} autoOpenGlobalChat={false}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
        {(teams.data?.length ?? 0) > 1 && (
          <select
            className="h-8 self-start rounded-md border bg-background px-2 text-sm"
            value={current ?? ''}
            onChange={(event) => setTeamId(Number(event.target.value))}
          >
            {teams.data?.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        )}
        {current != null && <MailAccountSettings key={current} teamId={current} />}
      </div>
    </Shell>
  );
}
