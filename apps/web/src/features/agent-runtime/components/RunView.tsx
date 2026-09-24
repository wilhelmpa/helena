'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, History, LoaderCircle, Play, ScrollText, Waypoints } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import Modal from '@/components/common/overlay/Modal';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import { cn } from '@/lib/utils';
import type { PlanUIMessage } from '@/features/ai-chat/utils/chatMessages';
import { copyText } from '@/utils/clipboard';
import { formatElapsed } from '@/utils/agentUsage';
import { issueIdentifierPath } from '@/utils/paths';
import {
  useContinueRun,
  useRunDetail,
  useRunEvents,
  useRuntimeLogs,
  useTranscript,
} from '../services/agentRuntime.service';
import { runEventsToMessage, transcriptToMessages } from '../utils/messages';
import AgentRunModel from '@/features/teams/components/ai-agents/AgentRunModel';
import ReflectionBlock from './ReflectionBlock';
import SpendChips from './SpendChips';
import TranscriptMessages from './TranscriptMessages';
import RuntimeError from './RuntimeError';

type View = 'timeline' | 'transcript' | 'logs';

// "Gläserner Lauf": one run of an agent as a timeline — its task, what the model reasoned,
// every tool call with its arguments and result, and its answer — live while the run runs
// and as a replay afterwards, with the model, tokens, time and cost it took. The full
// transcript of its session and the runtime's log lines of that session sit beside it, and
// "continue from here" resumes its session with a new instruction.
export default function RunView({
  teamId,
  agentId,
  runId,
  onBack,
  onOpenRun,
}: {
  teamId: number;
  agentId: number;
  runId: number;
  onBack: () => void;
  onOpenRun: (runId: number) => void;
}) {
  const t = useTranslations('agentRuntime.runs');
  const format = useFormatter();
  const detail = useRunDetail(teamId, agentId, runId);
  const run = detail.data;
  const live = run?.status === 'pending';
  const { events, loaded } = useRunEvents(teamId, agentId, runId, live);
  const [view, setView] = useState<View>('timeline');
  const [timeline, setTimeline] = useState<PlanUIMessage | null>(null);
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    let current = true;
    void runEventsToMessage(events, `run-${runId}`).then((message) => {
      if (current) setTimeline(message);
    });
    return () => {
      current = false;
    };
  }, [events, runId]);

  if (detail.isPending) return <ListSkeleton rows={4} className="p-4" rowClassName="h-10" />;
  if (!run) return <RuntimeError error={detail.error} />;

  const started = run.startedAt ? new Date(run.startedAt) : null;
  const ended = run.finishedAt ? new Date(run.finishedAt) : null;
  const views: { value: View; label: string; icon: typeof Waypoints }[] = [
    { value: 'timeline', label: t('timeline'), icon: Waypoints },
    { value: 'transcript', label: t('transcript'), icon: ScrollText },
    { value: 'logs', label: t('logs'), icon: History },
  ];
  const promptMessage: PlanUIMessage = {
    id: `task-${run.id}`,
    role: 'user',
    parts: [{ type: 'text', text: run.prompt, state: 'done' }],
    metadata: { createdAt: run.startedAt ?? run.createdAt },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onBack}
          aria-label={t('back')}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
        </Button>
        <Badge
          variant={run.status === 'failed' ? 'destructive' : 'secondary'}
          className="capitalize"
        >
          {live ? (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="size-3 animate-spin" />
              {t('running')}
            </span>
          ) : (
            t(`status.${run.status}`)
          )}
        </Badge>
        <span className="min-w-0 truncate text-sm font-medium">
          {run.issueIdentifier ? (
            <Link href={issueIdentifierPath(run.issueIdentifier)} className="hover:underline">
              {run.issueIdentifier}
              {run.issueTitle ? ` · ${run.issueTitle}` : ''}
            </Link>
          ) : (
            t(`trigger.${run.trigger}`)
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {started ? format.dateTime(started, { dateStyle: 'medium', timeStyle: 'short' }) : ''}
          {started && ended ? ` · ${formatElapsed(ended.getTime() - started.getTime())}` : ''}
          {run.resumes > 0 ? ` · ${t('resumed', { count: run.resumes })}` : ''}
        </span>
        <div className="ms-auto flex items-center gap-1">
          {run.sessionId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 font-mono text-xs"
              onClick={() => void copyText(run.sessionId!)}
              title={t('copySession')}
            >
              <Copy className="size-3.5" />
              {run.sessionId.slice(0, 18)}
            </Button>
          )}
          {!live && run.sessionId && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => setContinuing(true)}
            >
              <Play className="size-3.5" />
              {t('continue')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-2">
        <nav className="flex items-center gap-0.5" aria-label={t('views')}>
          {views.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={view === item.value}
              onClick={() => setView(item.value)}
              className={cn(
                PAGE_CONTROL_CLASS,
                'h-7',
                view === item.value && PAGE_CONTROL_ACTIVE_CLASS,
              )}
            >
              <item.icon aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ms-auto">
          <SpendChips rows={run.usage} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {view === 'timeline' && (
          <div className="mx-auto max-w-3xl space-y-4">
            {run.continuedFromRunId && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => onOpenRun(run.continuedFromRunId!)}
              >
                {t('continuesRun', { id: run.continuedFromRunId })}
              </button>
            )}
            <TranscriptMessages
              messages={timeline ? [promptMessage, timeline] : [promptMessage]}
              streaming={live}
              projectKey={run.projectKey}
            />
            {loaded && !timeline && !live && (
              <p className="text-sm text-muted-foreground">{t('noTimeline')}</p>
            )}
            {!live && run.output && !timeline && (
              <div className="rounded-md bg-card p-3 text-sm whitespace-pre-wrap">{run.output}</div>
            )}
            {run.status === 'failed' && run.lastError && (
              <p className="text-sm text-destructive">{run.lastError}</p>
            )}
            {run.blockedQuestion && (
              <div className="rounded-md border border-border/60 bg-card p-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground">{t('blocked')}</p>
                <p className="mt-1 whitespace-pre-wrap">{run.blockedQuestion}</p>
              </div>
            )}
            {run.modelCheck && <AgentRunModel check={run.modelCheck} />}
            {run.reflection && <ReflectionBlock reflection={run.reflection} />}
          </div>
        )}
        {view === 'transcript' && (
          <RunTranscript teamId={teamId} agentId={agentId} sessionId={run.sessionId} live={live} />
        )}
        {view === 'logs' && <RunLogs teamId={teamId} agentId={agentId} sessionId={run.sessionId} />}
      </div>

      {continuing && (
        <ContinueDialog
          teamId={teamId}
          agentId={agentId}
          runId={run.id}
          onClose={() => setContinuing(false)}
          onStarted={(next) => {
            setContinuing(false);
            onOpenRun(next);
          }}
        />
      )}
    </div>
  );
}

function RunTranscript({
  teamId,
  agentId,
  sessionId,
  live,
}: {
  teamId: number;
  agentId: number;
  sessionId: string | null;
  live: boolean;
}) {
  const t = useTranslations('agentRuntime.runs');
  const transcript = useTranscript(teamId, agentId, sessionId, live);
  const messages = useMemo(
    () => (transcript.data ? transcriptToMessages(transcript.data) : []),
    [transcript.data],
  );
  if (!sessionId) return <p className="text-sm text-muted-foreground">{t('noSession')}</p>;
  if (transcript.isPending) return <ListSkeleton rows={4} rowClassName="h-10" />;
  if (transcript.error) return <RuntimeError error={transcript.error} />;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {transcript.data?.truncated && (
        <p className="text-xs text-muted-foreground">{t('truncated')}</p>
      )}
      <TranscriptMessages messages={messages} streaming={live} />
    </div>
  );
}

function RunLogs({
  teamId,
  agentId,
  sessionId,
}: {
  teamId: number;
  agentId: number;
  sessionId: string | null;
}) {
  const t = useTranslations('agentRuntime.runs');
  const logs = useRuntimeLogs(teamId, agentId, { sessionId, lines: 500 }, sessionId != null);
  if (!sessionId) return <p className="text-sm text-muted-foreground">{t('noSession')}</p>;
  if (logs.isPending) return <ListSkeleton rows={4} rowClassName="h-6" />;
  if (logs.error) return <RuntimeError error={logs.error} />;
  if (!logs.data?.lines.length)
    return <p className="text-sm text-muted-foreground">{t('noLogs')}</p>;
  return (
    <pre
      dir="ltr"
      className="overflow-x-auto rounded-md bg-card p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
    >
      {logs.data.lines.join('\n')}
    </pre>
  );
}

function ContinueDialog({
  teamId,
  agentId,
  runId,
  onClose,
  onStarted,
}: {
  teamId: number;
  agentId: number;
  runId: number;
  onClose: () => void;
  onStarted: (runId: number) => void;
}) {
  const t = useTranslations('agentRuntime.runs');
  const tCommon = useTranslations('common');
  const [instruction, setInstruction] = useState('');
  const start = useContinueRun(teamId, agentId);
  return (
    <Modal title={t('continueTitle')} description={t('continueHint')} onClose={onClose}>
      <div className="space-y-4">
        <Textarea
          autoFocus
          rows={5}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={t('continuePlaceholder')}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={start.isPending}>
            {tCommon('cancel')}
          </Button>
          <Button
            disabled={!instruction.trim() || start.isPending}
            onClick={async () => {
              const next = await start.mutateAsync({ runId, instruction: instruction.trim() });
              onStarted(next.runId);
            }}
          >
            {t('continueStart')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
