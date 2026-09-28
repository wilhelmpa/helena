'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { MemoryRevision } from '@/lib/api/endpoints/agentRuntime';
import { Badge } from '@/components/ui/badge';
import { SectionLabel } from '@/components/common/page/RowList';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { cn } from '@/lib/utils';
import AgentMemoryFiles from '@/features/teams/components/ai-agents/AgentMemoryFiles';
import { useRuntimeActionsQuery } from '@/features/teams/services/agentLearning.service';
import { canActOnLearning } from '@/features/teams/utils/agentLearning';
import { useMemoryRevisions, useProposals } from '../services/agentRuntime.service';
import { AgentFactsSection, AgentNotesSection } from './AgentFactsPanel';
import ProposalCard from './ProposalCard';
import TextDiff from './TextDiff';

// The agent's memory: the files as its runtime holds them now (edited here, written by the
// runner), the writes of the agent that wait for the owner, and every version Helena saw.
export default function AgentMemoryPanel({
  teamId,
  agent,
  canEdit,
}: {
  teamId: number;
  agent: AiAgent;
  canEdit: boolean;
}) {
  const t = useTranslations('agentRuntime.memory');
  const inventory = agent.runtimeState.inventory;
  const acting = canActOnLearning(agent.runtimeState) ? agent.id : null;
  const actions = useRuntimeActionsQuery(teamId, acting).data;
  const pending = useProposals('pending').data?.filter(
    (proposal) => proposal.kind === 'memory-write' && proposal.agentId === agent.id,
  );
  const approval = agent.runtimePolicy.memoryApproval === true;

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
      <p className="text-xs text-muted-foreground">
        {approval ? t('approvalOn') : t('approvalOff')}
      </p>
      {pending && pending.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>{t('pending', { count: pending.length })}</SectionLabel>
          {pending.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </section>
      )}
      {inventory ? (
        <AgentMemoryFiles
          memory={inventory.memory}
          controls={acting === null || !canEdit ? null : { agentId: acting, actions }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('notReported')}</p>
      )}
      <AgentFactsSection teamId={teamId} agentId={agent.id} canEdit={canEdit} />
      <AgentNotesSection teamId={teamId} agentId={agent.id} />
      <MemoryHistory teamId={teamId} agentId={agent.id} />
    </div>
  );
}

function MemoryHistory({ teamId, agentId }: { teamId: number; agentId: number }) {
  const t = useTranslations('agentRuntime.memory');
  const format = useFormatter();
  const revisions = useMemoryRevisions(teamId, agentId);
  const [open, setOpen] = useState<number | null>(null);
  // Each version next to the one before it of the same file.
  const previous = useMemo(() => {
    const map = new Map<number, MemoryRevision | undefined>();
    const rows = revisions.data ?? [];
    rows.forEach((row, index) =>
      map.set(
        row.id,
        rows.slice(index + 1).find((older) => older.file === row.file),
      ),
    );
    return map;
  }, [revisions.data]);

  return (
    <section className="space-y-2">
      <SectionLabel>{t('history')}</SectionLabel>
      {revisions.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-9" />
      ) : !revisions.data?.length ? (
        <p className="text-sm text-muted-foreground">{t('noHistory')}</p>
      ) : (
        <ul className="divide-y divide-border/50 overflow-hidden rounded-md bg-card">
          {revisions.data.map((revision) => (
            <li key={revision.id}>
              <button
                type="button"
                onClick={() => setOpen(open === revision.id ? null : revision.id)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent',
                  open === revision.id && 'bg-accent',
                )}
              >
                <span className="font-mono text-xs">{revision.file}</span>
                <Badge variant="outline" className="shrink-0">
                  {t(`source.${revision.source}`)}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {revision.userName ?? ''}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {format.dateTime(new Date(revision.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              </button>
              {open === revision.id && (
                <div className="px-3 pb-3">
                  <TextDiff
                    before={previous.get(revision.id)?.content ?? ''}
                    after={revision.content}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
