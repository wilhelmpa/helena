'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, ListPlus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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

// The row of actions under a message: copy always, edit on the member's own words, and
// turning the single message into a task — next to the whole-chat one in ChatHeader, for when only this part of it
// belongs in the project's backlog.
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
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
      {text && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={copy}
          aria-label={tCommon('copy')}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      )}
      {!isUser && text && <ChatSpeakButton text={text} />}
      {isUser && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onEditRequest}
          aria-label={t('messages.edit')}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
      {projectKey && threadId && text && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => setIssueOpen(true)}
          aria-label={t('issue.fromMessage')}
        >
          <ListPlus className="size-3.5" />
        </Button>
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
    </div>
  );
}
