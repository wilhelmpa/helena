'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import ApprovalDecisionForm from '@/components/common/ApprovalDecisionForm';
import type {
  HermesUpdatePayload,
  MemoryProposalPayload,
  RuntimeProposal,
} from '@/lib/api/endpoints/agentRuntime';
import { formatDateTime } from '@/utils/dates';
import { useDecideProposal } from '../services/agentRuntime.service';
import TextDiff from './TextDiff';

// A change an agent's runtime raised for the owner: a memory write of the agent, shown as a
// diff of the file, or an update of Hermes with what it brings. Pending, it offers the
// decision; decided, it says how it went.
export default function ProposalCard({ proposal }: { proposal: RuntimeProposal }) {
  const t = useTranslations('agentRuntime.proposals');
  const decide = useDecideProposal();

  return (
    <article className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge variant="outline">{t(`kind.${proposal.kind}`)}</Badge>
        {proposal.agentName && (
          <span>
            {t('raisedBy', { agent: proposal.agentName, username: proposal.agentUsername ?? '' })}
          </span>
        )}
        <span className="ms-auto">{formatDateTime(proposal.createdAt)}</span>
      </div>
      <p className="text-md font-medium" dir="auto">
        {proposal.kind === 'memory-write'
          ? t('memoryTitle', { file: proposal.title })
          : proposal.title}
      </p>
      {proposal.kind === 'memory-write' ? (
        <TextDiff
          before={(proposal.payload as MemoryProposalPayload).before}
          after={(proposal.payload as MemoryProposalPayload).after}
        />
      ) : (
        <UpdateDetails payload={proposal.payload as HermesUpdatePayload} />
      )}
      {proposal.status === 'pending' ? (
        <ApprovalDecisionForm
          pending={decide.isPending}
          onDecide={(decision) =>
            decide.mutate({ id: proposal.id, approved: decision.approved, note: decision.note })
          }
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(`status.${proposal.status}`)}
          {proposal.decidedByName ? ` · ${proposal.decidedByName}` : ''}
          {proposal.decidedAt ? ` · ${formatDateTime(proposal.decidedAt)}` : ''}
          {proposal.note ? ` · ${proposal.note}` : ''}
          {proposal.error ? ` · ${proposal.error}` : ''}
        </p>
      )}
    </article>
  );
}

function UpdateDetails({ payload }: { payload: HermesUpdatePayload }) {
  const t = useTranslations('agentRuntime.proposals');
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-muted-foreground">{t('updateHint')}</p>
      <details>
        <summary className="cursor-pointer text-sm">
          {t('changes', { count: payload.commits.length })}
        </summary>
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
          {payload.commits.map((commit) => (
            <li key={commit.commit} className="flex gap-2">
              <span className="shrink-0 font-mono text-muted-foreground" dir="ltr">
                {commit.commit.slice(0, 8)}
              </span>
              <span className="min-w-0" dir="auto">
                {commit.subject}
              </span>
            </li>
          ))}
        </ul>
      </details>
      {payload.localPatches.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('localPatches', {
            count: payload.localPatches.length,
            list: payload.localPatches.map((patch) => patch.subject).join('; '),
          })}
        </p>
      )}
    </div>
  );
}
