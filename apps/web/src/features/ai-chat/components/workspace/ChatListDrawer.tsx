'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

// The chat list on a narrow layout: a drawer over the chat's own start edge, inside the
// chat's own box rather than the window's — in the tool panel the chat sits at the
// window's far end, and a drawer from the window's edge would open on the page behind
// it. Escape or a click beside it closes it.
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 flex">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('list.title')}
        tabIndex={-1}
        className="flex h-full w-72 max-w-[85%] flex-col border-e border-sidebar-border bg-sidebar shadow-lg outline-none motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in"
      >
        {children}
      </div>
      <button
        type="button"
        aria-label={t('list.close')}
        className="min-w-0 flex-1 cursor-default bg-foreground/10 motion-safe:animate-in motion-safe:fade-in"
        onClick={() => onOpenChange(false)}
      />
    </div>
  );
}
