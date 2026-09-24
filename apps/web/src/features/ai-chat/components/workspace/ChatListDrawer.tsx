'use client';

import { type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useTranslations } from 'next-intl';

// The chat list on a narrow layout: a drawer over the chat's own start edge, inside the
// chat's own box rather than the window's — in the tool panel the chat sits at the
// window's far end, and a drawer from the window's edge would open on the page behind
// it, so it renders in place instead of in a portal. A Radix Dialog: focus stays in it
// and returns when it closes, the rest of the page is inert meanwhile, and Escape or a
// click beside it closes it.
export default function ChatListDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const t = useTranslations('chatWorkspace');

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {open && (
        <div className="absolute inset-0 z-30 flex">
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="flex h-full w-72 max-w-[85%] flex-col border-e border-sidebar-border bg-sidebar shadow-lg outline-none motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in"
          >
            <DialogPrimitive.Title className="sr-only">{t('list.title')}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="sr-only">{t('list.close')}</DialogPrimitive.Close>
            {children}
          </DialogPrimitive.Content>
          <div
            aria-hidden="true"
            className="min-w-0 flex-1 bg-foreground/10 motion-safe:animate-in motion-safe:fade-in"
          />
        </div>
      )}
    </DialogPrimitive.Root>
  );
}
