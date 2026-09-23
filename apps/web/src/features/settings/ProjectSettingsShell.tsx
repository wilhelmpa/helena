'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useShellRoute } from '@/hooks/useShellRoute';
import { useProjectSettingsNavGroups } from '@/hooks/useProjectSettingsNavGroups';
import ProjectSettingsNav from '@/components/common/page/ProjectSettingsNav';

// The chrome every /project/:projectKey/settings/* page shares: the grouped
// sub-navigation in a second, narrow column (docs/volition-design-helena-ui.md
// "Eigenes Einstellungs-Layout"), the page itself beside it. Mobile stacks the nav
// above the page instead of a side rail — the same responsive contract
// TeamsPageView/TeamsPageRail already use for team settings, repeated here rather
// than shared, to keep the two features decoupled.
export default function ProjectSettingsShell({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  const { projectKey } = useShellRoute();
  const groups = useProjectSettingsNavGroups(projectKey ?? '');

  // No project yet (first paint, or a route outside a project): render the page
  // alone rather than an empty nav rail.
  if (!projectKey) return <>{children}</>;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="shrink-0 border-b p-3 lg:w-60 lg:overflow-y-auto lg:border-e lg:border-b-0">
        <ProjectSettingsNav groups={groups} label={t('projectSettings')} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
