'use client';

import type { ComponentType, ReactNode } from 'react';

// One action row of the chat list, shaped like a sidebar row: 32px high, a 16px icon
// before its label, the sidebar's hover.
export default function ChatListRowButton({
  icon: Icon,
  onClick,
  active = false,
  className,
  children,
}: {
  icon: ComponentType<{ className?: string; size?: number }>;
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
      className={`ds-chat-list-action ${className ?? ''}`}
    >
      <Icon size={16} />
      <span>{children}</span>
    </button>
  );
}
