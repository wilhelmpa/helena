'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

// The grip on the edge of a resizable column or panel. It reports how far the
// pointer has moved from where the drag started; which side that grows is the
// caller's business, so a panel on the end edge can widen as the pointer goes the
// other way.
export default function ResizeGrip({
  label,
  className,
  onDrag,
}: {
  label: string;
  className?: string;
  onDrag: (deltaX: number) => void;
}) {
  // The drag listens on the window, since the pointer leaves the 6px grip as soon
  // as it moves. The host can unmount mid-drag (switching layout or project), and
  // the pointerup that would drop the listeners never reaches this component.
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  function beginResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const grip = e.currentTarget as HTMLDivElement;
    const pointerId = e.pointerId;
    grip.setPointerCapture(pointerId);
    document.documentElement.style.cursor = 'col-resize';
    document.documentElement.style.userSelect = 'none';
    const onMove = (ev: PointerEvent) => onDrag(ev.clientX - startX);
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      grip.removeEventListener('lostpointercapture', onUp);
      if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId);
      document.documentElement.style.cursor = '';
      document.documentElement.style.userSelect = '';
      endDrag.current = null;
    };
    endDrag.current = onUp;
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
    grip.addEventListener('lostpointercapture', onUp);
  }

  // The keyboard moves it too: the arrow keys by 10px, with Shift by 50px, reported the
  // same way as a drag of that distance.
  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 50 : 10;
    if (e.key === 'ArrowLeft') onDrag(-step);
    else if (e.key === 'ArrowRight') onDrag(step);
    else return;
    e.preventDefault();
  }

  // A focusable separator (WAI-ARIA window splitter) between the two sides it sizes.
  // jsx-a11y counts a separator as non-interactive; a focusable one is a widget.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onPointerDown={beginResize}
      onKeyDown={onKeyDown}
      className={cn(
        'w-1.5 cursor-col-resize touch-none outline-none select-none hover:bg-primary/40 focus-visible:bg-primary/40',
        className,
      )}
    />
  );
}
