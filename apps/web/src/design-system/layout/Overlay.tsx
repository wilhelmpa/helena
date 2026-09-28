'use client';

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import { useExitOnClickOutside } from '@/hooks/useExitOnClickOutside';
import { SidePanelResizeHandle, useSidePanelWidth } from './sidePanelWidth';
import { PageChromeCtx } from './pageChrome';

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
  children: ReactNode;
}) {
  const t = useTranslations('common');
  const { width } = useSidePanelWidth();
  const [full, setFull] = useState(false);
  useExitOnEscape(() => (full ? setFull(false) : onClose()), escape);
  const active = activeTab ?? tabs[0]?.id;
  const surface = useRef<HTMLElement>(null);
  useExitOnClickOutside(surface, () => {
    if (closeOnOutsideClick && !full) onClose();
  });

  return (
    <aside
      ref={surface}
      aria-label={label}
      className={`ds-side-panel ds-overlay ${className ?? ''}`}
      data-open="true"
      data-full={full ? 'true' : 'false'}
      style={{ '--ds-panel-w': `${width}px` } as CSSProperties}
    >
      {!full && <SidePanelResizeHandle />}
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
            onClick={onClose}
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
