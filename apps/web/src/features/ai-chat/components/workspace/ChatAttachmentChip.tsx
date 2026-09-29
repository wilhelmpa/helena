'use client';

import { FileText, ListTodo, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import type { AiChatAttachment } from '@/lib/api/endpoints/agentChat';
import { issuePath, vaultNotePath } from '@/utils/paths';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@/components/ui/attachment';

// One attachment of a question, as shadcn's Attachment: a vault file (by name — the
// composer already showed it before sending) or a task the member pointed the agent at,
// which opens the task.
export default function ChatAttachmentChip({ attachment }: { attachment: AiChatAttachment }) {
  if (attachment.kind === 'knowledge') {
    return (
      <Attachment size="xs">
        <AttachmentMedia>
          <FileText />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle dir="auto">{attachment.title}</AttachmentTitle>
        </AttachmentContent>
        <AttachmentTrigger asChild>
          <Link href={attachment.href} aria-label={attachment.title} />
        </AttachmentTrigger>
      </Attachment>
    );
  }
  if (attachment.kind === 'task') {
    const [projectKey] = attachment.identifier.split('-');
    const sequence = Number(attachment.identifier.slice(projectKey.length + 1));
    return (
      <Attachment size="xs" className="min-w-0 bg-background/60">
        <AttachmentMedia>
          <ListTodo />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>
            <span dir="ltr" className="font-medium">
              {attachment.identifier}
            </span>{' '}
            <span dir="auto" className="font-normal text-muted-foreground">
              {attachment.title}
            </span>
          </AttachmentTitle>
        </AttachmentContent>
        <AttachmentTrigger asChild>
          <Link href={issuePath(projectKey, sequence)} aria-label={attachment.identifier} />
        </AttachmentTrigger>
      </Attachment>
    );
  }

  return (
    <Attachment size="xs" className="min-w-0 bg-background/60">
      <AttachmentMedia>
        <FileText />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle dir="auto">{attachment.name}</AttachmentTitle>
      </AttachmentContent>
      <AttachmentTrigger asChild>
        <Link href={vaultNotePath(attachment.path)} aria-label={attachment.name} />
      </AttachmentTrigger>
    </Attachment>
  );
}

// A file attached to the message being written: uploading, or ready and removable.
export function ChatPendingAttachment({
  name,
  uploading = false,
  removeLabel,
  onRemove,
}: {
  name: string;
  uploading?: boolean;
  removeLabel?: string;
  onRemove?: () => void;
}) {
  return (
    <Attachment size="xs" state={uploading ? 'uploading' : 'done'} className="max-w-48 min-w-0">
      <AttachmentMedia>
        {uploading ? <Loader2 className="animate-spin" /> : <FileText />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle dir="auto">{name}</AttachmentTitle>
      </AttachmentContent>
      {onRemove && (
        <AttachmentActions>
          <AttachmentAction onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
            <X />
          </AttachmentAction>
        </AttachmentActions>
      )}
    </Attachment>
  );
}
