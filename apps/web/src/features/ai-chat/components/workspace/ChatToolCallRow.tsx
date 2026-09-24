'use client';

import { useMemo } from 'react';
import type { DynamicToolUIPart } from 'ai';
import { CheckCircle2, ChevronRight, CircleDashed, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { highlight } from '@/lib/highlight';

function toolText(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

// One tool call: its name, a status icon, and — opened — what it was given and what it
// answered.
export default function ChatToolCallRow({ tool }: { tool: DynamicToolUIPart }) {
  const t = useTranslations('chatWorkspace');
  const input = useMemo(() => toolText(tool.input), [tool.input]);
  const output = tool.state === 'output-available' ? toolText(tool.output) : undefined;
  const errorText = tool.state === 'output-error' ? tool.errorText : undefined;
  const highlightedInput = useMemo(() => (input ? highlight(input) : null), [input]);
  const highlightedOutput = useMemo(() => (output ? highlight(output) : null), [output]);

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-start text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90 rtl:group-data-[state=closed]:rotate-180" />
        {tool.state === 'output-error' ? (
          <XCircle className="size-3.5 shrink-0 text-status-danger" />
        ) : tool.state === 'output-available' ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-status-success" />
        ) : (
          <CircleDashed className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span dir="ltr" className="truncate font-mono text-xs">
          {tool.toolName}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden ps-6 pe-1.5 motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down">
        <div className="space-y-2 py-1.5">
          {input && (
            <div className="min-w-0">
              <span className="text-xs text-muted-foreground">{t('messages.toolInput')}</span>
              <div className="md-content mt-1">
                <pre className="max-h-48 overflow-auto text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">
                  <code>{highlightedInput ?? input}</code>
                </pre>
              </div>
            </div>
          )}
          {output && (
            <div className="min-w-0">
              <span className="text-xs text-muted-foreground">{t('messages.toolOutput')}</span>
              <div className="md-content mt-1">
                <pre className="max-h-48 overflow-auto text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">
                  <code>{highlightedOutput ?? output}</code>
                </pre>
              </div>
            </div>
          )}
          {errorText && (
            <p dir="auto" className="text-xs whitespace-pre-wrap text-destructive">
              {errorText}
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
