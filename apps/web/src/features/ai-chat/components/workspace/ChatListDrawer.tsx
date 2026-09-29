'use client';

import { type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useTranslations } from 'next-intl';

// The chat list on a narrow layout: a floating panel over the chat's own box — at the end
// where Helena's start page has its "Chats" button, at the start in the tool panel —
// never a second column beside the sidebar (owner, 28.09., O3). In place rather than in a
// portal, so in the tool panel it opens over the chat and not over the page behind it. A
// Radix Dialog: focus stays in it and returns when it closes, Escape or a click beside it
// closes it.
export default function ChatListDrawer({
  open,
  onOpenChange,
  side = 'start',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'start' | 'end';
  children: ReactNode;
}) {
  const t = useTranslations('chatWorkspace');

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {open && (
        <div className="ds-drawer-host" data-side={side}>
          <div aria-hidden="true" className="ds-drawer-scrim" />
          <DialogPrimitive.Content aria-describedby={undefined} className="ds-drawer">
            <DialogPrimitive.Title className="sr-only">{t('list.title')}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="sr-only">{t('list.close')}</DialogPrimitive.Close>
            {children}
          </DialogPrimitive.Content>
        </div>
      )}
    </DialogPrimitive.Root>
  );
}
