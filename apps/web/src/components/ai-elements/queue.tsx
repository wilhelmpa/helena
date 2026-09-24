'use client';

// Adapted from AI Elements `queue` (Apache-2.0, see ./LICENSE): items waiting their
// turn — in Helena's chat, the messages written while an answer is still coming. Each
// can be taken out before it goes.

import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type QueueProps = ComponentProps<'ul'>;

export function Queue({ className, ...props }: QueueProps) {
  return (
    <ul
      className={cn('flex max-h-32 scrollbar-thin flex-col gap-1 overflow-y-auto', className)}
      {...props}
    />
  );
}

export type QueueItemProps = ComponentProps<'li'>;

export function QueueItem({ className, ...props }: QueueItemProps) {
  return (
    <li
      className={cn(
        'group flex min-w-0 items-center gap-2 rounded-lg bg-accent/60 py-1 ps-2.5 pe-1 text-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export type QueueItemIndicatorProps = ComponentProps<'span'>;

export function QueueItemIndicator({ className, ...props }: QueueItemIndicatorProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full border border-muted-foreground/50',
        className,
      )}
      {...props}
    />
  );
}

export type QueueItemContentProps = ComponentProps<'span'>;

export function QueueItemContent({ className, ...props }: QueueItemContentProps) {
  return <span className={cn('min-w-0 flex-1 truncate', className)} {...props} />;
}

export type QueueItemDescriptionProps = ComponentProps<'span'>;

export function QueueItemDescription({ className, ...props }: QueueItemDescriptionProps) {
  return <span className={cn('shrink-0 text-xs', className)} {...props} />;
}

export type QueueItemActionProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  label: string;
};

export function QueueItemAction({ className, label, ...props }: QueueItemActionProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      className={cn('shrink-0 text-muted-foreground hover:text-foreground', className)}
      {...props}
    />
  );
}
