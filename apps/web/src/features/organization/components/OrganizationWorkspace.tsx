'use client';

import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Organization } from '@/lib/api/endpoints/organization';
import OrganizationAgents from './OrganizationAgents';
import OrganizationDepartments from './OrganizationDepartments';
import OrganizationGoals from './OrganizationGoals';
import OrganizationOrchestration from './OrganizationOrchestration';
import OrganizationProjects from './OrganizationProjects';
import OrganizationTree from './OrganizationTree';
import OrganizationProjectResources from './OrganizationProjectResources';

export default function OrganizationWorkspace({
  organization,
  projectKey,
}: {
  organization: Organization;
  projectKey?: string;
}) {
  const t = useTranslations('organization');

  return (
    <Tabs
      defaultValue={projectKey ? 'orchestration' : 'structure'}
      className="min-h-0 min-w-0 flex-1 gap-0"
    >
      <TabsList variant="line" className="h-11 shrink-0 overflow-x-auto px-4">
        {projectKey && <TabsTrigger value="orchestration">{t('tabs.orchestration')}</TabsTrigger>}
        <TabsTrigger value="structure">{t('tabs.map')}</TabsTrigger>
        <TabsTrigger value="departments">{t('tabs.departments')}</TabsTrigger>
        <TabsTrigger value="goals">{t('tabs.goals')}</TabsTrigger>
        <TabsTrigger value="agents">{t('tabs.agents')}</TabsTrigger>
        <TabsTrigger value="projects">{t('tabs.projects')}</TabsTrigger>
      </TabsList>
      {projectKey && (
        <TabsContent value="orchestration" className="min-w-0 overflow-y-auto p-4">
          <OrganizationOrchestration
            teamId={organization.teamId}
            project={organization.projects.find((project) => project.key === projectKey)}
            agents={organization.agents}
            projectKey={projectKey}
          />
        </TabsContent>
      )}
      <TabsContent value="structure" className="min-w-0 overflow-auto p-4">
        {projectKey ? <OrganizationProjectResources projectKey={projectKey} /> : null}
        <OrganizationTree organization={organization} />
      </TabsContent>
      <TabsContent value="departments" className="min-w-0 overflow-y-auto p-4">
        <OrganizationDepartments
          teamId={organization.teamId}
          departments={organization.departments}
        />
      </TabsContent>
      <TabsContent value="goals" className="min-w-0 overflow-y-auto p-4">
        <OrganizationGoals
          teamId={organization.teamId}
          goals={organization.goals}
          departments={organization.departments}
          projects={organization.projects}
        />
      </TabsContent>
      <TabsContent value="agents" className="min-w-0 overflow-y-auto p-4">
        <OrganizationAgents
          teamId={organization.teamId}
          agents={organization.agents}
          departments={organization.departments}
        />
      </TabsContent>
      <TabsContent value="projects" className="min-w-0 overflow-y-auto p-4">
        <OrganizationProjects
          teamId={organization.teamId}
          projects={organization.projects}
          departments={organization.departments}
        />
      </TabsContent>
    </Tabs>
  );
}
