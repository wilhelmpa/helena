'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { workspaceTools } from '@/utils/workspaceTools';
import WorkspaceFrame from '@/components/layout/WorkspaceFrame';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { Code2, ExternalLink, LoaderCircle, RotateCcw } from 'lucide-react';
import { Button, EmptyState, Page } from '@/design-system';
import { settingsPath } from '@/utils/paths';

// How long code-server may take before the page says it does not answer.
const SLOW_MS = 25_000;

export default function CodePage() {
  const t = useTranslations('nav.workspace');
  const tCommon = useTranslations('common');
  const { projectKey } = useParams<{ projectKey: string }>();
  const router = useRouter();
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
  // Until code-server's page is there, a calm loading state in the app's colours, not a
  // white frame (owner, 29.09.); after SLOW_MS a way to try again.
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (loaded || !code.url) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [loaded, code.url, attempt]);

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
      <div className="ds-code-stage">
        {code.url ? (
          <>
            <WorkspaceFrame
              url={code.url}
              title={t('code')}
              active
              helenaCode
              reloadToken={attempt}
              onLoaded={() => setLoaded(true)}
              className={loaded ? undefined : 'ds-code-frame-loading'}
            />
            {!loaded && (
              <div className="ds-code-cover">
                {slow ? (
                  <EmptyState
                    icon={<Code2 />}
                    action={
                      <Button
                        size="small"
                        icon={<RotateCcw size={14} />}
                        onClick={() => {
                          setSlow(false);
                          setAttempt((value) => value + 1);
                        }}
                      >
                        {t('codeRetry')}
                      </Button>
                    }
                  >
                    {t('codeSlow')}
                  </EmptyState>
                ) : (
                  <EmptyState icon={<LoaderCircle className="animate-spin" />}>
                    {t('codeLoading')}
                  </EmptyState>
                )}
              </div>
            )}
          </>
        ) : (
          // No folder for this project yet (its setup has not run): say so instead of a
          // blank frame or another project's files.
          <EmptyState
            icon={<Code2 />}
            action={
              <Button size="small" onClick={() => router.push(settingsPath(projectKey, 'general'))}>
                {t('codeSettings')}
              </Button>
            }
          >
            {provisioning.data && provisioning.data.status !== 'succeeded'
              ? t('codeNoFolderPending')
              : t('codeNoFolder')}
          </EmptyState>
        )}
      </div>
    </Page>
  );
}
