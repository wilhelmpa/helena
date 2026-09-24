'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { usePanelHeaderSlot } from '@/context/panelHeaderSlot';
import { useTranslations } from 'next-intl';
import { PanelLeft, PanelRight, PanelRightClose, SquarePen } from 'lucide-react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import {
  PAGE_CONTROL_ACTIVE_CLASS,
  PAGE_CONTROL_CLASS,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import { cn } from '@/lib/utils';
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
  onNewChat: (agentId: number) => void;
  onDeleted: (threadId: string) => void;
  compact: boolean;
  artifactOpen: boolean;
  onToggleArtifact: () => void;
  hasArtifact: boolean;
  // The chat page (/chat): its bar is the app header's one row (PageToolbar), like
  // every page's. In the tool panel it stays the panel's own row under its header.
  inPage?: boolean;
}

// The bar above the conversation, one filigree row like the tool panel's: opening the
// list on a narrow layout, the chat's title (renamed on click), a new chat, the artifact
// panel's toggle and the chat's own menu. Who the chat is with and how the answer is
// doing live at the composer (ChatComposer), where they are steered.
export default function ChatHeader({
  scopeKey,
  projectKey,
  agent,
  threadId,
  messages,
  onOpenList,
  onNewChat,
  onDeleted,
  compact,
  artifactOpen,
  onToggleArtifact,
  hasArtifact,
  inPage = false,
}: ChatHeaderProps) {
  const t = useTranslations('chatWorkspace');
  const chat = useChatSummary(threadId);
  const { rename } = useChatListMutations();
  const [renaming, setRenaming] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const title = chat.data?.title || t('list.untitled');
  const wholeChatText = messages.map(messageText).filter(Boolean).join('\n\n');
  // In the tool panel the chat's bar joins the panel header's row (its title slot).
  const panelSlot = usePanelHeaderSlot();

  const dialogs = (
    <>
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
    </>
  );

  if (inPage) {
    return (
      <PageToolbar>
        {compact && (
          <button
            type="button"
            onClick={onOpenList}
            aria-label={t('list.open')}
            className={cn(PAGE_CONTROL_CLASS, 'w-8 justify-center px-0')}
          >
            <PanelLeft aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => threadId && setRenaming(true)}
          disabled={!threadId}
          title={threadId ? t('list.rename') : undefined}
          className={cn(
            PAGE_CONTROL_CLASS,
            'min-w-0 shrink font-medium text-foreground disabled:opacity-100',
          )}
        >
          <span dir="auto" className="truncate">
            {threadId ? title : t('list.newChat')}
          </span>
        </button>
        <PageToolbarSpacer />
        {threadId && (
          <button
            type="button"
            onClick={() => onNewChat(agent.id)}
            aria-label={t('list.newChat')}
            title={t('list.newChat')}
            className={cn(PAGE_CONTROL_CLASS, 'w-8 justify-center px-0')}
          >
            <SquarePen aria-hidden="true" />
          </button>
        )}
        {hasArtifact && (
          <button
            type="button"
            onClick={onToggleArtifact}
            aria-pressed={artifactOpen}
            aria-label={t('artifact.toggle')}
            className={cn(
              PAGE_CONTROL_CLASS,
              'w-8 justify-center px-0',
              artifactOpen && PAGE_CONTROL_ACTIVE_CLASS,
            )}
          >
            {artifactOpen ? (
              <PanelRightClose aria-hidden="true" />
            ) : (
              <PanelRight aria-hidden="true" />
            )}
          </button>
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
            onDeleted={() => onDeleted(threadId)}
          />
        )}
        {dialogs}
      </PageToolbar>
    );
  }

  if (!inPage && panelSlot) {
    const control =
      'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4';
    return createPortal(
      <>
        {compact && (
          <button
            type="button"
            onClick={onOpenList}
            aria-label={t('list.open')}
            className={control}
          >
            <PanelLeft aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => threadId && setRenaming(true)}
          disabled={!threadId}
          title={threadId ? t('list.rename') : undefined}
          className="h-7 min-w-0 flex-1 truncate rounded-md px-1.5 text-start text-sm font-medium hover:bg-accent disabled:pointer-events-none"
        >
          <span dir="auto">{threadId ? title : t('list.newChat')}</span>
        </button>
        {threadId && (
          <button
            type="button"
            onClick={() => onNewChat(agent.id)}
            aria-label={t('list.newChat')}
            title={t('list.newChat')}
            className={control}
          >
            <SquarePen aria-hidden="true" />
          </button>
        )}
        {hasArtifact && (
          <button
            type="button"
            onClick={onToggleArtifact}
            aria-pressed={artifactOpen}
            aria-label={t('artifact.toggle')}
            className={cn(control, artifactOpen && 'bg-accent text-foreground')}
          >
            {artifactOpen ? (
              <PanelRightClose aria-hidden="true" />
            ) : (
              <PanelRight aria-hidden="true" />
            )}
          </button>
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
            onDeleted={() => onDeleted(threadId)}
          />
        )}
        {dialogs}
      </>,
      panelSlot,
    );
  }

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
          onDeleted={() => onDeleted(threadId)}
        />
      )}
      {dialogs}
    </WorkspaceHeader>
  );
}
