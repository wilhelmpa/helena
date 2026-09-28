import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export default function EmptyState({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-[var(--dashboard-muted)]', className)} {...props} />;
}
