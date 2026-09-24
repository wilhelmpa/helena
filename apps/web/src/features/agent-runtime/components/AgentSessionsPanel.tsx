'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Copy, Search, Waypoints } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { RuntimeSession, SessionSearchHit } from '@/lib/api/endpoints/agentRuntime';
import { copyText } from '@/utils/clipboard';
import { compactTokens } from '@/utils/agentUsage';
import { useRuntimeSessions, useTranscript } from '../services/agentRuntime.service';
import { transcriptToMessages } from '../utils/messages';
import RuntimeError from './RuntimeError';
import TranscriptMessages from './TranscriptMessages';

const PAGE = 25;

// The sessions of the agent's runtime the reader may see (runs of their projects, their own
// chats), newest first, each named after its run or chat, with a search over their messages;
// one opens as its full transcript, and a run's session also opens its run.
export default function AgentSessionsPanel({
  teamId,
  agentId,
  onOpenRun,
}: {
  teamId: number;
  agentId: number;
  onOpenRun: (runId: number) => void;
}) {
  const [open, setOpen] = useState<{ id: string; session: RuntimeSession | null } | null>(null);
  if (open) {
    return (
      <SessionTranscript
        teamId={teamId}
        agentId={agentId}
        sessionId={open.id}
        known={open.session}
        onBack={() => setOpen(null)}
        onOpenRun={onOpenRun}
      />
    );
  }
  return (
    <SessionList
      teamId={teamId}
      agentId={agentId}
      onOpen={(id, session) => setOpen({ id, session })}
    />
  );
}

// What a session was in Helena (the task of its run, the title of its chat), else the
// runtime's own title.
function sessionTitle(session: RuntimeSession | null | undefined, fallback: string): string {
  const link = session?.link;
  if (link?.issueIdentifier) {
    return link.issueTitle ? `${link.issueIdentifier} · ${link.issueTitle}` : link.issueIdentifier;
  }
  return link?.chatTitle ?? session?.title ?? session?.preview ?? fallback;
}

function SessionList({
  teamId,
  agentId,
  onOpen,
}: {
  teamId: number;
  agentId: number;
  onOpen: (sessionId: string, session: RuntimeSession | null) => void;
}) {
  const t = useTranslations('agentRuntime.sessions');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const query = useRuntimeSessions(teamId, agentId, { q, offset });
  const page = query.data?.page;
  const hits = query.data?.hits;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="flex items-center gap-2 border-b border-border/60 px-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setQ(draft.trim());
        }}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('search')}
          className="h-8 border-none bg-transparent shadow-none focus-visible:ring-0"
        />
        {q && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => {
              setDraft('');
              setQ('');
            }}
          >
            {t('clear')}
          </Button>
        )}
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {query.isPending ? (
          <ListSkeleton rows={6} rowClassName="h-12" />
        ) : query.error ? (
          <RuntimeError error={query.error} />
        ) : hits ? (
          hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noHits', { query: q })}</p>
          ) : (
            <ul className="divide-y divide-border/50 overflow-hidden rounded-md bg-card">
              {hits.map((hit) => (
                <li key={hit.sessionId}>
                  <SearchHitRow hit={hit} onOpen={() => onOpen(hit.sessionId, hit.session)} />
                </li>
              ))}
            </ul>
          )
        ) : page && page.sessions.length > 0 ? (
          <>
            <ul className="divide-y divide-border/50 overflow-hidden rounded-md bg-card">
              {page.sessions.map((session) => (
                <li key={session.id}>
                  <SessionRow session={session} onOpen={() => onOpen(session.id, session)} />
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t('range', {
                  from: offset + 1,
                  to: offset + page.sessions.length,
                  total: page.total,
                })}
              </span>
              <span className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  {t('newer')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE >= page.total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  {t('older')}
                </Button>
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        )}
      </div>
    </div>
  );
}

function SessionRow({ session, onOpen }: { session: RuntimeSession; onOpen: () => void }) {
  const t = useTranslations('agentRuntime.sessions');
  const format = useFormatter();
  const at = session.lastActiveAt ?? session.startedAt;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-start hover:bg-accent"
    >
      <span className="flex w-full items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate" dir="auto">
          {sessionTitle(session, session.id)}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {at ? format.relativeTime(new Date(at)) : ''}
        </span>
      </span>
      <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {session.link?.runId != null ? (
          <span>{t('source.run')}</span>
        ) : session.link?.chatThreadId ? (
          <span>{t('source.chat')}</span>
        ) : (
          session.source && <span>{t(`source.${sourceKey(session.source)}`)}</span>
        )}
        {session.model && <span dir="ltr">{session.model}</span>}
        <span>{t('messages', { count: session.messageCount })}</span>
        {session.toolCallCount > 0 && <span>{t('tools', { count: session.toolCallCount })}</span>}
        <span dir="ltr">
          {compactTokens(session.usage.inputTokens)} / {compactTokens(session.usage.outputTokens)}
        </span>
      </span>
    </button>
  );
}

// Hermes names where a session came from; the ones Helena starts are "tool".
function sourceKey(source: string): 'tool' | 'cli' | 'claude' | 'codex' | 'other' {
  return (['tool', 'cli', 'claude', 'codex'] as const).find((known) => known === source) ?? 'other';
}

// The matching words come marked with >>> and <<<.
function SearchHitRow({ hit, onOpen }: { hit: SessionSearchHit; onOpen: () => void }) {
  const parts = hit.snippet.split(/(>>>.*?<<<)/g);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-start hover:bg-accent"
    >
      <span className="truncate text-sm" dir="auto">
        {sessionTitle(hit.session, hit.sessionId)}
      </span>
      <span className="line-clamp-2 text-xs text-muted-foreground">
        {parts.map((part, index) =>
          part.startsWith('>>>') ? (
            <mark key={index} className="rounded-sm bg-accent px-0.5 text-foreground">
              {part.slice(3, -3)}
            </mark>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
      </span>
    </button>
  );
}

function SessionTranscript({
  teamId,
  agentId,
  sessionId,
  known,
  onBack,
  onOpenRun,
}: {
  teamId: number;
  agentId: number;
  sessionId: string;
  // The session as the list showed it, with what it was in Helena.
  known: RuntimeSession | null;
  onBack: () => void;
  onOpenRun: (runId: number) => void;
}) {
  const t = useTranslations('agentRuntime.sessions');
  const transcript = useTranscript(teamId, agentId, sessionId);
  const messages = useMemo(
    () => (transcript.data ? transcriptToMessages(transcript.data) : []),
    [transcript.data],
  );
  const session = transcript.data?.session;
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
        <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
          {sessionTitle(known ?? session, sessionId)}
        </span>
        {known?.link?.runId != null && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onOpenRun(known.link!.runId!)}
          >
            <Waypoints />
            {t('openRun')}
          </Button>
        )}
        {session && (
          <span className="text-xs text-muted-foreground" dir="ltr">
            {session.model} · {compactTokens(session.usage.inputTokens)} /{' '}
            {compactTokens(session.usage.outputTokens)}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 font-mono text-xs"
          onClick={() => void copyText(sessionId)}
          title={t('copyId')}
        >
          <Copy className="size-3.5" />
          {sessionId.slice(0, 18)}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {transcript.isPending ? (
          <ListSkeleton rows={5} rowClassName="h-12" />
        ) : transcript.error ? (
          <RuntimeError error={transcript.error} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-3">
            {transcript.data?.truncated && (
              <p className="text-xs text-muted-foreground">{t('truncated')}</p>
            )}
            <TranscriptMessages messages={messages} />
          </div>
        )}
      </div>
    </div>
  );
}
