'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useShellRoute } from '@/hooks/useShellRoute';
import { useProjectSettingsNavGroups } from '@/hooks/useProjectSettingsNavGroups';
import ProjectSettingsNav from '@/components/common/page/ProjectSettingsNav';

// The chrome every /project/:projectKey/settings/* page shares: the grouped
// sub-navigation in a second, narrow column (docs/volition-design-helena-ui.md
// "Eigenes Einstellungs-Layout"), the page itself beside it. Below lg the rail becomes
// one dropdown at the start of the page's header row (SettingsToolbar), so the page
// starts with its own content and there is no second row.
export default function ProjectSettingsShell({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  const { projectKey } = useShellRoute();
  const groups = useProjectSettingsNavGroups(projectKey ?? '');

  // No project yet (first paint, or a route outside a project): render the page
  // alone rather than an empty nav rail.
  if (!projectKey) return <>{children}</>;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="hidden shrink-0 overflow-y-auto border-e border-sidebar-border bg-card p-2 lg:block lg:w-56">
        <ProjectSettingsNav groups={groups} label={t('projectSettings')} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
