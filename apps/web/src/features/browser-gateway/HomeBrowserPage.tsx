'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import PageHeader from '@/components/common/page/PageHeader';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import ProjectBrowserTile from './components/ProjectBrowserTile';
import { useBrowserGatewayOverviewQuery } from './services/browserGateway.service';

// Home's "Browser" overview (design volition-design-browser-gateway.md §5, §8: "Home →
// Browser: eine Seite 'Browser' mit einer Kachel pro Projekt-Browser"): one tile per
// project that could have a project browser. Same tile grid as HomePage's own projects.
//
// Known gap: GET /browser-gateway/overview only returns each project's identity today.
// The live fields a tile can show (current URL, who is in control, a thumbnail) come from
// the browser router, which is still being built in parallel — every tile below renders
// with url/controlledBy/thumbnailUrl all null until that HTTP surface exists, showing the
// neutral placeholders ProjectBrowserTile already defines for that case.
export default function HomeBrowserPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('browserGateway');
  const overview = useBrowserGatewayOverviewQuery();
  const projects = overview.data?.projects ?? [];

  return (
    <Shell globalHome globalTitle={tNav('browser')} autoOpenGlobalChat={false}>
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <PageHeader title={t('homeTitle')} description={t('homeDescription')} />
          {overview.isPending ? (
            <ListSkeleton rows={3} rowClassName="h-40" />
          ) : projects.length === 0 ? (
            <EmptyState title={t('empty')} description={t('emptyHint')} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
              {projects.map((project) => (
                <ProjectBrowserTile
                  key={project.projectId}
                  projectKey={project.projectKey}
                  projectName={project.projectName}
                  url={null}
                  controlledBy={null}
                  thumbnailUrl={null}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
