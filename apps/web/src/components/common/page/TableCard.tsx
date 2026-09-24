import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// The frame of a list table: the sidebar's surface in one hairline box, the same
// material as a settings card or a row list (docs/volition/ui-standard.md "Surfaces"),
// with the head cells inset like the body cells. The Table inside keeps its own
// sideways scroll for a phone.
export default function TableCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-sidebar-border bg-card [&_[data-slot=table-head]]:px-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
