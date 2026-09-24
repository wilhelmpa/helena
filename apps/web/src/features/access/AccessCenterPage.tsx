'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { EmptyState } from '@/components/common/page/EmptyState';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import MailAccountSettings from '@/components/mail/MailAccountSettings';
import ConnectionsContent from '@/features/connections/ConnectionsContent';
import TeamCredentialsSection from '@/features/teams/components/credentials/TeamCredentialsSection';
import { useTeamsQuery } from '@/services/teams.service';
import { soleTeamId } from '@/utils/homeTeamScope';
import { accessPath, manageTeamsPath, type AccessTab } from '@/utils/paths';
import { AccessTabs } from './AccessTabs';
import { AccessLogSection } from './AccessLogSection';
import { GoogleSection } from './google/GoogleSection';

// "Zugänge & Verbindungen": one area for everything that lets Helena and its agents
// reach outside accounts. Google accounts with their services, the mailboxes, the
// credentials (website logins, API keys, SSH keys, secrets), the host's connections and
// one audit log, each a tab in the header row. One grant system covers all of them.
// A sign-in that returned to Helena's callback (Google, an MCP server) lands on its tab
// with the outcome in the address; it is shown once and the address cleaned.
function useCallbackNotice(tab: AccessTab) {
  const router = useRouter();
  const params = useSearchParams();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    const error = params.get('error');
    if (!error && !params.get('connected')) return;
    shown.current = true;
    if (error) toast.error(error);
    router.replace(accessPath(tab));
  }, [params, router, tab]);
}

export default function AccessCenterPage({ tab }: { tab: AccessTab }) {
  const t = useTranslations('access');
  useCallbackNotice(tab);
  const tNav = useTranslations('nav');
  const teams = useTeamsQuery();
  const teamId = soleTeamId(teams.data);
  const leading = <AccessTabs value={tab} />;

  let body;
  if (tab === 'connections') body = <ConnectionsContent leading={leading} />;
  else if (teams.isPending) {
    body = (
      <div className="p-4">
        <ListSkeleton rows={3} rowClassName="h-12" />
      </div>
    );
  } else if (teamId == null) {
    body = (
      <div className="flex h-full flex-col p-4">
        <EmptyState title={tNav('teamScopeRequired')} description={tNav('teamScopeRequiredHint')}>
          <Button asChild size="sm" variant="outline">
            <Link href={manageTeamsPath()}>{tNav('manageTeams')}</Link>
          </Button>
        </EmptyState>
      </div>
    );
  } else if (tab === 'google') body = <GoogleSection teamId={teamId} leading={leading} />;
  else if (tab === 'credentials')
    body = <TeamCredentialsSection teamId={teamId} leading={leading} />;
  else if (tab === 'log') body = <AccessLogSection teamId={teamId} leading={leading} />;
  else {
    body = (
      <SectionPageView title={t('tabs.mail')} description="" wide>
        <MailAccountSettings teamId={teamId} page toolbarStart={leading} />
      </SectionPageView>
    );
  }

  return (
    <Shell globalHome globalTitle={t('title')} autoOpenGlobalChat={false}>
      {body}
    </Shell>
  );
}
