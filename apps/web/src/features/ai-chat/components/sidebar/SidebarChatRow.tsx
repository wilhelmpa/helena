'use client';

import { useTranslations } from 'next-intl';
import type { ChatListView, ChatSummary } from '@/lib/api/endpoints/agentChat';
import { TreeItem } from '@/design-system';
import { chatHref } from '../../utils/chatHref';
import SidebarChatMenu from './SidebarChatMenu';

// One chat of the sidebar: a row of the tree that opens the chat in its place, with a
// status dot while an answer is being written and the row's menu on hover. In Home the
// chats of every project are listed, so a project's chat names its project at the end.
export default function SidebarChatRow({
  chat,
  view,
  projectKey,
  active,
  onRemoved,
  onOpenInPanel,
}: {
  chat: ChatSummary;
  view: ChatListView;
  // The place whose sidebar this is: a project, or null for Home.
  projectKey: string | null;
  active: boolean;
  onRemoved: (chat: ChatSummary) => void;
  // With the chat tool open in the panel a click opens the chat there and leaves the page.
  onOpenInPanel?: (chat: ChatSummary) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const title = chat.title || t('list.untitled');
  const where = chat.project ? `${chat.agent.name} · ${chat.project.name}` : chat.agent.name;
  return (
    <TreeItem
      label={<span dir="auto">{title}</span>}
      title={`${title} — ${where}`}
      href={chatHref(projectKey, { agentId: chat.agent.id, threadId: chat.id })}
      active={active}
      dot={chat.running ? 'working' : null}
      count={projectKey == null ? (chat.project?.key ?? null) : null}
      rowProps={
        onOpenInPanel
          ? {
              onClick: (event) => {
                event.preventDefault();
                onOpenInPanel(chat);
              },
            }
          : undefined
      }
      actions={<SidebarChatMenu chat={chat} view={view} onRemoved={onRemoved} />}
    />
  );
}
