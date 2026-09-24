'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BookmarkPlus, Check, Copy, ListPlus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { MessageAction, MessageActions } from '@/components/ai-elements/message';
import { useCaptureMutation } from '@/services/everything.service';
import { copyText } from '@/utils/clipboard';
import { chatPath, homeChatPath } from '@/utils/paths';
import { messageText, type PlanUIMessage } from '../../utils/chatMessages';
import ChatToIssueDialog from './ChatToIssueDialog';
import ChatSpeakButton from './ChatSpeakButton';

export interface ChatMessageActionsProps {
  message: PlanUIMessage;
  isUser: boolean;
  projectKey: string | null;
  threadId: string | null;
  agentId: number;
  onEditRequest: () => void;
}

// The row of actions under a message: copy always, read aloud on an answer, edit on the
// member's own words, and turning the single message into a task — next to the
// whole-chat one in ChatHeader, for when only this part of it belongs in the backlog.
// Shown on hover or keyboard focus; always there on a touch screen.
export default function ChatMessageActions({
  message,
  isUser,
  projectKey,
  threadId,
  agentId,
  onEditRequest,
}: ChatMessageActionsProps) {
  const t = useTranslations('chatWorkspace');
  const tCommon = useTranslations('common');
  const [copied, setCopied] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const text = messageText(message);
  const router = useRouter();
  const tKnowledge = useTranslations('knowledge.capture');
  const capture = useCaptureMutation();

  async function copy() {
    await copyText(text);
    setCopied(true);
    toast.success(tCommon('copied'));
    setTimeout(() => setCopied(false), 1500);
  }

  // Keeps the message as a note in the Inbox of the chat's project (Home's without one),
  // with the chat it came from.
  function saveAsNote() {
    const location = { agent: agentId, thread: threadId };
    const origin = `${window.location.origin}${
      projectKey ? chatPath(projectKey, location) : homeChatPath(location)
    }`;
    const firstLine = text.split('\n').find((line) => line.trim()) ?? text;
    capture.mutate(
      {
        kind: 'chat-message',
        title: firstLine.replace(/^[#>*\-\s]+/, '').slice(0, 120) || tKnowledge('chatTitle'),
        text,
        origin,
        projectKey: projectKey ?? undefined,
        tags: ['chat'],
      },
      {
        onSuccess: (saved) =>
          toast.success(tKnowledge('saved'), {
            action: { label: tKnowledge('open'), onClick: () => router.push(saved.href) },
          }),
        onError: () => toast.error(tKnowledge('failed')),
      },
    );
  }

  return (
    <MessageActions className="opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
      {text && (
        <MessageAction label={tCommon('copy')} onClick={copy}>
          {copied ? <Check /> : <Copy />}
        </MessageAction>
      )}
      {!isUser && text && <ChatSpeakButton text={text} />}
      {isUser && (
        <MessageAction label={t('messages.edit')} onClick={onEditRequest}>
          <Pencil />
        </MessageAction>
      )}
      {text && (
        <MessageAction
          label={tKnowledge('saveMessage')}
          disabled={capture.isPending}
          onClick={saveAsNote}
        >
          <BookmarkPlus />
        </MessageAction>
      )}
      {projectKey && threadId && text && (
        <MessageAction label={t('issue.fromMessage')} onClick={() => setIssueOpen(true)}>
          <ListPlus />
        </MessageAction>
      )}
      {issueOpen && (
        <ChatToIssueDialog
          projectKey={projectKey!}
          threadId={threadId!}
          agentId={agentId}
          defaultTitle={text.slice(0, 120)}
          defaultDescription={text}
          onClose={() => setIssueOpen(false)}
        />
      )}
    </MessageActions>
  );
}
