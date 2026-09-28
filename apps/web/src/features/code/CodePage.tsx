'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { workspaceTools } from '@/utils/workspaceTools';
import WorkspaceFrame from '@/components/layout/WorkspaceFrame';
import WorkspaceUnavailable from '@/components/layout/WorkspaceUnavailable';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { ExternalLink } from 'lucide-react';
import { Page } from '@/design-system';

export default function CodePage() {
  const t = useTranslations('nav.workspace');
  const tCommon = useTranslations('common');
  const { projectKey } = useParams<{ projectKey: string }>();
  const provisioning = useProjectProvisioningQuery(projectKey);
  const resources = useMemo(
    () =>
      provisioning.data?.status === 'succeeded' ? (provisioning.data.result?.resources ?? []) : [],
    [provisioning.data],
  );
  const code = useMemo(
    () => workspaceTools(runtimeEnv().workspace, projectKey, resources).code,
    [projectKey, resources],
  );

  return (
    <Page variant="bleed" title={t('code')}>
      {code.url && (
        <PageToolbar>
          <PageToolbarSpacer />
          <PageActions
            actions={[
              {
                id: 'open',
                label: tCommon('editor.openPreviewLink', { name: t('code') }),
                icon: ExternalLink,
                href: code.url,
                external: true,
              },
            ]}
          />
        </PageToolbar>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {code.url ? (
          <WorkspaceFrame url={code.url} title={t('code')} active helenaCode />
        ) : (
          <WorkspaceUnavailable tool={t('code')} />
        )}
      </div>
    </Page>
  );
}
