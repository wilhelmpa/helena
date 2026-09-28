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

// Overlays that hold a whole form (an agent's settings) open wider and remember their own
// width; everything else shares one.
export type SidePanelKind = 'default' | 'wide';
const DEFAULTS: Record<SidePanelKind, number> = { default: SIDE_PANEL_DEFAULT_WIDTH, wide: 880 };
const KEYS: Record<SidePanelKind, string> = {
  default: STORAGE_KEY,
  wide: `${STORAGE_KEY}:wide`,
};

const listeners = new Set<() => void>();
const stored: Record<SidePanelKind, number | null> = { default: null, wide: null };

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

function load(kind: SidePanelKind): number {
  const known = stored[kind];
  if (known != null) return known;
  let value = DEFAULTS[kind];
  try {
    const saved = Number(localStorage.getItem(KEYS[kind]));
    if (saved > 0) value = saved;
  } catch {
    // no storage (private mode): the default applies.
  }
  stored[kind] = value;
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
    if (event.key !== KEYS.default && event.key !== KEYS.wide) return;
    stored.default = null;
    stored.wide = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('storage', onStorage);
  };
}

function setSidePanelWidth(kind: SidePanelKind, next: number) {
  const width = clampSidePanelWidth(next);
  stored[kind] = width;
  try {
    localStorage.setItem(KEYS[kind], String(width));
  } catch {
    // the width still applies for this session.
  }
  if (kind === 'default') publish(width);
  listeners.forEach((listener) => listener());
}

export function useSidePanelWidth(kind: SidePanelKind = 'default'): {
  width: number;
  setWidth: (width: number) => void;
} {
  const width = useSyncExternalStore(
    subscribe,
    () => clampSidePanelWidth(load(kind)),
    () => DEFAULTS[kind],
  );
  useEffect(() => {
    if (kind === 'default') publish(width);
  }, [kind, width]);
  const setWidth = useCallback((next: number) => setSidePanelWidth(kind, next), [kind]);
  return { width, setWidth };
}

// The handle on the left edge: a pill that is always visible, lit on hover and while
// dragging; a wider invisible strip takes the pointer. No double click; the arrow keys
// move it by 10px (50 with Shift).
export function SidePanelResizeHandle({
  className,
  style,
  kind = 'default',
}: {
  className?: string;
  style?: CSSProperties;
  kind?: SidePanelKind;
}) {
  const t = useTranslations('common');
  const { width, setWidth } = useSidePanelWidth(kind);
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
