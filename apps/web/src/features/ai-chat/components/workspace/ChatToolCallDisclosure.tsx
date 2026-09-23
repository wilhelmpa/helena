'use client';

import type { DynamicToolUIPart } from 'ai';
import { Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ChatApprovalCard from './ChatApprovalCard';
import ChatToolCallRow from './ChatToolCallRow';

// The tool calls an answer made between two stretches of text, together as one
// collapsible group with its own status icons — the reader can see at a glance how
// many ran and whether any failed, without opening each one. `request_approval` is not
// shown as a tool call at all: it becomes the approval card the owner decides on.
export default function ChatToolCallDisclosure({ tools }: { tools: DynamicToolUIPart[] }) {
  const t = useTranslations('chatWorkspace');
  const approvals = tools.filter((tool) => tool.toolName === 'request_approval');
  const rest = tools.filter((tool) => tool.toolName !== 'request_approval');

  return (
    <div className="space-y-2">
      {approvals.map((tool) => (
        <ChatApprovalCard key={tool.toolCallId} tool={tool} />
      ))}
      {rest.length > 0 && (
        <div className="space-y-1 rounded-lg border bg-muted/30 p-1.5">
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted-foreground">
            <Wrench className="size-3.5" />
            <span>{t('messages.toolCalls', { count: rest.length })}</span>
          </div>
          {rest.map((tool) => (
            <ChatToolCallRow key={tool.toolCallId} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
