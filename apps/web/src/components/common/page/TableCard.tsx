import type { ReactNode } from 'react';
import { ListBox } from '@/design-system';
import { cn } from '@/lib/utils';

// The frame of a list table: the one box of the design system (ListBox: surface-1, radius 12,
// the card shadow), the same as a settings card or a row list, with the head cells inset like
// the body cells. The Table inside keeps its own
// sideways scroll for a phone.
export default function TableCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <ListBox className={cn('[&_[data-slot=table-head]]:px-3', className)}>{children}</ListBox>;
}
