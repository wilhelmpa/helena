'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ApprovalDecisionForm from '@/components/common/ApprovalDecisionForm';
import type { PipelineApproval } from '@/lib/api/endpoints/pipelines';
import { formatDateTime } from '@/utils/dates';
import { useDecidePipelineApproval } from '@/services/pipelines.service';
import { issueIdentifierPath } from '@/utils/paths';

// The approval step of a workflow run: which workflow and task wait, what the step asks
// the approver to check, and the decision controls.
export default function PipelineApprovalCard({ approval }: { approval: PipelineApproval }) {
  const t = useTranslations('pipelines.approvals');
  const decide = useDecidePipelineApproval();

  return (
    <article className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ShieldCheck className="size-4" />
        <span dir="auto">
          {t('of', { workflow: approval.pipelineName, project: approval.projectName })}
        </span>
        {approval.issueIdentifier && (
          <Link
            href={issueIdentifierPath(approval.issueIdentifier)}
            className="truncate hover:underline"
          >
            <span dir="ltr">{approval.issueIdentifier}</span>
            {approval.issueTitle && <span dir="auto"> · {approval.issueTitle}</span>}
          </Link>
        )}
        <span className="ms-auto">
          {t('waitingSince', { time: formatDateTime(approval.waitingSince) })}
        </span>
      </div>
      <p className="text-md font-medium" dir="auto">
        {t('step', { step: approval.stepName })}
      </p>
      {approval.message && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground" dir="auto">
          {approval.message}
        </p>
      )}
      <ApprovalDecisionForm
        pending={decide.isPending}
        onDecide={(decision) => decide.mutate({ runId: approval.runId, decision })}
      />
    </article>
  );
}
