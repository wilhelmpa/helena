'use client';

import { useTranslations } from 'next-intl';
import { useWorkflowGates } from '@/services/approvals.service';
import { gateKey } from '../utils/workflowGates';
import WorkflowGateCard from './WorkflowGateCard';

// The workflow runs held at their approval gate. Left out while there is none, unless
// some project's workflows could not be read: then the reader is told what is missing.
export default function WorkflowGateList() {
  const t = useTranslations('approvals');
  const { data } = useWorkflowGates();
  if (!data || (data.items.length === 0 && data.complete)) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t('workflows')}</h2>
      {!data.complete && (
        <p className="text-xs text-muted-foreground">{t('workflowsIncomplete')}</p>
      )}
      {data.items.map((gate) => (
        <WorkflowGateCard key={gateKey(gate)} gate={gate} />
      ))}
    </section>
  );
}
