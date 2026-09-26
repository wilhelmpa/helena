'use client';

import { useMutation } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import SectionPageView from '@/components/common/page/SectionPageView';
import { PageToolbar } from '@/components/layout/PageToolbar';
import ProjectPreviewControl from '@/components/common/project-previews/ProjectPreviewControl';
import { browserAction } from '@/utils/browserControl';
import { BROWSER_ROUTER_BASE } from '@/utils/browserOverview';
import { useLabOptionsQuery } from './services/browserTask.service';
import BrowserLab from './components/BrowserLab';

// Browser 2.0 inside a project (/project/KEY/browser-lab): the project's browser, its agents
// and its decision model connections.
export default function BrowserLabPage() {
  const { projectKey } = useParams<{ projectKey: string }>();
  const t = useTranslations('browserLab');
  const options = useLabOptionsQuery({ kind: 'project', projectKey });
  const openPreview = useMutation({
    mutationFn: (url: string) =>
      browserAction(
        `${BROWSER_ROUTER_BASE}/projects/${encodeURIComponent(options.data!.slug)}/api`,
        'new',
        { url },
      ),
  });
  return (
    <SectionPageView title={t('title')} wide>
      <PageToolbar>
        {options.data?.slug && (
          <ProjectPreviewControl
            projectKey={projectKey}
            onOpen={(url) => openPreview.mutate(url)}
          />
        )}
      </PageToolbar>
      <BrowserLab key={projectKey} scope={{ kind: 'project', projectKey }} />
    </SectionPageView>
  );
}
