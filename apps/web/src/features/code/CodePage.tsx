'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { workspaceTools } from '@/utils/workspaceTools';
import WorkspaceFrame from '@/components/layout/WorkspaceFrame';
import WorkspaceUnavailable from '@/components/layout/WorkspaceUnavailable';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';

export default function CodePage() {
  const t = useTranslations('nav.workspace');
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <WorkspacePageHeader title={t('code')} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {code.url ? (
          <WorkspaceFrame url={code.url} title={t('code')} active />
        ) : (
          <WorkspaceUnavailable tool={t('code')} />
        )}
      </div>
    </div>
  );
}
