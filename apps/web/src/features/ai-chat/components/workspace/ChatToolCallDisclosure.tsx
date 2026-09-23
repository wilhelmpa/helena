'use client';

import type { DynamicToolUIPart } from 'ai';
import { ChevronRight, LoaderCircle, TriangleAlert, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ChatApprovalCard from './ChatApprovalCard';
import ChatToolCallRow from './ChatToolCallRow';

// The tool calls an answer made between two stretches of text, folded into one line —
// "3 tool calls", the one running now named beside it — that opens onto each call with
// what it was given and what it answered. The reader sees at a glance how many ran and
// whether one failed without the transcript filling up with them. `request_approval` is
// not shown as a tool call at all: it becomes the approval card the owner decides on.
export default function ChatToolCallDisclosure({ tools }: { tools: DynamicToolUIPart[] }) {
  const t = useTranslations('chatWorkspace');
  const approvals = tools.filter((tool) => tool.toolName === 'request_approval');
  const rest = tools.filter((tool) => tool.toolName !== 'request_approval');
  const running = rest.find(
    (tool) => tool.state === 'input-streaming' || tool.state === 'input-available',
  );
  const failed = rest.some((tool) => tool.state === 'output-error');

  return (
    <div className="space-y-2">
      {approvals.map((tool) => (
        <ChatApprovalCard key={tool.toolCallId} tool={tool} />
      ))}
      {rest.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex h-8 w-fit max-w-full items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
            <ChevronRight className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90 rtl:group-data-[state=closed]:rotate-180" />
            {running ? (
              <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
            ) : failed ? (
              <TriangleAlert className="size-3.5 shrink-0 text-status-danger" />
            ) : (
              <Wrench className="size-3.5 shrink-0" />
            )}
            <span>{t('messages.toolCalls', { count: rest.length })}</span>
            {running && (
              <span dir="ltr" className="truncate font-mono text-xs">
                {running.toolName}
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down">
            <div className="ms-1.5 space-y-0.5 border-s border-sidebar-border ps-2">
              {rest.map((tool) => (
                <ChatToolCallRow key={tool.toolCallId} tool={tool} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
