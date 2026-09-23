'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ListPlus, PanelLeft, PanelRight, PanelRightClose } from 'lucide-react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/button';
import { useChatListMutations } from '../../hooks/useChatList';
import { useChatSummary } from '../../hooks/useChatSummary';
import { messageText, type PlanUIMessage } from '../../utils/chatMessages';
import ChatRenameDialog from './ChatRenameDialog';
import ChatToIssueDialog from './ChatToIssueDialog';
import ChatHeaderMenu from './ChatHeaderMenu';

export interface ChatHeaderProps {
  scopeKey: string;
  projectKey: string | null;
  agent: AiAgent;
  threadId: string | null;
  messages: PlanUIMessage[];
  onOpenList: () => void;
  compact: boolean;
  artifactOpen: boolean;
  onToggleArtifact: () => void;
  hasArtifact: boolean;
}

// The bar above the conversation: opening the list on a narrow layout, the chat's
// title (renamed in place), who it is with, turning it into a task, and the artifact
// panel's toggle. Kept to one row and h-12, the height every other workspace header in
// the app uses (see WorkspaceHeader), so the chat reads as part of Helena, not a
// separate app glued on.
export default function ChatHeader({
  scopeKey,
  projectKey,
  agent,
  threadId,
  messages,
  onOpenList,
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
    <WorkspaceHeader className="gap-2 bg-background px-3">
      {compact && (
        <Button variant="ghost" size="icon" onClick={onOpenList} aria-label={t('list.open')}>
          <PanelLeft className="size-4" />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => threadId && setRenaming(true)}
          disabled={!threadId}
          className="max-w-full truncate rounded-md px-1 text-start text-sm font-medium hover:bg-accent disabled:pointer-events-none"
        >
          {threadId ? title : t('list.newChat')}
        </button>
        <p className="truncate px-1 text-xs text-muted-foreground">
          {agent.name}
          {chat.data?.project && ` · ${chat.data.project.name}`}
        </p>
      </div>
      {threadId && messages.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setIssueOpen(true)}>
          <ListPlus className="size-4" /> {t('issue.fromChat')}
        </Button>
      )}
      {hasArtifact && (
        <Button
          variant={artifactOpen ? 'secondary' : 'ghost'}
          size="icon"
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
