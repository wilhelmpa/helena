'use client';

import { useTranslations } from 'next-intl';
import { SectionLabel } from '@/components/common/page/RowList';
import { useWorkflowGates } from '@/services/approvals.service';
import { usePipelineApprovals } from '@/services/pipelines.service';
import { gateKey } from '../utils/workflowGates';
import PipelineApprovalCard from './PipelineApprovalCard';
import WorkflowGateCard from './WorkflowGateCard';

// The workflow runs waiting for a person: the approval steps of the workflow builder's
// runs and the Mastra runs held at their approval gate. Left out while there is none,
// unless some project's Mastra workflows could not be read: then the reader is told
// what is missing. `projectKey` narrows both to one project, for the project's own
// Approvals page.
export default function WorkflowApprovalList({ projectKey }: { projectKey?: string }) {
  const t = useTranslations('approvals');
  const gates = useWorkflowGates().data;
  const approvals = (usePipelineApprovals().data ?? []).filter(
    (approval) => projectKey == null || approval.projectKey === projectKey,
  );
  const gateItems = (gates?.items ?? []).filter(
    (gate) => projectKey == null || gate.projectKey === projectKey,
  );
  const incomplete = gates?.complete === false;
  if (approvals.length === 0 && gateItems.length === 0 && !incomplete) return null;

  return (
    <section className="space-y-3">
      <SectionLabel className="-mb-1">{t('workflows')}</SectionLabel>
      {incomplete && <p className="px-2 text-xs text-status-waiting">{t('workflowsIncomplete')}</p>}
      {approvals.map((approval) => (
        <PipelineApprovalCard
          key={`${approval.runId}:${approval.stepId}:${approval.iteration}`}
          approval={approval}
        />
      ))}
      {gateItems.map((gate) => (
        <WorkflowGateCard key={gateKey(gate)} gate={gate} />
      ))}
    </section>
  );
}
