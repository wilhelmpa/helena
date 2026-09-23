'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApprovalProjects } from '@/services/approvals.service';
import ApprovalRequestList from './components/ApprovalRequestList';
import WorkflowApprovalList from './components/WorkflowApprovalList';

// The sentinel for "every project", since a Select item cannot carry an empty value.
const ALL_PROJECTS = 'all';

// Every decision waiting for the reader across the projects they may decide in: the
// requests agents made before acting outside Plan, and the workflow runs waiting at an
// approval. The decided tab keeps the agents' requests with their outcome. The project
// filter narrows both tabs to one project; its options are only the projects the
// reader may already decide in (see GET /approvals/projects).
export default function ApprovalsPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('approvals');
  const projects = useApprovalProjects().data ?? [];
  const [projectKey, setProjectKey] = useState<string | undefined>(undefined);

  return (
    <Shell globalHome globalTitle={tNav('approvals')} autoOpenGlobalChat={false}>
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">{tNav('approvals')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('hint')}</p>
            </div>
            {projects.length > 1 && (
              <Select
                value={projectKey ?? ALL_PROJECTS}
                onValueChange={(value) => setProjectKey(value === ALL_PROJECTS ? undefined : value)}
              >
                <SelectTrigger className="w-[220px]" aria-label={t('filterProject')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROJECTS}>{t('filterProjectAll')}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.key}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <Tabs defaultValue="pending">
            <TabsList>
              <TabsTrigger value="pending">{t('pending')}</TabsTrigger>
              <TabsTrigger value="decided">{t('decided')}</TabsTrigger>
            </TabsList>
            <TabsContent value="pending" className="space-y-8 pt-2">
              <ApprovalRequestList
                key={`pending:${projectKey ?? ''}`}
                status="pending"
                projectKey={projectKey}
              />
              <WorkflowApprovalList projectKey={projectKey} />
            </TabsContent>
            <TabsContent value="decided" className="pt-2">
              <ApprovalRequestList
                key={`decided:${projectKey ?? ''}`}
                status="decided"
                projectKey={projectKey}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </Shell>
  );
}
