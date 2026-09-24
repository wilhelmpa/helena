'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CHAT_PROMPT_LIMIT, messageText, type PlanUIMessage } from '../../utils/chatMessages';
import ChatAttachmentChip from './ChatAttachmentChip';

// The member's own message: plain text (Markdown is not rendered back at them — they
// typed it, they know what it says) and its attachments. Editing (the pencil under it,
// or ↑ in an empty composer) turns this into a small form — ⌘/Ctrl+Enter saves, Escape
// cancels; saving does not change history, it sends the edit as a new branch from the
// same parent, which ChatBranchNav then lets the reader step between.
export default function ChatMessageBubbleUser({
  message,
  editing,
  onStopEditing,
  onEdit,
}: {
  message: PlanUIMessage;
  editing: boolean;
  onStopEditing: () => void;
  onEdit: (text: string) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const tCommon = useTranslations('common');
  const text = messageText(message);
  const [draft, setDraft] = useState(text);
  const attachments = message.metadata?.attachments ?? [];

  const cancel = () => {
    setDraft(text);
    onStopEditing();
  };
  const save = () => {
    if (!draft.trim()) return;
    onEdit(draft.trim());
    onStopEditing();
  };

  if (editing) {
    return (
      <BubbleContent className="w-full min-w-64 space-y-2">
        <Textarea
          autoFocus
          dir="auto"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            }
          }}
          rows={Math.min(10, Math.max(2, draft.split('\n').length))}
          maxLength={CHAT_PROMPT_LIMIT}
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={cancel}>
            {tCommon('cancel')}
          </Button>
          <Button size="sm" disabled={!draft.trim()} onClick={save}>
            {t('messages.saveAndBranch')}
          </Button>
        </div>
      </BubbleContent>
    );
  }

  return (
    <BubbleContent className="space-y-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment, index) => (
            <ChatAttachmentChip key={index} attachment={attachment} />
          ))}
        </div>
      )}
      {text && (
        <p dir="auto" className="text-start whitespace-pre-wrap">
          {text}
        </p>
      )}
    </BubbleContent>
  );
}
