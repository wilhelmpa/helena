'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { More, Segmented } from '@/design-system';
import OrganizationWhy from './OrganizationWhy';
import type { Organization } from '@/lib/api/endpoints/organization';
import OrganizationAgents from './OrganizationAgents';
import OrganizationDepartments from './OrganizationDepartments';
import OrganizationGoals from './OrganizationGoals';
import OrganizationOrchestration from './OrganizationOrchestration';
import OrganizationProjects from './OrganizationProjects';
import OrganizationTree from './OrganizationTree';
import OrganizationChart from '@/components/common/organization/OrganizationChart';
import OrganizationProjectResources from './OrganizationProjectResources';

const VIEWS = ['structure', 'departments', 'goals', 'agents', 'projects'] as const;
type OrganizationView = (typeof VIEWS)[number];

// A team's organization: the org chart (Team), or with ?tab= one of its other views —
// Ziele (goals) from the sidebar, and the old addresses of departments, agents and
// projects. A project's page shows the chart narrowed to it, and under "Mehr" its
// orchestration, resources and the plain tree. `toolbarEnd` is the page's own control at
// the end of the toolbar (the team on Helena's page).
export default function OrganizationWorkspace({
  organization,
  projectKey,
  toolbarEnd,
}: {
  organization: Organization;
  projectKey?: string;
  toolbarEnd?: ReactNode;
}) {
  const tChart = useTranslations('organization.chart');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get('tab');
  const tab: OrganizationView = VIEWS.find((item) => item === requested) ?? 'structure';

  // One page per sidebar entry (design-system §7): the entry picks what shows here — Team
  // is the org chart, Ziele the goals (?tab=goals). The other views of before are
  // entries of their own (Agentenpool, Einstellungen → Abteilungen / Projekte) and stay
  // reachable by their old ?tab= address.
  // Wer / Warum (hub/pc-goal-ladder): the chart shows who works, the why view what for.
  // On a project's Team page its chains, on Helena's every project's.
  const lens = params.get('lens') === 'why' ? 'why' : 'who';
  const whyProjects = projectKey
    ? organization.projects.filter((project) => project.key === projectKey)
    : organization.projects;
  const setLens = (next: 'who' | 'why') => {
    const query = new URLSearchParams(params.toString());
    if (next === 'why') query.set('lens', 'why');
    else query.delete('lens');
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  const lensSwitch = (
    <Segmented
      value={lens}
      onChange={setLens}
      label={tChart('lens')}
      options={[
        { value: 'who', label: tChart('lensWho') },
        { value: 'why', label: tChart('lensWhy') },
      ]}
    />
  );
  const chart =
    lens === 'why' ? (
      <>
        <PageToolbar>
          {lensSwitch}
          {toolbarEnd && (
            <>
              <PageToolbarSpacer />
              {toolbarEnd}
            </>
          )}
        </PageToolbar>
        <OrganizationWhy projects={whyProjects} />
      </>
    ) : (
      <OrganizationChart
        organization={organization}
        toolbarStart={lensSwitch}
        toolbarEnd={toolbarEnd}
      />
    );
  const toolbar = toolbarEnd ? <PageToolbar>{toolbarEnd}</PageToolbar> : null;

  return (
    <>
      {tab !== 'structure' && tab !== 'goals' && toolbar}
      {tab === 'departments' ? (
        <OrganizationDepartments
          teamId={organization.teamId}
          departments={organization.departments}
        />
      ) : tab === 'goals' ? (
        <OrganizationGoals
          toolbarEnd={toolbarEnd}
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
        <div className="ds-org">
          {chart}
          <div className="ds-org-more">
            <More label={tChart('moreDetails')}>
              {projectKey && (
                <OrganizationOrchestration
                  teamId={organization.teamId}
                  project={organization.projects.find((project) => project.key === projectKey)}
                  agents={organization.agents}
                  projectKey={projectKey}
                />
              )}
              {projectKey ? <OrganizationProjectResources projectKey={projectKey} /> : null}
              <OrganizationTree organization={organization} />
            </More>
          </div>
        </div>
      )}
    </>
  );
}
