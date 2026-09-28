'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import HomeOrb from '@/components/helena/HomeOrb';
import { requestDockVoice } from '@/features/voice/utils/dockVoice';

// The orb at the bottom right IS the chat button (owner, 28.09.): a click opens the Home
// chat in the tool panel, a long press starts voice. New tasks come from the page's own
// action, C or ⌘⇧N, not from a second button here.
export default function HomeDock({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );
  if (pathname === '/' || open) return null;
  return (
    <button
      type="button"
      className="helena-home-dock"
      aria-label={t('dockOpen')}
      title={t('dockOpen')}
      onClick={onOpen}
      onPointerDown={() => {
        clearHold();
        hold.current = setTimeout(() => {
          onOpen();
          requestDockVoice();
          hold.current = null;
        }, 650);
      }}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
    >
      <HomeOrb />
    </button>
  );
}
