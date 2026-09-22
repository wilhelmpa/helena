'use client';

import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Organization } from '@/lib/api/endpoints/organization';
import OrganizationAgents from './OrganizationAgents';
import OrganizationDepartments from './OrganizationDepartments';
import OrganizationGoals from './OrganizationGoals';
import OrganizationProjects from './OrganizationProjects';
import OrganizationTree from './OrganizationTree';
import OrganizationWorkflows from './OrganizationWorkflows';

export default function OrganizationWorkspace({ organization }: { organization: Organization }) {
  const t = useTranslations('organization');

  return (
    <Tabs defaultValue="structure" className="min-h-0 flex-1 gap-0">
      <TabsList variant="line" className="h-11 shrink-0 overflow-x-auto px-4">
        <TabsTrigger value="structure">Organization map</TabsTrigger>
        <TabsTrigger value="departments">{t('tabs.departments')}</TabsTrigger>
        <TabsTrigger value="goals">{t('tabs.goals')}</TabsTrigger>
        <TabsTrigger value="agents">{t('tabs.agents')}</TabsTrigger>
        <TabsTrigger value="projects">{t('tabs.projects')}</TabsTrigger>
        <TabsTrigger value="workflows">Workflows</TabsTrigger>
      </TabsList>
      <TabsContent value="structure" className="overflow-auto p-4">
        <OrganizationTree organization={organization} />
      </TabsContent>
      <TabsContent value="departments" className="overflow-y-auto p-4">
        <OrganizationDepartments
          teamId={organization.teamId}
          departments={organization.departments}
        />
      </TabsContent>
      <TabsContent value="goals" className="overflow-y-auto p-4">
        <OrganizationGoals
          teamId={organization.teamId}
          goals={organization.goals}
          departments={organization.departments}
          projects={organization.projects}
        />
      </TabsContent>
      <TabsContent value="agents" className="overflow-y-auto p-4">
        <OrganizationAgents
          teamId={organization.teamId}
          agents={organization.agents}
          departments={organization.departments}
        />
      </TabsContent>
      <TabsContent value="projects" className="overflow-y-auto p-4">
        <OrganizationProjects
          teamId={organization.teamId}
          projects={organization.projects}
          departments={organization.departments}
        />
      </TabsContent>
      <TabsContent value="workflows" className="overflow-y-auto p-4">
        <OrganizationWorkflows projects={organization.projects} />
      </TabsContent>
    </Tabs>
  );
}
