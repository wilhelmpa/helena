'use client';

import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import SectionPageView from '@/components/common/page/SectionPageView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ApprovalRequestList from './components/ApprovalRequestList';
import WorkflowApprovalList from './components/WorkflowApprovalList';

// This project's own approvals: the requests its agents made before acting outside
// Plan, and the workflow runs of this project waiting at an approval gate. Narrows
// the same lists the global Approvals page shows to one project (see ApprovalsPage).
export default function ProjectApprovalsPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('approvals');
  const { project } = useShell();
  if (!project) return null;
  const projectKey = project.project.key;

  return (
    <SectionPageView title={tNav('approvals')} description={t('projectHint')}>
      <RequirePermission resource="ai_agents" action="edit">
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">{t('pending')}</TabsTrigger>
            <TabsTrigger value="decided">{t('decided')}</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="space-y-6 pt-2">
            <ApprovalRequestList status="pending" projectKey={projectKey} />
            <WorkflowApprovalList projectKey={projectKey} />
          </TabsContent>
          <TabsContent value="decided" className="pt-2">
            <ApprovalRequestList status="decided" projectKey={projectKey} />
          </TabsContent>
        </Tabs>
      </RequirePermission>
    </SectionPageView>
  );
}
