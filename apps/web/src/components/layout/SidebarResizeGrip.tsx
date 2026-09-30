'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import { useHydrated } from '@/hooks/useHydrated';
import ResizeGrip from '@/components/common/ResizeGrip';
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampSidebarWidth,
  useSidebarWidth,
} from '@/utils/sidebarWidth';

// The grip on the sidebar's inner edge (owner, O110): drag to size it, arrow keys (Shift for
// more), double click or Enter for the standard width. The width is the member's own and
// stays on this device; the frame (Shell) reads the same value and gives the column that width.
export default function SidebarResizeGrip({ userId }: { userId: string | null | undefined }) {
  const t = useTranslations('nav');
  const { width, set } = useSidebarWidth(userId);
  const direction = Direction.useDirection();
  // The width when the drag began: the drag reports how far the pointer went from there.
  const base = useRef<number | null>(null);
  // What the window allows is known only in the browser: the server renders the grip without it.
  const mounted = useHydrated();
  const viewport = () => (typeof window === 'undefined' ? 1440 : window.innerWidth);
  const shown = clampSidebarWidth(width, viewport());
  return (
    <ResizeGrip
      label={t('sidebarResize')}
      className="ds-sidebar-grip"
      value={mounted ? { now: shown, min: SIDEBAR_MIN, max: SIDEBAR_MAX } : undefined}
      onDragStart={() => {
        base.current = shown;
      }}
      onDragEnd={() => {
        base.current = null;
      }}
      onDrag={(delta) =>
        set(
          clampSidebarWidth(
            (base.current ?? shown) + (direction === 'rtl' ? -delta : delta),
            viewport(),
          ),
        )
      }
      onReset={() => set(SIDEBAR_DEFAULT)}
    />
  );
}
