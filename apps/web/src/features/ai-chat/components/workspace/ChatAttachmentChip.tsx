'use client';

import { FileText, ListTodo } from 'lucide-react';
import Link from 'next/link';
import type { AiChatAttachment } from '@/lib/api/endpoints/agentChat';
import { issuePath } from '@/utils/paths';

// One attachment of a question: a vault file (shown by name, no preview — the composer
// already showed one before sending) or a task the member pointed the agent at.
export default function ChatAttachmentChip({ attachment }: { attachment: AiChatAttachment }) {
  if (attachment.kind === 'task') {
    const [projectKey] = attachment.identifier.split('-');
    const sequence = Number(attachment.identifier.slice(projectKey.length + 1));
    return (
      <Link
        href={issuePath(projectKey, sequence)}
        className="flex max-w-full items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1 text-xs hover:bg-background"
      >
        <ListTodo className="size-3.5 shrink-0" />
        <span dir="ltr" className="shrink-0 font-medium">
          {attachment.identifier}
        </span>
        <span dir="auto" className="truncate text-muted-foreground">
          {attachment.title}
        </span>
      </Link>
    );
  }

  return (
    <span className="flex max-w-full items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1 text-xs">
      <FileText className="size-3.5 shrink-0" />
      <span dir="auto" className="truncate">
        {attachment.name}
      </span>
    </span>
  );
}
