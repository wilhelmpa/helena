'use client';

import { Globe } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import SectionPageView from '@/components/common/page/SectionPageView';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PageSelect, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import {
  useBrowserGatewayOverviewQuery,
  useBrowserRouterOverviewQuery,
} from '@/features/browser-gateway/services/browserGateway.service';
import type { LabScope } from '@/lib/api/endpoints/browserTask';
import { useTeamsQuery } from '@/services/teams.service';
import { HOME_BROWSER_SLUG } from '@/utils/browserOverview';
import { soleTeamId } from '@/utils/homeTeamScope';
import BrowserLab from './components/BrowserLab';
import { BrowserPageTabs } from './components/BrowserPageTabs';

const HOME = 'home';

// Home → Browser → Browser 2.0: the same test area for Home's own browser (as the Home-Master)
// or any project browser the reader works in, picked in the header.
export default function HomeBrowserLabPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('browserLab');
  const teams = useTeamsQuery();
  const projects = useBrowserGatewayOverviewQuery();
  const router = useBrowserRouterOverviewQuery();
  // Home's own browser, when this instance runs one (as the Browser overview shows it).
  const homeRuns = (router.data ?? []).some((state) => state.slug === HOME_BROWSER_SLUG);
  const teamId = homeRuns ? soleTeamId(teams.data) : null;
  const projectList = projects.data?.projects ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? (teamId !== null ? HOME : (projectList[0]?.projectKey ?? HOME));

  const scope: LabScope | null =
    value === HOME
      ? teamId !== null
        ? { kind: 'home', teamId }
        : null
      : { kind: 'project', projectKey: value };

  const options = [
    ...(teamId !== null ? [{ value: HOME, label: t('homeBrowser') }] : []),
    ...projectList.map((project) => ({ value: project.projectKey, label: project.projectName })),
  ];

  return (
    <Shell globalHome globalTitle={tNav('browser')} autoOpenGlobalChat={false}>
      <PageToolbar>
        <BrowserPageTabs value="lab" />
        <PageToolbarSpacer />
        {options.length > 1 && (
          <PageSelect
            label={t('which')}
            icon={Globe}
            value={value}
            onChange={setPicked}
            options={options}
          />
        )}
      </PageToolbar>
      <SectionPageView title={t('title')} wide>
        {teams.isPending || projects.isPending || router.isPending ? (
          <ListSkeleton rows={3} rowClassName="h-24" />
        ) : scope === null ? (
          <EmptyState title={t('noBrowser')} description={t('noBrowserHint')} />
        ) : (
          <BrowserLab key={value} scope={scope} />
        )}
      </SectionPageView>
    </Shell>
  );
}
