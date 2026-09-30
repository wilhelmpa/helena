'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, History, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Button,
  EmptyState,
  IconButton,
  Inline,
  List,
  ListRow,
  Stack,
  Switch,
  Text,
} from '@/design-system';
import type { AgentRun } from '@/lib/api/endpoints/agents';
import { useAgentRuns, useSetAgentRunArchived } from '@/services/aiAgents.service';
import { useRelativeTime } from '@/context/relativeTimeContext';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { compactTokens } from '@/utils/agentUsage';
import { AgentPage, AgentPages } from '@/features/teams/components/ai-agents/AgentPage';
import RunView from './RunView';
import { isModelRefusal } from '@/features/model-availability/utils/modelFailure';

// The agent's runs, newest first; one opens as its timeline ("Gläserner Lauf"). Same frame,
// list and empty state as the other pages of the agent.
export default function AgentRunsPanel({
  teamId,
  agentId,
  runId,
  onRunChange,
}: {
  teamId: number;
  agentId: number;
  runId: number | null;
  onRunChange: (runId: number | null) => void;
}) {
  if (runId != null) {
    return (
      <RunView
        teamId={teamId}
        agentId={agentId}
        runId={runId}
        onBack={() => onRunChange(null)}
        onOpenRun={onRunChange}
      />
    );
  }
  return (
    <AgentPages>
      <RunList teamId={teamId} agentId={agentId} onOpen={onRunChange} />
    </AgentPages>
  );
}

function RunList({
  teamId,
  agentId,
  onOpen,
}: {
  teamId: number;
  agentId: number;
  onOpen: (runId: number) => void;
}) {
  const t = useTranslations('agentRuntime.runs');
  const tPage = useTranslations('agentPages.runs');
  const tTabs = useTranslations('agentRuntime.tabs');
  const tCommon = useTranslations('common');
  // Runs are never deleted: a finished one is archived out of this list, and the switch
  // shows the archived ones again.
  const [showArchived, setShowArchived] = useState(false);
  const query = useAgentRuns(teamId, agentId, showArchived);
  const archive = useSetAgentRunArchived(teamId, agentId);
  const runs = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <AgentPage
      title={tTabs('runs')}
      hint={tPage('hint')}
      actions={
        <Inline gap={2}>
          <Text size="xs" tone="muted">
            {t('showArchived')}
          </Text>
          <Switch
            size="sm"
            checked={showArchived}
            aria-label={t('showArchived')}
            onCheckedChange={setShowArchived}
          />
        </Inline>
      }
    >
      {query.isPending ? (
        <ListSkeleton rows={5} rowClassName="h-11" />
      ) : runs.length === 0 ? (
        <EmptyState fill={false} icon={<History />} title={t('empty')}>
          {tPage('emptyHint')}
        </EmptyState>
      ) : (
        <Stack gap={3}>
          <List label={tTabs('runs')}>
            {runs.map((run) => {
              const archived = Boolean(run.archivedAt);
              return (
                <RunRow
                  key={run.id}
                  run={run}
                  onOpen={() => onOpen(run.id)}
                  actions={
                    run.status !== 'pending' ? (
                      <IconButton
                        size="small"
                        label={archived ? t('unarchive') : t('archive')}
                        disabled={archive.isPending}
                        onClick={() =>
                          archive.mutate(
                            { runId: run.id, archived: !archived },
                            { onError: () => toast.error(t('archiveFailed')) },
                          )
                        }
                      >
                        {archived ? <ArchiveRestore /> : <Archive />}
                      </IconButton>
                    ) : undefined
                  }
                />
              );
            })}
          </List>
          {query.hasNextPage && (
            <Button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {query.isFetchingNextPage ? tCommon('loading') : t('loadMore')}
            </Button>
          )}
        </Stack>
      )}
    </AgentPage>
  );
}

// One run as a row of a list: what it was for, how it went and when; the notes worth a look
// (archived, waiting for an answer, model refused or changed, autopilot level, tokens) stand
// under it as one quiet line.
export function RunRow({
  run,
  onOpen,
  actions,
}: {
  run: AgentRun;
  onOpen: () => void;
  actions?: React.ReactNode;
}) {
  const t = useTranslations('agentRuntime.runs');
  const tModel = useTranslations('modelAvailability');
  const tAutopilot = useTranslations('autopilot');
  const relativeTime = useRelativeTime();
  const subject = run.issueIdentifier
    ? `${run.issueIdentifier}${run.issueTitle ? ` · ${run.issueTitle}` : ''}`
    : t(`trigger.${run.trigger}`);
  const notes = [
    run.archivedAt ? t('archived') : null,
    run.blockedQuestion ? t('blocked') : null,
    isModelRefusal(run.failure) ? tModel('refusedShort') : null,
    run.modelRoute?.routed ? `→ ${run.modelRoute.toModel}` : null,
    run.modelCheck && run.modelCheck.mismatch.length > 0 ? t('modelMismatch') : null,
    run.autopilotLevel != null && run.autopilotLevel >= 0 && run.autopilotLevel <= 3
      ? tAutopilot('badge', { level: run.autopilotLevel })
      : null,
    run.contextTokens !== undefined ? compactTokens(run.contextTokens) : null,
  ].filter(Boolean);
  return (
    <ListRow
      title={subject}
      subtitle={notes.length > 0 ? notes.join(' · ') : undefined}
      meta={
        <>
          <span className="ds-run-state" data-status={run.status}>
            {run.status === 'pending' ? (
              <>
                <LoaderCircle aria-hidden="true" />
                {t('running')}
              </>
            ) : (
              t(`status.${run.status}`)
            )}
          </span>
          <span>{relativeTime(run.createdAt)}</span>
        </>
      }
      actions={actions}
      onSelect={onOpen}
    />
  );
}
