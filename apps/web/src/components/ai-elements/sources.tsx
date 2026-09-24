'use client';

// Adapted from AI Elements `sources` (Apache-2.0, see ./LICENSE): what an answer drew on,
// folded into "N sources" under it and opened onto the list.

import type { ComponentProps, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export type SourcesProps = ComponentProps<typeof Collapsible>;

export function Sources({ className, ...props }: SourcesProps) {
  return <Collapsible className={cn('not-prose text-xs', className)} {...props} />;
}

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  label: ReactNode;
};

export function SourcesTrigger({ className, label, ...props }: SourcesTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        'group flex h-7 w-fit items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      <ChevronRight className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90 rtl:group-data-[state=closed]:rotate-180" />
      <span>{label}</span>
    </CollapsibleTrigger>
  );
}

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export function SourcesContent({ className, ...props }: SourcesContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        'flex flex-wrap gap-1.5 overflow-hidden pt-1 motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down',
        className,
      )}
      {...props}
    />
  );
}

// One source as a small chip. The caller renders the link itself (a Next link for a
// place inside Helena, an anchor for the web) and passes it as the child.
export function sourceChipClassName(className?: string) {
  return cn(
    'flex max-w-48 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent [&_svg]:size-3 [&_svg]:shrink-0',
    className,
  );
}
