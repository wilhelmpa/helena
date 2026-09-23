'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { Pin } from 'lucide-react';
import type { ChatListView, ChatSummary } from '@/lib/api/endpoints/agentChat';
import { cn } from '@/lib/utils';
import Avatar from '@/components/common/Avatar';
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
        <mark className="rounded-sm bg-brand-subtle text-inherit">{part}</mark>
      ) : (
        part
      )}
    </Fragment>
  ));
}

// One chat of the list, as a sidebar row: the agent's avatar where the sidebar has its
// icon, the title, a pulsing dot while an answer is being written, and the row's menu
// on hover. A search hit adds the text around the match as a second line.
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
  const subtitle = chat.project ? `${chat.agent.name} · ${chat.project.name}` : chat.agent.name;

  return (
    <div
      data-active={selected}
      className="group/chat-row relative flex min-w-0 items-center rounded-md hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent"
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        title={`${title} — ${subtitle}`}
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-center rounded-md px-2 pe-8 text-start text-sm ring-sidebar-ring outline-hidden focus-visible:ring-2',
          chat.snippet ? 'min-h-8 py-1.5' : 'h-8',
          selected && 'font-medium',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={chat.agent.name} className="size-4" aria-hidden />
          <span dir="auto" className="min-w-0 truncate">
            {highlighted(title, highlightQuery)}
          </span>
          {chat.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
          {chat.running && (
            <span
              className="size-1.5 shrink-0 animate-pulse rounded-full bg-status-running motion-reduce:animate-none"
              aria-label={t('list.running')}
              role="status"
            />
          )}
        </span>
        {chat.snippet && (
          <span dir="auto" className="line-clamp-1 ps-6 text-xs font-normal text-muted-foreground">
            {highlighted(chat.snippet, highlightQuery)}
          </span>
        )}
      </button>
      <div className="absolute end-0.5 top-0.5">
        <ChatListItemMenu chat={chat} view={view} />
      </div>
    </div>
  );
}
