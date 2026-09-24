'use client';

import { useTranslations } from 'next-intl';
import { SectionLabel } from '@/components/common/page/RowList';
import { usePipelineApprovals } from '@/services/pipelines.service';
import PipelineApprovalCard from './PipelineApprovalCard';

// The workflow runs waiting for a person at an approval step. Left out while there is
// none. `projectKey` narrows them to one project, for the project's own Approvals page.
export default function WorkflowApprovalList({ projectKey }: { projectKey?: string }) {
  const t = useTranslations('approvals');
  const approvals = (usePipelineApprovals().data ?? []).filter(
    (approval) => projectKey == null || approval.projectKey === projectKey,
  );
  if (approvals.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionLabel className="-mb-1">{t('workflows')}</SectionLabel>
      {approvals.map((approval) => (
        <PipelineApprovalCard
          key={`${approval.runId}:${approval.stepId}:${approval.iteration}`}
          approval={approval}
        />
      ))}
    </section>
  );
}
