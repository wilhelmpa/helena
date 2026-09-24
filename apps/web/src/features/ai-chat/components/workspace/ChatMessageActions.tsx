'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, ListPlus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { MessageAction, MessageActions } from '@/components/ai-elements/message';
import { copyText } from '@/utils/clipboard';
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

  async function copy() {
    await copyText(text);
    setCopied(true);
    toast.success(tCommon('copied'));
    setTimeout(() => setCopied(false), 1500);
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
