'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { EmptyState } from '@/components/common/page/EmptyState';
import GodSectionPage from '@/features/god/components/GodSectionPage';
import { serverPath } from '@/utils/paths';
import BackupTab from './components/BackupTab';
import DisksTab from './components/DisksTab';
import OverviewTab from './components/OverviewTab';
import PowerTab from './components/PowerTab';
import ServerToolbar from './components/ServerToolbar';
import { useServerOverview } from './services/server.service';
import { UPDATES_TAB } from './updatesTab';
import { availableTabs, isServerTab, type ServerTab } from './utils/serverFormat';

// Administrator → Server (docs/helena-decisions/server-admin.md): the machine Helena runs on.
// One route per tab; a tab this host does not offer (no host helper, a container) is not
// shown, and a link to one lands on the first tab there is.
export default function ServerPage({ tab }: { tab: string }) {
  const t = useTranslations('server');
  const router = useRouter();
  const overview = useServerOverview();
  const tabs = availableTabs(overview.data, UPDATES_TAB.built);
  const current: ServerTab | null = isServerTab(tab) && tabs.includes(tab) ? tab : null;

  useEffect(() => {
    if (overview.data && !current && tabs[0]) router.replace(serverPath(tabs[0]));
  }, [overview.data, current, tabs, router]);

  let body;
  if (overview.isPending) {
    body = <ListSkeleton rows={4} rowClassName="h-16" />;
  } else if (tabs.length === 0) {
    body = (
      <>
        <ServerToolbar tab="overview" tabs={[]} />
        <EmptyState
          title={t('unavailable.title')}
          description={
            overview.data?.helper.reason === 'Unavailable' || overview.isError
              ? t('unavailable.noHelper')
              : t('unavailable.failed')
          }
        />
      </>
    );
  } else if (!current) {
    body = <ListSkeleton rows={4} rowClassName="h-16" />;
  } else if (current === 'overview') {
    body = <OverviewTab tabs={tabs} />;
  } else if (current === 'disks') {
    body = <DisksTab tabs={tabs} />;
  } else if (current === 'backup') {
    body = <BackupTab tabs={tabs} />;
  } else if (current === 'power') {
    body = <PowerTab tabs={tabs} />;
  } else {
    const Body = UPDATES_TAB.Body;
    const Action = UPDATES_TAB.Action;
    body = (
      <>
        <ServerToolbar tab="updates" tabs={tabs} extra={Action ? <Action /> : null} />
        {Body ? <Body /> : null}
      </>
    );
  }

  return (
    <GodSectionPage slug="server" widthClassName="w-full">
      {body}
    </GodSectionPage>
  );
}
