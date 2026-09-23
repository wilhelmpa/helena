'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PanelLeft, PanelRight, PanelRightClose, SquarePen } from 'lucide-react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/button';
import { useChatListMutations } from '../../hooks/useChatList';
import { useChatSummary } from '../../hooks/useChatSummary';
import type { ChatAgentState } from '../../utils/agentPresence';
import { messageText, type PlanUIMessage } from '../../utils/chatMessages';
import ChatRenameDialog from './ChatRenameDialog';
import ChatToIssueDialog from './ChatToIssueDialog';
import ChatHeaderMenu from './ChatHeaderMenu';
import ChatAgentMenu from './ChatAgentMenu';

export interface ChatHeaderProps {
  scopeKey: string;
  projectKey: string | null;
  agent: AiAgent;
  agents: AiAgent[];
  states: Map<number, ChatAgentState>;
  threadId: string | null;
  messages: PlanUIMessage[];
  onOpenList: () => void;
  onNewChat: (agentId: number) => void;
  compact: boolean;
  artifactOpen: boolean;
  onToggleArtifact: () => void;
  hasArtifact: boolean;
}

// The bar above the conversation, one filigree row like the tool panel's: opening the
// list on a narrow layout, the chat's title (renamed on click), who it is with (and a
// new chat with someone else, ChatAgentMenu), a new chat, the artifact panel's toggle
// and the chat's own menu.
export default function ChatHeader({
  scopeKey,
  projectKey,
  agent,
  agents,
  states,
  threadId,
  messages,
  onOpenList,
  onNewChat,
  compact,
  artifactOpen,
  onToggleArtifact,
  hasArtifact,
}: ChatHeaderProps) {
  const t = useTranslations('chatWorkspace');
  const chat = useChatSummary(threadId);
  const { rename } = useChatListMutations();
  const [renaming, setRenaming] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const title = chat.data?.title || t('list.untitled');
  const wholeChatText = messages.map(messageText).filter(Boolean).join('\n\n');

  return (
    <WorkspaceHeader className="h-10 gap-1 border-sidebar-border bg-background px-2">
      {compact && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onOpenList}
          aria-label={t('list.open')}
        >
          <PanelLeft className="size-4" />
        </Button>
      )}
      <button
        type="button"
        onClick={() => threadId && setRenaming(true)}
        disabled={!threadId}
        title={threadId ? t('list.rename') : undefined}
        className="h-8 min-w-0 flex-1 truncate rounded-md px-2 text-start text-sm font-medium ring-sidebar-ring outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 disabled:pointer-events-none"
      >
        <span dir="auto">{threadId ? title : t('list.newChat')}</span>
      </button>
      <ChatAgentMenu agent={agent} agents={agents} states={states} onNewChat={onNewChat} />
      {threadId && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onNewChat(agent.id)}
          aria-label={t('list.newChat')}
          title={t('list.newChat')}
        >
          <SquarePen className="size-4" />
        </Button>
      )}
      {hasArtifact && (
        <Button
          variant={artifactOpen ? 'secondary' : 'ghost'}
          size="icon"
          className="size-8"
          onClick={onToggleArtifact}
          aria-pressed={artifactOpen}
          aria-label={t('artifact.toggle')}
        >
          {artifactOpen ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRight className="size-4" />
          )}
        </Button>
      )}
      {threadId && (
        <ChatHeaderMenu
          scopeKey={scopeKey}
          threadId={threadId}
          chat={chat.data}
          messages={messages}
          agentName={agent.name}
          onRename={() => setRenaming(true)}
          onToIssue={projectKey && messages.length > 0 ? () => setIssueOpen(true) : undefined}
          onDeleted={() => onNewChat(agent.id)}
        />
      )}
      {renaming && threadId && (
        <ChatRenameDialog
          initialTitle={title}
          onClose={() => setRenaming(false)}
          onConfirm={(value) => rename.mutateAsync({ threadId, title: value })}
        />
      )}
      {issueOpen && threadId && projectKey && (
        <ChatToIssueDialog
          projectKey={projectKey}
          threadId={threadId}
          agentId={agent.id}
          defaultTitle={title !== t('list.untitled') ? title : wholeChatText.slice(0, 120)}
          defaultDescription={wholeChatText}
          onClose={() => setIssueOpen(false)}
        />
      )}
    </WorkspaceHeader>
  );
}
