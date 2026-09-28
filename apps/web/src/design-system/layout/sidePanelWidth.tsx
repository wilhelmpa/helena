'use client';

import { useCallback, useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import ResizeGrip from '@/components/common/ResizeGrip';

// The one width of the right-hand overlay panel (tools, chat, previews): dragged at its
// left edge, a handle that is always there, 320px to 90% of the window, remembered per
// user (docs/design-system.md §3, owner 28.09.).
export const SIDE_PANEL_MIN_WIDTH = 320;
export const SIDE_PANEL_MAX_RATIO = 0.9;
export const SIDE_PANEL_DEFAULT_WIDTH = 480;
const STORAGE_KEY = 'helena:side-panel:width';
// Set on <html>, so CSS that places the panel reads the same width.
export const SIDE_PANEL_WIDTH_VAR = '--helena-side-panel-width';

const listeners = new Set<() => void>();
let stored: number | null = null;

function viewportMax(): number {
  if (typeof window === 'undefined') return Number.POSITIVE_INFINITY;
  // The overlay keeps 12px to the window edges.
  return Math.max(
    SIDE_PANEL_MIN_WIDTH,
    Math.floor((window.innerWidth - 24) * SIDE_PANEL_MAX_RATIO),
  );
}

export function clampSidePanelWidth(width: number, max = viewportMax()): number {
  return Math.round(Math.min(max, Math.max(SIDE_PANEL_MIN_WIDTH, width)));
}

function load(): number {
  if (stored != null) return stored;
  let value = SIDE_PANEL_DEFAULT_WIDTH;
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved > 0) value = saved;
  } catch {
    // no storage (private mode): the default applies.
  }
  stored = value;
  return value;
}

function publish(width: number) {
  document.documentElement.style.setProperty(SIDE_PANEL_WIDTH_VAR, `${width}px`);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onResize = () => listener();
  window.addEventListener('resize', onResize);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    stored = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('storage', onStorage);
  };
}

function snapshot(): number {
  return clampSidePanelWidth(load());
}

function setSidePanelWidth(next: number) {
  const width = clampSidePanelWidth(next);
  stored = width;
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // the width still applies for this session.
  }
  publish(width);
  listeners.forEach((listener) => listener());
}

export function useSidePanelWidth(): { width: number; setWidth: (width: number) => void } {
  const width = useSyncExternalStore(subscribe, snapshot, () => SIDE_PANEL_DEFAULT_WIDTH);
  useEffect(() => publish(width), [width]);
  return { width, setWidth: setSidePanelWidth };
}

// The handle on the left edge: a pill that is always visible, lit on hover and while
// dragging; a wider invisible strip takes the pointer. No double click; the arrow keys
// move it by 10px (50 with Shift).
export function SidePanelResizeHandle({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const t = useTranslations('common');
  const { width, setWidth } = useSidePanelWidth();
  const direction = Direction.useDirection();
  const onDrag = useCallback(
    (deltaX: number) => setWidth(width + (direction === 'rtl' ? deltaX : -deltaX)),
    [direction, setWidth, width],
  );
  return (
    <ResizeGrip
      label={t('resizeSidePanel')}
      className={`ds-side-panel-handle ${className ?? ''}`}
      style={style}
      onDrag={onDrag}
    />
  );
}
