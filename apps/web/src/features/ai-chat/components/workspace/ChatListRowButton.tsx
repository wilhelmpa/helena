'use client';

import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

// One action row of the chat list, shaped like a sidebar menu button: 32px high, a
// 16px icon 8px from its label, sidebar-accent on hover and while active.
export default function ChatListRowButton({
  icon: Icon,
  onClick,
  active = false,
  className,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-start text-sm ring-sidebar-ring outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium',
        className,
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  );
}
