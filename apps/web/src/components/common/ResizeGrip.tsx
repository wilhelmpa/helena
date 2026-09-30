'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// The grip on the edge of a resizable column or panel. It reports how far the
// pointer has moved from where the drag started; which side that grows is the
// caller's business, so a panel on the end edge can widen as the pointer goes the
// other way.
export default function ResizeGrip({
  label,
  className,
  style,
  onDrag,
  onDragStart,
  onDragEnd,
  onReset,
  value,
  axis = 'x',
}: {
  label: string;
  className?: string;
  // Where it sits, such as its column in a grid.
  style?: CSSProperties;
  // How far the pointer moved along this axis since the drag started: 'x' sizes a
  // column (a grip on its side), 'y' a row (a grip on its top or bottom edge).
  onDrag: (delta: number) => void;
  // A caller that sizes from the width at the start of the drag (delta is measured from it)
  // takes that width here.
  onDragStart?: () => void;
  onDragEnd?: () => void;
  // A double click or Enter puts the size back to its default.
  onReset?: () => void;
  // The size now, for assistive technology (aria-valuenow, in px).
  value?: { now: number; min: number; max: number };
  axis?: 'x' | 'y';
}) {
  // The drag listens on the window, since the pointer leaves the 6px grip as soon
  // as it moves. The host can unmount mid-drag (switching layout or project), and
  // the pointerup that would drop the listeners never reaches this component.
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  function beginResize(e: React.PointerEvent) {
    e.preventDefault();
    onDragStart?.();
    const start = axis === 'x' ? e.clientX : e.clientY;
    const grip = e.currentTarget as HTMLDivElement;
    const pointerId = e.pointerId;
    grip.setPointerCapture(pointerId);
    document.documentElement.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.documentElement.style.userSelect = 'none';
    const onMove = (ev: PointerEvent) => onDrag((axis === 'x' ? ev.clientX : ev.clientY) - start);
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      grip.removeEventListener('lostpointercapture', onUp);
      if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId);
      document.documentElement.style.cursor = '';
      document.documentElement.style.userSelect = '';
      endDrag.current = null;
      onDragEnd?.();
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
    if (e.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp')) onDrag(-step);
    else if (e.key === (axis === 'x' ? 'ArrowRight' : 'ArrowDown')) onDrag(step);
    else if (e.key === 'Enter' && onReset) onReset();
    else return;
    e.preventDefault();
  }

  // A focusable separator (WAI-ARIA window splitter) between the two sides it sizes.
  // jsx-a11y counts a separator as non-interactive; a focusable one is a widget.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={value?.now}
      aria-valuemin={value?.min}
      aria-valuemax={value?.max}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onPointerDown={beginResize}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      style={style}
      className={cn(
        'touch-none outline-none select-none hover:bg-primary/40 focus-visible:bg-primary/40',
        axis === 'x' ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize',
        className,
      )}
    />
  );
}
