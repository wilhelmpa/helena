'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ApprovalRequestList from './components/ApprovalRequestList';
import WorkflowGateList from './components/WorkflowGateList';

// Every decision waiting for the reader across the projects they may decide in: the
// requests agents made before acting outside Plan, and the workflow runs held at their
// approval gate. The decided tab keeps the agents' requests with their outcome.
export default function ApprovalsPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('approvals');
  return (
    <Shell globalHome globalTitle={tNav('approvals')} autoOpenGlobalChat={false}>
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div>
            <h1 className="text-xl font-semibold">{tNav('approvals')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('hint')}</p>
          </div>
          <Tabs defaultValue="pending">
            <TabsList>
              <TabsTrigger value="pending">{t('pending')}</TabsTrigger>
              <TabsTrigger value="decided">{t('decided')}</TabsTrigger>
            </TabsList>
            <TabsContent value="pending" className="space-y-8 pt-2">
              <ApprovalRequestList status="pending" />
              <WorkflowGateList />
            </TabsContent>
            <TabsContent value="decided" className="pt-2">
              <ApprovalRequestList status="decided" />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </Shell>
  );
}
