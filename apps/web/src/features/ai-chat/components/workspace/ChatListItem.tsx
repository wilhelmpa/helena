'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { Pin } from 'lucide-react';
import type { ChatListView, ChatSummary } from '@/lib/api/endpoints/agentChat';
import { cn } from '@/lib/utils';
import ChatListItemMenu from './ChatListItemMenu';

// Wraps the substrings of `text` matching `query` in <mark>, case-insensitively. Plain
// text in and text out otherwise — the snippet already came from the server escaped as
// data, never as markup.
function highlighted(text: string, query: string | undefined) {
  if (!query) return text;
  const pattern = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  const parts = text.split(pattern);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index % 2 === 1 ? (
        <mark className="rounded-sm bg-primary/20 text-inherit">{part}</mark>
      ) : (
        part
      )}
    </Fragment>
  ));
}

export default function ChatListItem({
  chat,
  view,
  selected,
  onSelect,
  highlightQuery,
}: {
  chat: ChatSummary;
  view: ChatListView;
  selected: boolean;
  onSelect: () => void;
  highlightQuery?: string;
}) {
  const t = useTranslations('chatWorkspace');
  const title = chat.title || t('list.untitled');

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md ps-2 pe-1',
        selected ? 'bg-accent' : 'hover:bg-accent/60',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="min-w-0 flex-1 rounded-md py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {chat.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
          <span dir="auto" title={title} className="min-w-0 truncate text-sm font-medium">
            {highlighted(title, highlightQuery)}
          </span>
          {chat.running && (
            <span
              className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
              aria-label={t('list.running')}
              role="status"
            />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span title={chat.agent.name} className="min-w-0 truncate">
            {chat.agent.name}
          </span>
          {chat.project && <span className="shrink-0">· {chat.project.name}</span>}
        </span>
        {chat.snippet && (
          <span dir="auto" className="line-clamp-1 text-xs text-muted-foreground">
            {highlighted(chat.snippet, highlightQuery)}
          </span>
        )}
      </button>
      <ChatListItemMenu chat={chat} view={view} />
    </div>
  );
}
