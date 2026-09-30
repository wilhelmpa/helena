'use client';

import { useMemo, useState } from 'react';
import { Copy, MessagesSquare, Waypoints } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Button,
  EmptyState,
  Inline,
  List,
  ListRow,
  SearchField,
  Stack,
  Text,
} from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { RuntimeSession, SessionSearchHit } from '@/lib/api/endpoints/agentRuntime';
import { copyText } from '@/utils/clipboard';
import { compactTokens } from '@/utils/agentUsage';
import { AgentPage, AgentPages } from '@/features/teams/components/ai-agents/AgentPage';
import { useRuntimeSessions, useTranscript } from '../services/agentRuntime.service';
import { transcriptToMessages } from '../utils/messages';
import { sessionTitle } from '../utils/sessionTitle';
import RuntimeError from './RuntimeError';
import TranscriptMessages from './TranscriptMessages';

const PAGE = 25;

// The sessions of the agent's runtime the reader may see (runs of their projects, their own
// chats), newest first, each named after its run or chat, with a search over their messages;
// one opens as its full transcript, and a run's session also opens its run. The same frame,
// list and empty state as the other pages of the agent.
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
  return (
    <AgentPages>
      {open ? (
        <SessionTranscript
          teamId={teamId}
          agentId={agentId}
          sessionId={open.id}
          known={open.session}
          onBack={() => setOpen(null)}
          onOpenRun={onOpenRun}
        />
      ) : (
        <SessionList
          teamId={teamId}
          agentId={agentId}
          onOpen={(id, session) => setOpen({ id, session })}
        />
      )}
    </AgentPages>
  );
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
  const tPage = useTranslations('agentPages.sessions');
  const tTabs = useTranslations('agentRuntime.tabs');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const query = useRuntimeSessions(teamId, agentId, { q, offset });
  const page = query.data?.page;
  const hits = query.data?.hits;

  return (
    <AgentPage title={tTabs('sessions')} hint={tPage('hint')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setQ(draft.trim());
        }}
      >
        <Inline gap={2}>
          <SearchField
            className="ds-sessions-search"
            value={draft}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => setDraft(event.target.value)}
          />
          {q && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft('');
                setQ('');
              }}
            >
              {t('clear')}
            </Button>
          )}
        </Inline>
      </form>
      {query.isPending ? (
        <ListSkeleton rows={6} rowClassName="h-12" />
      ) : query.error ? (
        <RuntimeError error={query.error} />
      ) : hits ? (
        hits.length === 0 ? (
          <Text tone="muted">{t('noHits', { query: q })}</Text>
        ) : (
          <List label={tTabs('sessions')}>
            {hits.map((hit) => (
              <SearchHitRow
                key={hit.sessionId}
                hit={hit}
                onOpen={() => onOpen(hit.sessionId, hit.session)}
              />
            ))}
          </List>
        )
      ) : page && page.sessions.length > 0 ? (
        <Stack gap={3}>
          <List label={tTabs('sessions')}>
            {page.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onOpen={() => onOpen(session.id, session)}
              />
            ))}
          </List>
          <Inline gap={3} justify="between" wrap>
            <Text size="xs" tone="muted" tabular>
              {t('range', {
                from: offset + 1,
                to: offset + page.sessions.length,
                total: page.total,
              })}
            </Text>
            <Inline gap={2}>
              <Button
                size="small"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                {t('newer')}
              </Button>
              <Button
                size="small"
                disabled={offset + PAGE >= page.total}
                onClick={() => setOffset(offset + PAGE)}
              >
                {t('older')}
              </Button>
            </Inline>
          </Inline>
        </Stack>
      ) : (
        <EmptyState fill={false} icon={<MessagesSquare />} title={t('empty')}>
          {tPage('emptyHint')}
        </EmptyState>
      )}
    </AgentPage>
  );
}

function SessionRow({ session, onOpen }: { session: RuntimeSession; onOpen: () => void }) {
  const t = useTranslations('agentRuntime.sessions');
  const format = useFormatter();
  const at = session.lastActiveAt ?? session.startedAt;
  const origin =
    session.link?.runId != null
      ? t('source.run')
      : session.link?.chatThreadId
        ? t('source.chat')
        : session.source
          ? t(`source.${sourceKey(session.source)}`)
          : null;
  const notes = [
    origin,
    session.model,
    t('messages', { count: session.messageCount }),
    session.toolCallCount > 0 ? t('tools', { count: session.toolCallCount }) : null,
    `${compactTokens(session.usage.inputTokens)} / ${compactTokens(session.usage.outputTokens)}`,
  ].filter(Boolean);
  return (
    <ListRow
      title={sessionTitle(session, session.id)}
      subtitle={notes.join(' · ')}
      meta={at ? format.relativeTime(new Date(at)) : undefined}
      onSelect={onOpen}
    />
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
    <ListRow
      title={sessionTitle(hit.session, hit.sessionId)}
      subtitle={parts.map((part, index) =>
        part.startsWith('>>>') ? (
          <mark key={index} className="ds-mark">
            {part.slice(3, -3)}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
      onSelect={onOpen}
    />
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
    <AgentPage
      title={sessionTitle(known ?? session, sessionId)}
      hint={
        session
          ? `${session.model ?? ''} · ${compactTokens(session.usage.inputTokens)} / ${compactTokens(session.usage.outputTokens)}`
          : undefined
      }
      back={{ label: t('back'), onClick: onBack }}
      actions={
        <Inline gap={2} wrap>
          {known?.link?.runId != null && (
            <Button icon={<Waypoints />} onClick={() => onOpenRun(known.link!.runId!)}>
              {t('openRun')}
            </Button>
          )}
          <Button
            variant="ghost"
            icon={<Copy />}
            title={t('copyId')}
            onClick={() => void copyText(sessionId)}
          >
            {sessionId.slice(0, 12)}
          </Button>
        </Inline>
      }
    >
      {transcript.isPending ? (
        <ListSkeleton rows={5} rowClassName="h-12" />
      ) : transcript.error ? (
        <RuntimeError error={transcript.error} />
      ) : (
        <Stack gap={3}>
          {transcript.data?.truncated && (
            <Text size="xs" tone="muted">
              {t('truncated')}
            </Text>
          )}
          <TranscriptMessages messages={messages} />
        </Stack>
      )}
    </AgentPage>
  );
}
