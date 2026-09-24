'use client';

// Adapted from AI Elements `task` (Apache-2.0, see ./LICENSE): a group of steps an agent
// took, folded into one line that opens onto the steps. Helena uses it for the tool
// calls an answer made between two stretches of text.

import type { ComponentProps } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export type TaskProps = ComponentProps<typeof Collapsible>;

export function Task({ defaultOpen = false, className, ...props }: TaskProps) {
  return (
    <Collapsible className={cn('not-prose', className)} defaultOpen={defaultOpen} {...props} />
  );
}

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

// The folded line: a chevron, then what the caller puts in it (an icon, the title).
export function TaskTrigger({ children, className, ...props }: TaskTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        'group flex h-8 w-fit max-w-full items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      <ChevronRight className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90 rtl:group-data-[state=closed]:rotate-180" />
      {children}
    </CollapsibleTrigger>
  );
}

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export function TaskContent({ children, className, ...props }: TaskContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        'overflow-hidden motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down',
        className,
      )}
      {...props}
    >
      <div className="ms-1.5 space-y-0.5 border-s border-sidebar-border ps-2">{children}</div>
    </CollapsibleContent>
  );
}

export type TaskItemProps = ComponentProps<'div'>;

export function TaskItem({ className, ...props }: TaskItemProps) {
  return <div className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
