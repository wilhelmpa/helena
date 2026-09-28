'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { AgentRun } from '@/lib/api/endpoints/agents';
import { useAgentRuns, useSetAgentRunArchived } from '@/services/aiAgents.service';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { compactTokens } from '@/utils/agentUsage';
import AutopilotLevelBadge from '@/features/autopilot/components/AutopilotLevelBadge';
import RunView from './RunView';
import { isModelRefusal } from '@/features/model-availability/utils/modelFailure';

// The agent's runs, newest first; one opens as its timeline ("Gläserner Lauf").
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
  return <RunList teamId={teamId} agentId={agentId} onOpen={onRunChange} />;
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
  const tCommon = useTranslations('common');
  // Runs are never deleted: a finished one is archived out of this list, and the switch
  // shows the archived ones again.
  const [showArchived, setShowArchived] = useState(false);
  const query = useAgentRuns(teamId, agentId, showArchived);
  const archive = useSetAgentRunArchived(teamId, agentId);
  const runs = query.data?.pages.flatMap((page) => page.items) ?? [];
  const toggle = (
    <label className="mb-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
      {t('showArchived')}
      <Switch size="sm" checked={showArchived} onCheckedChange={setShowArchived} />
    </label>
  );
  if (query.isPending) return <ListSkeleton rows={5} className="p-4" rowClassName="h-11" />;
  if (runs.length === 0)
    return (
      <div className="p-4">
        {toggle}
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {toggle}
      <ul className="divide-y divide-border/50 overflow-hidden rounded-md bg-card">
        {runs.map((run) => {
          const archived = Boolean(run.archivedAt);
          return (
            <li key={run.id} className="flex items-center">
              <div className="min-w-0 flex-1">
                <RunRow run={run} onOpen={() => onOpen(run.id)} />
              </div>
              {run.status !== 'pending' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="me-1 size-8 shrink-0 text-muted-foreground"
                  title={archived ? t('unarchive') : t('archive')}
                  aria-label={archived ? t('unarchive') : t('archive')}
                  disabled={archive.isPending}
                  onClick={() =>
                    archive.mutate(
                      { runId: run.id, archived: !archived },
                      { onError: () => toast.error(t('archiveFailed')) },
                    )
                  }
                >
                  {archived ? (
                    <ArchiveRestore className="size-4" />
                  ) : (
                    <Archive className="size-4" />
                  )}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {query.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? tCommon('loading') : t('loadMore')}
        </Button>
      )}
    </div>
  );
}

export function RunRow({ run, onOpen }: { run: AgentRun; onOpen: () => void }) {
  const t = useTranslations('agentRuntime.runs');
  const tModel = useTranslations('modelAvailability');
  const relativeTime = useRelativeTime();
  const subject = run.issueIdentifier
    ? `${run.issueIdentifier}${run.issueTitle ? ` · ${run.issueTitle}` : ''}`
    : t(`trigger.${run.trigger}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm hover:bg-accent"
    >
      <Badge
        variant={
          run.status === 'failed'
            ? 'destructive'
            : run.status === 'pending'
              ? 'outline'
              : 'secondary'
        }
        className="shrink-0"
      >
        {run.status === 'pending' ? (
          <span className="inline-flex items-center gap-1">
            <LoaderCircle className="size-3 animate-spin" />
            {t('running')}
          </span>
        ) : (
          t(`status.${run.status}`)
        )}
      </Badge>
      <span className="min-w-0 flex-1 truncate">{subject}</span>
      <AutopilotLevelBadge level={run.autopilotLevel} />
      {run.archivedAt && (
        <Badge variant="outline" className="shrink-0 text-muted-foreground">
          {t('archived')}
        </Badge>
      )}
      {run.blockedQuestion && (
        <Badge variant="outline" className="shrink-0 border-status-waiting/50 text-status-waiting">
          {t('blocked')}
        </Badge>
      )}
      {isModelRefusal(run.failure) && (
        <Badge
          variant="outline"
          className="shrink-0 border-destructive/50 text-destructive"
          title={run.lastError ?? undefined}
        >
          {tModel('refusedShort')}
        </Badge>
      )}
      {run.modelRoute?.routed && (
        <Badge
          variant="outline"
          className="shrink-0"
          title={`${run.modelRoute.fromModel} → ${run.modelRoute.toModel}`}
        >
          {`→ ${run.modelRoute.toModel}`}
        </Badge>
      )}
      {run.modelCheck && run.modelCheck.mismatch.length > 0 && (
        <Badge variant="outline" className="shrink-0 border-status-waiting/50 text-status-waiting">
          {t('modelMismatch')}
        </Badge>
      )}
      {run.contextTokens !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">
          {compactTokens(run.contextTokens)}
        </span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(run.createdAt)}</span>
    </button>
  );
}
