'use client';

import { Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { WorkflowGate } from '@/lib/api/endpoints/approvals';
import { formatDateTime } from '@/utils/dates';
import { useDecideWorkflowGate } from '../services/approvals.service';
import ApprovalDecisionForm from '@/components/common/ApprovalDecisionForm';

export default function WorkflowGateCard({ gate }: { gate: WorkflowGate }) {
  const t = useTranslations('approvals');
  const decide = useDecideWorkflowGate();

  return (
    <article className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Workflow className="size-4" />
        <span>{t('gateOf', { workflow: gate.workflowName, project: gate.projectName })}</span>
        <code className="truncate" dir="ltr">
          {gate.runId}
        </code>
        {gate.createdAt && <span className="ms-auto">{formatDateTime(gate.createdAt)}</span>}
      </div>
      {gate.summary && <p className="text-md font-medium">{gate.summary}</p>}
      {gate.reason && <p className="text-sm text-muted-foreground">{gate.reason}</p>}
      {gate.effects.length > 0 && (
        <div className="text-sm">
          <p className="text-muted-foreground">{t('effects')}</p>
          <ul className="list-disc ps-5">
            {gate.effects.map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
        </div>
      )}
      <ApprovalDecisionForm
        pending={decide.isPending}
        onDecide={(decision) => decide.mutate({ gate, decision })}
      />
    </article>
  );
}
