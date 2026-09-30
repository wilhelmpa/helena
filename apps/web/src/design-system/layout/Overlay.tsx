'use client';

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import { useExitOnClickOutside } from '@/hooks/useExitOnClickOutside';
import { SidePanelResizeHandle, useSidePanelWidth, type SidePanelKind } from './sidePanelWidth';
import { PageChromeCtx } from './pageChrome';
import { OverlayHead, type OverlayTab } from './OverlayHead';
import { useDock, useSheetMode } from '@/utils/dock';
import {
  setPinnedOverlayFull,
  toggleOverlayPin,
  unpinOverlay,
  useOverlayPin,
  usePinnedOverlayFull,
  type OverlayPin,
} from '@/utils/overlayPin';

// The one overlay on the right (docs/design-system.md §3/§9, owner 28.09.): a task, a
// run, an agent's settings and a file preview all open in it. Same place and shape as the
// tool panel — 12px to the window edges, radius 16, the width the user dragged (shared
// by every overlay) — the same head: segment tabs on the left (one tab when the thing
// has no views), its own actions, full screen and close on the right. Esc closes it.
// Full screen is a real switch (owner 29.09., O83): the same button makes the overlay large
// and small again — the symbol turns from "enlarge" to "reduce", Esc leaves full screen
// first — and a pinned overlay keeps it across pages. A thing with a page of its own (a
// task, a file) offers that as its own button (`onOpenPage`), not as the full screen.
export function Overlay({
  label,
  tabs,
  activeTab,
  onTab,
  actions,
  onClose,
  onOpenPage,
  escape = true,
  closeOnOutsideClick = false,
  className,
  bodyClassName,
  width: kind = 'default',
  pin,
  startFull = false,
  children,
}: {
  label: string;
  // The segment tabs of the head; a single entry names the thing.
  tabs: OverlayTab[];
  activeTab?: string;
  onTab?: (id: string) => void;
  actions?: ReactNode;
  onClose: () => void;
  // The thing's own page (a task's two-column page, a file large in the page): its own
  // button before pin, full screen and close.
  onOpenPage?: () => void;
  // Off while something opened from the overlay handles Esc itself.
  escape?: boolean;
  // A click on the page behind closes it (a task; not a form that holds unsaved input).
  closeOnOutsideClick?: boolean;
  className?: string;
  bodyClassName?: string;
  // 'wide' for a whole form (an agent's settings): wider, with its own remembered width.
  width?: SidePanelKind;
  // What this overlay shows, when it can be pinned: pinned, it stays open when the page
  // changes (utils/overlayPin), like the chat panel (Auftrag 117).
  pin?: OverlayPin;
  // Opens large (a shared page's read-only task); the button still makes it small again.
  startFull?: boolean;
  children: ReactNode;
}) {
  const { width } = useSidePanelWidth(kind);
  const [localFull, setLocalFull] = useState(startFull);
  const pinnedNow = useOverlayPin();
  const pinned = pin != null && pinnedNow?.kind === pin.kind && pinnedNow.value === pin.value;
  const pinnedFull = usePinnedOverlayFull();
  // Below 1024px an overlay is a sheet over the whole screen: no pin, nothing to dock.
  const sheet = useSheetMode();
  // Pinned, the state lives outside this component, so the overlay another page shows for
  // the pin comes up as large (or small) as it was; unpinned it is this overlay's own.
  const full = pinned ? pinnedFull : localFull;
  const setFull = (next: boolean) => (pinned ? setPinnedOverlayFull(next) : setLocalFull(next));
  // Pinned and not full screen, the page gives it the room (O103): header bar and page get
  // exactly as narrow as the overlay is wide.
  useDock('overlay', pinned && !full && !sheet ? width : null);
  const togglePin = () => {
    if (!pin) return;
    if (pinned) setLocalFull(pinnedFull);
    else setPinnedOverlayFull(localFull);
    toggleOverlayPin(pin);
  };
  // Closing a pinned overlay unpins it.
  const close = () => {
    if (pin) unpinOverlay(pin);
    onClose();
  };
  useExitOnEscape(() => (full ? setFull(false) : close()), escape);
  const active = activeTab ?? tabs[0]?.id;
  const surface = useRef<HTMLElement>(null);
  useExitOnClickOutside(surface, () => {
    // Pinned, it stays while the page behind is used.
    if (closeOnOutsideClick && !full && !pinned) onClose();
  });

  return (
    <aside
      ref={surface}
      aria-label={label}
      className={`ds-side-panel ds-overlay ${className ?? ''}`}
      data-open="true"
      data-full={full ? 'true' : 'false'}
      data-pinned={pinned ? 'true' : undefined}
      style={{ '--ds-panel-w': `${width}px` } as CSSProperties}
    >
      {!full && <SidePanelResizeHandle kind={kind} />}
      <OverlayHead
        label={label}
        tabs={tabs}
        activeTab={active}
        onTab={onTab}
        actions={actions}
        controls={{
          onOpenPage,
          onTogglePin: pin && !sheet ? togglePin : undefined,
          pinned,
          full,
          onToggleFull: () => setFull(!full),
          onClose: close,
        }}
      />
      <div className={`ds-overlay-body ${bodyClassName ?? ''}`}>
        <PageChromeCtx.Provider value="modal">{children}</PageChromeCtx.Provider>
      </div>
    </aside>
  );
}
