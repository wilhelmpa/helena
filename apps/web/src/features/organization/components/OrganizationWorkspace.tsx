'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bot, Building2, FolderKanban, Network, Target, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
  type PageTab,
} from '@/components/layout/PageToolbar';
import type { Organization } from '@/lib/api/endpoints/organization';
import OrganizationAgents from './OrganizationAgents';
import OrganizationDepartments from './OrganizationDepartments';
import OrganizationGoals from './OrganizationGoals';
import OrganizationOrchestration from './OrganizationOrchestration';
import OrganizationProjects from './OrganizationProjects';
import OrganizationTree from './OrganizationTree';
import OrganizationProjectResources from './OrganizationProjectResources';

type OrganizationTab =
  'orchestration' | 'structure' | 'departments' | 'goals' | 'agents' | 'projects';

// The organization's views as the header row's tabs (Organigramm, Abteilungen, Ziele,
// Agenten, Projekte; a project's page starts with its Orchestrierung). The open tab is
// in the address (?tab=goals), so a link and the back button reach it. `toolbarEnd` is
// the page's own control after the tabs (the team on the global page).
export default function OrganizationWorkspace({
  organization,
  projectKey,
  toolbarEnd,
}: {
  organization: Organization;
  projectKey?: string;
  toolbarEnd?: ReactNode;
}) {
  const t = useTranslations('organization');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabs: PageTab<OrganizationTab>[] = [
    ...(projectKey
      ? [{ value: 'orchestration' as const, label: t('tabs.orchestration'), icon: Workflow }]
      : []),
    { value: 'structure', label: t('tabs.map'), icon: Network },
    { value: 'departments', label: t('tabs.departments'), icon: Building2 },
    { value: 'goals', label: t('tabs.goals'), icon: Target },
    { value: 'agents', label: t('tabs.agents'), icon: Bot },
    { value: 'projects', label: t('tabs.projects'), icon: FolderKanban },
  ];
  const fallback: OrganizationTab = projectKey ? 'orchestration' : 'structure';
  const requested = params.get('tab');
  const tab = tabs.find((item) => item.value === requested)?.value ?? fallback;

  const select = (next: OrganizationTab) => {
    const query = new URLSearchParams(params.toString());
    if (next === fallback) query.delete('tab');
    else query.set('tab', next);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  return (
    <>
      <PageToolbar>
        <PageTabs label={t('title')} items={tabs} value={tab} onChange={select} />
        <PageToolbarSpacer />
        {toolbarEnd}
      </PageToolbar>
      {tab === 'orchestration' && projectKey ? (
        <OrganizationOrchestration
          teamId={organization.teamId}
          project={organization.projects.find((project) => project.key === projectKey)}
          agents={organization.agents}
          projectKey={projectKey}
        />
      ) : tab === 'departments' ? (
        <OrganizationDepartments
          teamId={organization.teamId}
          departments={organization.departments}
        />
      ) : tab === 'goals' ? (
        <OrganizationGoals
          teamId={organization.teamId}
          goals={organization.goals}
          departments={organization.departments}
          projects={organization.projects}
        />
      ) : tab === 'agents' ? (
        <OrganizationAgents
          teamId={organization.teamId}
          agents={organization.agents}
          departments={organization.departments}
        />
      ) : tab === 'projects' ? (
        <OrganizationProjects
          teamId={organization.teamId}
          projects={organization.projects}
          departments={organization.departments}
        />
      ) : (
        <div className="min-w-0">
          {projectKey ? <OrganizationProjectResources projectKey={projectKey} /> : null}
          <OrganizationTree organization={organization} />
        </div>
      )}
    </>
  );
}
