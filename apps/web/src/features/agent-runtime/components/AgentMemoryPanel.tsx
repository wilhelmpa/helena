'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Notice, Segmented, Stack, Text } from '@/design-system';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { AgentPage, AgentPages } from '@/features/teams/components/ai-agents/AgentPage';
import { useRuntimeActionsQuery } from '@/features/teams/services/agentLearning.service';
import { canActOnLearning } from '@/features/teams/utils/agentLearning';
import {
  useAgentFacts,
  useAgentNotes,
  useMemoryRevisions,
  useProposals,
} from '../services/agentRuntime.service';
import { memoryFilesOf } from '../utils/memoryFiles';
import { agentSizeLimits, memoryArea } from '../utils/sizeLimits';
import MemoryFactsView from './memory/MemoryFactsView';
import MemoryFileCard from './memory/MemoryFileCard';
import MemoryNotesView from './memory/MemoryNotesView';
import MemoryVersions from './memory/MemoryVersions';
import ProposalCard from './ProposalCard';

type MemoryView = 'memory' | 'notes' | 'facts' | 'proposals' | 'versions';

// The agent's memory in five views: what it remembers (MEMORY and USER, as readable entries),
// its daily notes, its facts with their trust, what it proposes and waits for you, and every
// version of the files. Where the agent's runtime carries out edits, the files are edited
// right here.
export default function AgentMemoryPanel({
  teamId,
  agent,
  canEdit,
}: {
  teamId: number;
  agent: AiAgent;
  canEdit: boolean;
}) {
  const t = useTranslations('agentPages.memory');
  const acting = canActOnLearning(agent.runtimeState) ? agent.id : null;
  const actions = useRuntimeActionsQuery(teamId, acting).data;
  const revisions = useMemoryRevisions(teamId, agent.id);
  const notes = useAgentNotes(teamId, agent.id);
  const facts = useAgentFacts(teamId, agent.id);
  const pending =
    useProposals('pending').data?.filter(
      (proposal) => proposal.kind === 'memory-write' && proposal.agentId === agent.id,
    ) ?? [];
  const approval = agent.runtimePolicy.memoryApproval === true;
  const limits = agentSizeLimits(agent);
  const [view, setView] = useState<MemoryView>('memory');

  const files = memoryFilesOf(agent.runtimeState.inventory?.memory, revisions.data);
  const options: { value: MemoryView; label: string; count?: number }[] = [
    { value: 'memory', label: t('views.memory') },
    { value: 'notes', label: t('views.notes'), count: notes.data?.length },
    { value: 'facts', label: t('views.facts'), count: facts.data?.length },
    ...(pending.length > 0 || view === 'proposals'
      ? [{ value: 'proposals' as const, label: t('views.proposals'), count: pending.length }]
      : []),
    { value: 'versions', label: t('views.versions') },
  ];

  return (
    <AgentPages>
      <AgentPage title={t('title')} hint={approval ? t('approvalOn') : t('approvalOff')}>
        <Segmented
          label={t('viewsLabel')}
          value={view}
          onChange={setView}
          options={options.map((option) => ({
            value: option.value,
            label: (
              <>
                {option.label}
                {option.count != null && option.count > 0 && (
                  <span className="ds-segment-count">{option.count}</span>
                )}
              </>
            ),
          }))}
        />

        {view !== 'proposals' && pending.length > 0 && (
          <Notice
            tone="warning"
            title={t('pendingTitle', { count: pending.length })}
            action={
              <button type="button" className="ds-link-button" onClick={() => setView('proposals')}>
                {t('pendingOpen')}
              </button>
            }
          >
            {t('pendingText')}
          </Notice>
        )}

        {view === 'memory' && (
          <Stack gap={4}>
            {files.map((entry) => (
              <MemoryFileCard
                key={entry.file}
                teamId={teamId}
                agentId={agent.id}
                entry={entry}
                title={t(`files.${memoryArea(entry.file)}.title`)}
                hint={t(`files.${memoryArea(entry.file)}.hint`)}
                actions={actions}
                editable={acting !== null && canEdit}
                limit={limits[memoryArea(entry.file)]}
              />
            ))}
            {acting === null && (
              <Text size="xs" tone="muted">
                {t('notEditable')}
              </Text>
            )}
          </Stack>
        )}
        {view === 'notes' && <MemoryNotesView teamId={teamId} agentId={agent.id} />}
        {view === 'facts' && (
          <MemoryFactsView teamId={teamId} agentId={agent.id} canEdit={canEdit} />
        )}
        {view === 'proposals' && (
          <Stack gap={3}>
            {pending.length === 0 ? (
              <Text size="sm" tone="muted">
                {t('noPending')}
              </Text>
            ) : (
              pending.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} />)
            )}
          </Stack>
        )}
        {view === 'versions' && <MemoryVersions teamId={teamId} agentId={agent.id} />}
      </AgentPage>
    </AgentPages>
  );
}
