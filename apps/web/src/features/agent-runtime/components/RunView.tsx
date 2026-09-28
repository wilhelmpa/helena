'use client';

import { ModelRouteLine } from '@/features/decisions/components/ModelRouteLine';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Play } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import Modal from '@/components/common/overlay/Modal';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import {
  DetailGroup,
  DetailHeader,
  DetailView,
  More,
  Pill,
  Segmented,
  StatusDot,
  type PillTone,
} from '@/design-system';
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
import ModelFailureNote from '@/features/model-availability/components/ModelFailureNote';
import { knownFailure } from '@/features/model-availability/utils/modelFailure';
import RunResults from './RunResults';
import RunSteps from './RunSteps';

type View = 'timeline' | 'transcript' | 'logs';

const TONES: Record<string, PillTone> = {
  pending: 'accent',
  success: 'neutral',
  failed: 'danger',
  canceled: 'neutral',
};

// "Gläserner Lauf" (docs/design-system.md §4, owner P6 "Ergebnis zuerst"): one run of an
// agent in the detail pattern — its task as the title with status and time, then what it
// delivered first (its closing answer and the result cards: file, preview, PR,
// screenshot), then its steps as a checklist, what it spent, and at the very end, folded,
// the raw protocol (the timeline of model and tool events, the session's transcript and
// the runtime's log). Live while the run runs; "Ab hier fortsetzen" resumes its session.
// It shows the same on the agent's Läufe tab and in the overlay over Verlauf.
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
  // The list it was opened from; absent in the overlay.
  onBack?: () => void;
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
  const promptMessage: PlanUIMessage = {
    id: `task-${run.id}`,
    role: 'user',
    parts: [{ type: 'text', text: run.prompt, state: 'done' }],
    metadata: { createdAt: run.startedAt ?? run.createdAt },
  };
  const title = run.issueIdentifier ? (
    <Link href={issueIdentifierPath(run.issueIdentifier)} className="ds-run-title-link">
      <span className="ds-issue-key">{run.issueIdentifier}</span>
      {run.issueTitle ? ` ${run.issueTitle}` : ''}
    </Link>
  ) : (
    t(`trigger.${run.trigger}`)
  );
  const meta = [
    started ? format.dateTime(started, { dateStyle: 'medium', timeStyle: 'short' }) : '',
    started && ended ? formatElapsed(ended.getTime() - started.getTime()) : '',
    run.resumes > 0 ? t('resumed', { count: run.resumes }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="ds-run">
      {onBack && (
        <button type="button" className="ds-run-back" onClick={onBack}>
          <ArrowLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
          {t('back')}
        </button>
      )}
      <DetailView>
        <DetailHeader
          title={title}
          status={
            <Pill tone={TONES[run.status] ?? 'neutral'}>
              {live ? t('running') : t(`status.${run.status}`)}
              {live && <StatusDot tone="working" />}
            </Pill>
          }
          meta={meta}
          actions={
            <>
              {run.sessionId && (
                <button
                  type="button"
                  className="ds-page-control ds-run-session"
                  onClick={() => void copyText(run.sessionId!)}
                  title={t('copySession')}
                >
                  <Copy size={14} aria-hidden="true" />
                  <span dir="ltr">{run.sessionId.slice(0, 12)}</span>
                </button>
              )}
              {!live && run.sessionId && (
                <button
                  type="button"
                  className="ds-page-control ds-page-primary"
                  onClick={() => setContinuing(true)}
                >
                  <Play size={14} aria-hidden="true" />
                  {t('continue')}
                </button>
              )}
            </>
          }
        />

        {run.continuedFromRunId && (
          <button
            type="button"
            className="ds-run-continues"
            onClick={() => onOpenRun(run.continuedFromRunId!)}
          >
            {t('continuesRun', { id: run.continuedFromRunId })}
          </button>
        )}

        <DetailGroup title={t('results')}>
          <RunResults run={run} />
          {run.status === 'failed' && knownFailure(run.failure) ? (
            <ModelFailureNote
              failure={run.failure}
              error={run.lastError}
              className="ds-run-error"
            />
          ) : (
            run.status === 'failed' &&
            run.lastError && <p className="ds-run-error">{run.lastError}</p>
          )}
          {run.blockedQuestion && (
            <div className="ds-run-blocked">
              <span className="ds-mono-label">{t('blocked')}</span>
              <p>{run.blockedQuestion}</p>
            </div>
          )}
        </DetailGroup>

        <DetailGroup title={t('steps')}>
          <RunSteps events={events} />
        </DetailGroup>

        <DetailGroup title={t('spent')}>
          <SpendChips rows={run.usage} />
          {run.modelCheck && <AgentRunModel check={run.modelCheck} />}
          {run.modelRoute && <ModelRouteLine route={run.modelRoute} />}
        </DetailGroup>

        {run.reflection && (
          <DetailGroup>
            <ReflectionBlock reflection={run.reflection} />
          </DetailGroup>
        )}

        <More label={t('rawProtocol')}>
          <Segmented
            value={view}
            onChange={setView}
            label={t('views')}
            options={[
              { value: 'timeline', label: t('timeline') },
              { value: 'transcript', label: t('transcript') },
              { value: 'logs', label: t('logs') },
            ]}
          />
          <div className="ds-run-raw">
            {view === 'timeline' && (
              <>
                <TranscriptMessages
                  messages={timeline ? [promptMessage, timeline] : [promptMessage]}
                  streaming={live}
                  projectKey={run.projectKey}
                />
                {loaded && !timeline && !live && <p className="ds-run-note">{t('noTimeline')}</p>}
              </>
            )}
            {view === 'transcript' && (
              <RunTranscript
                projectKey={run.projectKey}
                teamId={teamId}
                agentId={agentId}
                sessionId={run.sessionId}
                live={live}
              />
            )}
            {view === 'logs' && (
              <RunLogs teamId={teamId} agentId={agentId} sessionId={run.sessionId} />
            )}
          </div>
        </More>
      </DetailView>

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
  projectKey,
  teamId,
  agentId,
  sessionId,
  live,
}: {
  projectKey: string | null;
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
  if (!sessionId) return <p className="ds-run-note">{t('noSession')}</p>;
  if (transcript.isPending) return <ListSkeleton rows={4} rowClassName="h-10" />;
  if (transcript.error) return <RuntimeError error={transcript.error} />;
  return (
    <div className="ds-stack">
      {transcript.data?.truncated && <p className="ds-run-note">{t('truncated')}</p>}
      <TranscriptMessages projectKey={projectKey} messages={messages} streaming={live} />
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
  if (!sessionId) return <p className="ds-run-note">{t('noSession')}</p>;
  if (logs.isPending) return <ListSkeleton rows={4} rowClassName="h-6" />;
  if (logs.error) return <RuntimeError error={logs.error} />;
  if (!logs.data?.lines.length) return <p className="ds-run-note">{t('noLogs')}</p>;
  return (
    <pre dir="ltr" className="ds-run-log">
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
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <Modal
      title={t('continueTitle')}
      description={t('continueHint')}
      onClose={onClose}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        field.current?.focus();
      }}
    >
      <div className="space-y-4">
        <Textarea
          ref={field}
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
