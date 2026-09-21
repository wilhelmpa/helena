'use client';

import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Organization } from '@/lib/api/endpoints/organization';
import OrganizationAgents from './OrganizationAgents';
import OrganizationDepartments from './OrganizationDepartments';
import OrganizationGoals from './OrganizationGoals';
import OrganizationProjects from './OrganizationProjects';

export default function OrganizationWorkspace({ organization }: { organization: Organization }) {
  const t = useTranslations('organization');

  return (
    <Tabs defaultValue="departments" className="min-h-0 flex-1 gap-0">
      <TabsList variant="line" className="h-11 shrink-0 overflow-x-auto px-4">
        <TabsTrigger value="departments">{t('tabs.departments')}</TabsTrigger>
        <TabsTrigger value="goals">{t('tabs.goals')}</TabsTrigger>
        <TabsTrigger value="agents">{t('tabs.agents')}</TabsTrigger>
        <TabsTrigger value="projects">{t('tabs.projects')}</TabsTrigger>
      </TabsList>
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
    </Tabs>
  );
}
