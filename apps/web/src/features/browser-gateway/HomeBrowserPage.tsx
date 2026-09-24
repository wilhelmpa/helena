'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import SectionPageView from '@/components/common/page/SectionPageView';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { projectPath } from '@/utils/paths';
import { HOME_BROWSER_SLUG } from '@/utils/browserOverview';
import ProjectBrowserTile from './components/ProjectBrowserTile';
import {
  useBrowserGatewayOverviewQuery,
  useBrowserRouterOverviewQuery,
} from './services/browserGateway.service';

// Home's "Browser" overview (design volition-design-browser-gateway.md §5, §8): a tile per
// project browser — a picture of its tab in front, the page, who controls it, and whether
// an agent waits for the owner. A tile opens that browser's live view. Home's own browser
// comes first, then the projects the caller works in.
export default function HomeBrowserPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('browserGateway');
  const projects = useBrowserGatewayOverviewQuery();
  const router = useBrowserRouterOverviewQuery();
  const states = new Map((router.data ?? []).map((state) => [state.slug, state]));
  const version = router.dataUpdatedAt;

  const tiles = [
    ...(states.has(HOME_BROWSER_SLUG)
      ? [
          {
            key: HOME_BROWSER_SLUG,
            name: t('homeBrowser'),
            href: '/?tool=browser',
            slug: HOME_BROWSER_SLUG,
          },
        ]
      : []),
    ...(projects.data?.projects ?? [])
      .filter((project) => states.has(project.slug) || router.isError)
      .map((project) => ({
        key: project.projectKey,
        name: project.projectName,
        href: `${projectPath(project.projectKey)}?tool=browser`,
        slug: project.slug,
      })),
  ];

  return (
    <Shell globalHome globalTitle={tNav('browser')} autoOpenGlobalChat={false}>
      <SectionPageView title={t('homeTitle')} description={t('homeDescription')} wide>
        {projects.isPending || router.isPending ? (
          <ListSkeleton rows={2} rowClassName="h-48" />
        ) : tiles.length === 0 ? (
          <EmptyState title={t('empty')} description={t('emptyHint')} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3">
            {tiles.map((tile) => (
              <ProjectBrowserTile
                key={tile.key}
                name={tile.name}
                href={tile.href}
                slug={tile.slug}
                state={states.get(tile.slug) ?? null}
                version={version}
              />
            ))}
          </div>
        )}
      </SectionPageView>
    </Shell>
  );
}
