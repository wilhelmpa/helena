'use client';

import { useTranslations } from 'next-intl';
import { SectionLabel } from '@/components/common/page/RowList';
import ProposalCard from '@/features/agent-runtime/components/ProposalCard';
import { useProposals } from '@/features/agent-runtime/services/agentRuntime.service';

// The changes agents' runtimes raised for a person: memory writes of an agent (as a diff)
// and updates of Hermes. They belong to an agent or the instance rather than a project, so
// only the unfiltered approvals page lists them. Left out while there is none.
export default function RuntimeProposalList({ status }: { status: 'pending' | 'decided' }) {
  const t = useTranslations('agentRuntime.proposals');
  const proposals = useProposals(status).data ?? [];
  if (proposals.length === 0) return null;
  return (
    <section className="space-y-3">
      <SectionLabel className="-mb-1">{t('section')}</SectionLabel>
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </section>
  );
}
