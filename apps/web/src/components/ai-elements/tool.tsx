'use client';

// Adapted from AI Elements `tool` (Apache-2.0, see ./LICENSE): one tool call of an
// answer, folded into a row with its name and state, and opened onto what it was given
// and what it answered. Arguments and results are shown as code blocks by the same
// Markdown renderer as the answer, so they are highlighted and can be copied.

import { useMemo, type ComponentProps, type ReactNode } from 'react';
import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CircleMinus,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MessageResponse, NO_BLOCK_LIMIT } from './message';

export type ToolPart = ToolUIPart | DynamicToolUIPart;
export type ToolState = ToolPart['state'];

export function toolName(part: ToolPart): string {
  return part.type === 'dynamic-tool' ? part.toolName : part.type.split('-').slice(1).join('-');
}

export const isToolRunning = (state: ToolState) =>
  state === 'input-streaming' || state === 'input-available';

export function ToolStatusIcon({
  state,
  neutral = false,
  className,
}: {
  state: ToolState;
  // Finished, but not with the tool's usual success: a command that exited non-zero and
  // printed output. Drawn calm, neither green nor red.
  neutral?: boolean;
  className?: string;
}) {
  if (neutral && state === 'output-available') {
    return <CircleMinus className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />;
  }
  if (state === 'output-error' || state === 'output-denied') {
    return <XCircle className={cn('size-3.5 shrink-0 text-status-danger', className)} />;
  }
  if (state === 'output-available') {
    return <CheckCircle2 className={cn('size-3.5 shrink-0 text-status-success', className)} />;
  }
  if (state === 'approval-requested' || state === 'approval-responded') {
    return <ShieldAlert className={cn('size-3.5 shrink-0 text-status-waiting', className)} />;
  }
  return (
    <CircleDashed
      className={cn('size-3.5 shrink-0 animate-spin text-muted-foreground', className)}
    />
  );
}

export type ToolProps = ComponentProps<typeof Collapsible>;

export function Tool({ className, ...props }: ToolProps) {
  return <Collapsible className={cn('not-prose w-full', className)} {...props} />;
}

export type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  name: string;
  state: ToolState;
  // Read out with the state icon, which is only drawn.
  stateLabel: string;
  neutral?: boolean;
};

export function ToolHeader({
  className,
  name,
  state,
  stateLabel,
  neutral,
  ...props
}: ToolHeaderProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        'group flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-start text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90 rtl:group-data-[state=closed]:rotate-180" />
      <ToolStatusIcon state={state} neutral={neutral} />
      <span className={neutral ? 'hidden' : 'sr-only'}>{stateLabel}</span>
      <span dir="ltr" className="truncate font-mono text-xs">
        {name}
      </span>
      {/* A command that ended with a code says so in the row: a result, not a failure. */}
      {neutral && (
        <span className="ms-auto shrink-0 ps-2 text-xs text-muted-foreground">{stateLabel}</span>
      )}
    </CollapsibleTrigger>
  );
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, children, ...props }: ToolContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        'overflow-hidden ps-6 pe-1.5 motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down',
        className,
      )}
      {...props}
    >
      <div className="space-y-2 py-1.5">{children}</div>
    </CollapsibleContent>
  );
}

// A value a tool was given or answered, as the text a code block shows: JSON indented,
// anything else as it came.
export function toolText(value: unknown): { text: string; language: 'json' | 'text' } {
  if (value == null) return { text: '', language: 'text' };
  if (typeof value !== 'string') return { text: JSON.stringify(value, null, 2), language: 'json' };
  try {
    return { text: JSON.stringify(JSON.parse(value), null, 2), language: 'json' };
  } catch {
    return { text: value, language: 'text' };
  }
}

// The longest fence the value itself contains, plus one, so a result that is itself
// Markdown with code blocks stays inside its own block.
function fenceFor(text: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(longest + 1);
}

function ToolCode({ value, label }: { value: unknown; label: ReactNode }) {
  const markdown = useMemo(() => {
    const { text, language } = toolText(value);
    if (!text) return null;
    const fence = fenceFor(text);
    return `${fence}${language}\n${text}\n${fence}`;
  }, [value]);
  if (!markdown) return null;
  return (
    <div className="min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <MessageResponse
        mode="static"
        className="agent-tool-code mt-1"
        codeBlockMaxHeight={NO_BLOCK_LIMIT}
        lineNumbers={false}
        controls={{ code: { copy: true, download: false } }}
      >
        {markdown}
      </MessageResponse>
    </div>
  );
}

export type ToolInputProps = { input: ToolPart['input']; label: ReactNode };

export function ToolInput({ input, label }: ToolInputProps) {
  return <ToolCode value={input} label={label} />;
}

export type ToolOutputProps = {
  output: ToolPart['output'];
  errorText: ToolPart['errorText'];
  label: ReactNode;
};

export function ToolOutput({ output, errorText, label }: ToolOutputProps) {
  if (errorText) {
    return (
      <p dir="auto" className="text-xs whitespace-pre-wrap text-destructive">
        {errorText}
      </p>
    );
  }
  return <ToolCode value={output} label={label} />;
}
