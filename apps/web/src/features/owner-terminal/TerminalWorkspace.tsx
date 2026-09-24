'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import WorkspaceFrame from '@/components/layout/WorkspaceFrame';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { workspaceTools } from '@/utils/workspaceTools';
import type { WorkspaceContentProps } from '@/context/workspaceContents';
import OwnerTerminalPanel from './OwnerTerminalPanel';

// The "terminal" tool in the Werkzeug-Panel: the owner terminal in Home, the
// existing project terminal (a plain iframe, unchanged) everywhere else. See
// docs/volition-design-owner-terminals.md's Nachtrag ("Home-Terminal =
// Owner-Terminal"). Registered in app/WorkspaceToolsProvider.tsx.
export default function TerminalWorkspace({ projectKey }: WorkspaceContentProps) {
  const t = useTranslations('nav.workspace');
  const workspaceConfig = runtimeEnv().workspace;
  const provisioning = useProjectProvisioningQuery(projectKey);
  const resources = useMemo(
    () =>
      provisioning.data?.status === 'succeeded' ? (provisioning.data.result?.resources ?? []) : [],
    [provisioning.data],
  );

  if (!projectKey) return <OwnerTerminalPanel />;

  const url = workspaceTools(workspaceConfig, projectKey, resources).terminal.url;
  if (!url) return null;
  return <WorkspaceFrame url={url} title={t('terminal')} active className="flex-1" />;
}
