'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  SIDE_PANEL_DEFAULT,
  SIDE_PANEL_MIN,
  clampSidePanelWidth,
  useSidePanelWidth,
} from './sidePanelWidth';

function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

// A panel docked on the right edge of a page (preview, chat, tool). Its left edge is a
// handle that is always visible: drag it or use ←/→ to resize. The width is shared by
// every side panel (`useSidePanelWidth`) and clamped to 320 px … 70 % of the viewport.
export default function ResizableSidePanel({
  label,
  children,
  className,
  reserve = 0,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  // Width the page next to the panel keeps at least (the panel never pushes it narrower).
  reserve?: number;
}) {
  const t = useTranslations('common');
  const viewport = useViewportWidth();
  const [stored, setStored] = useSidePanelWidth();
  const panel = useRef<HTMLElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const parent = panel.current?.parentElement;
    if (!parent || !reserve) return;
    const observer = new ResizeObserver(() => setRoom(parent.clientWidth));
    observer.observe(parent);
    return () => observer.disconnect();
  }, [reserve]);
  const limit = (next: number) => {
    const clamped = clampSidePanelWidth(next, viewport);
    return room === null ? clamped : Math.max(SIDE_PANEL_MIN, Math.min(clamped, room - reserve));
  };
  const width = limit(stored);

  const direction = () =>
    panel.current && getComputedStyle(panel.current).direction === 'rtl' ? -1 : 1;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const sign = direction();
    setDragging(true);
    const move = (moveEvent: PointerEvent) => {
      setStored(limit(startWidth + (startX - moveEvent.clientX) * sign));
    };
    const end = () => {
      setDragging(false);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  return (
    <aside
      ref={panel}
      aria-label={label}
      data-side-panel=""
      style={{ width }}
      className={cn('relative flex min-h-0 shrink-0 flex-col', className)}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resizeSidePanel')}
        aria-valuemin={SIDE_PANEL_MIN}
        aria-valuemax={Math.floor(viewport * 0.7)}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startDrag}
        onDoubleClick={() => setStored(SIDE_PANEL_DEFAULT)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 16;
          const sign = direction();
          if (event.key === 'ArrowLeft') setStored(limit(width + step * sign));
          else if (event.key === 'ArrowRight')
            setStored(limit(width - step * sign));
          else return;
          event.preventDefault();
        }}
        className="group/handle absolute inset-y-0 -start-2 z-10 flex w-4 cursor-col-resize touch-none justify-center outline-none"
      >
        <span
          aria-hidden="true"
          className={cn(
            'h-full w-px bg-border transition-colors group-hover/handle:bg-muted-foreground/50 group-focus-visible/handle:bg-brand',
            dragging && 'bg-brand',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 h-9 w-1 -translate-y-1/2 rounded-full bg-muted-foreground/35 transition-colors group-hover/handle:bg-muted-foreground/70 group-focus-visible/handle:bg-brand',
            dragging && 'bg-brand',
          )}
        />
      </div>
      {children}
    </aside>
  );
}
