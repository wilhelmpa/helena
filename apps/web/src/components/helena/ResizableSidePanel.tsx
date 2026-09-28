'use client';

import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import { cn } from '@/lib/utils';
import ResizeGrip from '@/components/common/ResizeGrip';

// The one width of everything that opens on the right beside the page: the tool/chat
// panel and the previews (Wissen, Belege). Owner, 28.09.: resizable by dragging its left
// edge, a handle that is always there, and the same size everywhere, remembered per user.
export const SIDE_PANEL_MIN_WIDTH = 320;
export const SIDE_PANEL_MAX_RATIO = 0.7;
export const SIDE_PANEL_DEFAULT_WIDTH = 480;
const STORAGE_KEY = 'helena:side-panel:width';
// Set on <html>, so CSS that places a panel (the floating tool panel) reads the same width.
export const SIDE_PANEL_WIDTH_VAR = '--helena-side-panel-width';

const listeners = new Set<() => void>();
let stored: number | null = null;

function viewportMax(): number {
  if (typeof window === 'undefined') return Number.POSITIVE_INFINITY;
  return Math.max(SIDE_PANEL_MIN_WIDTH, Math.floor(window.innerWidth * SIDE_PANEL_MAX_RATIO));
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
  // Another tab changed the width.
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

// The shown width: the stored one, kept within 320 px and 70 % of the window.
function snapshot(): number {
  return clampSidePanelWidth(load());
}

function setSidePanelWidth(next: number) {
  const width = clampSidePanelWidth(next);
  stored = width;
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // ignore write failures; the width still applies for this session.
  }
  publish(width);
  listeners.forEach((listener) => listener());
}

export function useSidePanelWidth(): { width: number; setWidth: (width: number) => void } {
  const width = useSyncExternalStore(subscribe, snapshot, () => SIDE_PANEL_DEFAULT_WIDTH);
  useEffect(() => publish(width), [width]);
  return { width, setWidth: setSidePanelWidth };
}

// The handle on the left edge of a right-hand panel: a thin line that is always visible
// and lights up on hover or while dragging; a wider invisible strip takes the pointer.
// Dragging moves the edge (no double-click); the arrow keys move it by 10 px (50 with
// Shift).
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
  // The panel sits at the end edge: moving the pointer towards the start widens it.
  const onDrag = useCallback(
    (deltaX: number) => setWidth(width + (direction === 'rtl' ? deltaX : -deltaX)),
    [direction, setWidth, width],
  );
  return (
    <ResizeGrip
      label={t('resizeSidePanel')}
      className={cn('helena-resize-handle', className)}
      style={style}
      onDrag={onDrag}
    />
  );
}

// A panel on the right beside the page with the shared width and the handle on its left
// edge. Previews and other side panels use this instead of a width of their own.
export default function ResizableSidePanel({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const { width } = useSidePanelWidth();
  return (
    <aside
      aria-label={label}
      className={cn('helena-side-panel relative flex h-full min-h-0 shrink-0 flex-col', className)}
      style={{ width }}
    >
      <SidePanelResizeHandle className="absolute inset-y-0 start-0 z-10 -translate-x-1/2 rtl:translate-x-1/2" />
      {children}
    </aside>
  );
}
