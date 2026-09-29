'use client';

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize2, Minimize2, Pin, PinOff, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import { useExitOnClickOutside } from '@/hooks/useExitOnClickOutside';
import { SidePanelResizeHandle, useSidePanelWidth, type SidePanelKind } from './sidePanelWidth';
import { PageChromeCtx } from './pageChrome';
import { toggleOverlayPin, unpinOverlay, useOverlayPin, type OverlayPin } from '@/utils/overlayPin';

export type OverlayTab = { id: string; label: ReactNode };

// The one overlay on the right (docs/design-system.md §3/§9, owner 28.09.): a task, a
// run, an agent's settings and a file preview all open in it. Same place and shape as the
// tool panel — 12px to the window edges, radius 16, the width the user dragged (shared
// by every overlay) — the same head: segment tabs on the left (one tab when the thing
// has no views), its own actions, full screen and close on the right. Esc closes it.
// Full screen covers the page; a thing with a page of its own (a task) opens that page
// instead (`onFullscreen`).
export function Overlay({
  label,
  tabs,
  activeTab,
  onTab,
  actions,
  onClose,
  onFullscreen,
  escape = true,
  closeOnOutsideClick = false,
  className,
  bodyClassName,
  width: kind = 'default',
  pin,
  children,
}: {
  label: string;
  // The segment tabs of the head; a single entry names the thing.
  tabs: OverlayTab[];
  activeTab?: string;
  onTab?: (id: string) => void;
  actions?: ReactNode;
  onClose: () => void;
  // Replaces the in-place full screen (a task opens its two-column page).
  onFullscreen?: () => void;
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
  children: ReactNode;
}) {
  const t = useTranslations('common');
  const { width } = useSidePanelWidth(kind);
  const [full, setFull] = useState(false);
  const pinnedNow = useOverlayPin();
  const pinned = pin != null && pinnedNow?.kind === pin.kind && pinnedNow.value === pin.value;
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
      <div className="ds-panel-head">
        <div className="ds-panel-tabs">
          <div className="ds-panel-tabs-track" role="tablist" aria-label={label}>
            {tabs.map((tab) => (
              <div key={tab.id} className="ds-panel-tab">
                <button
                  type="button"
                  role="tab"
                  className="ds-panel-tab-select"
                  aria-selected={tab.id === active}
                  onClick={() => onTab?.(tab.id)}
                >
                  <span>{tab.label}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="ds-panel-head-tools">
          {actions}
          {pin && (
            <button
              type="button"
              className="ds-icon-button ds-panel-pin"
              onClick={() => toggleOverlayPin(pin)}
              aria-pressed={pinned}
              title={pinned ? t('unpinOverlay') : t('pinOverlay')}
              aria-label={pinned ? t('unpinOverlay') : t('pinOverlay')}
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          )}
          <button
            type="button"
            className="ds-icon-button"
            onClick={() => (onFullscreen ? onFullscreen() : setFull(!full))}
            title={full ? t('exitFullscreen') : t('fullscreen')}
            aria-label={full ? t('exitFullscreen') : t('fullscreen')}
          >
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            className="ds-icon-button"
            onClick={close}
            title={t('close')}
            aria-label={t('close')}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className={`ds-overlay-body ${bodyClassName ?? ''}`}>
        <PageChromeCtx.Provider value="modal">{children}</PageChromeCtx.Provider>
      </div>
    </aside>
  );
}
