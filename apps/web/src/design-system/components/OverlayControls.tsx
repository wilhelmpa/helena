'use client';

import Link from 'next/link';
import { ArrowUpRight, Maximize2, Minimize2, Pin, PinOff, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

// The controls at the right end of the head of everything that opens over or beside a page
// — the overlay (task, run, agent, file, receipt), the tool panel and its tabs, a dialog:
// its own page · pin · full screen ↔ normal · close, in this order, the same symbols, sizes,
// tooltips and labels (owner 29.09., O83; the tool panel's head was the model). Each part
// shows only when the caller gives its action. What "pin" means may differ (the overlay
// stays open across pages, the panel docks beside the page), how it looks and works does
// not. Nothing outside this component draws a pin, enlarge or close button of a head — the
// guard test (app/overlayControlsGuard.test.ts) says so.
export interface OverlayControlsLabels {
  pin?: string;
  unpin?: string;
  enterFull?: string;
  exitFull?: string;
  close?: string;
  openPage?: string;
}

export function OverlayControls({
  onClose,
  full,
  onToggleFull,
  pinned = false,
  onTogglePin,
  onOpenPage,
  openPageHref,
  labels,
  size,
  keepFocus = false,
}: {
  onClose?: () => void;
  // Whether the thing is full screen now; with `onToggleFull` the button switches both ways.
  full?: boolean;
  onToggleFull?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  // The thing's own page: a button, or a link when it is an address.
  onOpenPage?: () => void;
  openPageHref?: string;
  labels?: OverlayControlsLabels;
  size?: 'default' | 'small';
  // Toggling only changes classes: keep the caret in the field the reader was editing.
  keepFocus?: boolean;
}) {
  const t = useTranslations('common');
  const label = {
    pin: labels?.pin ?? t('pinOverlay'),
    unpin: labels?.unpin ?? t('unpinOverlay'),
    enterFull: labels?.enterFull ?? t('fullscreen'),
    exitFull: labels?.exitFull ?? t('exitFullscreen'),
    close: labels?.close ?? t('close'),
    openPage: labels?.openPage ?? t('openAsPage'),
  };
  const guard = keepFocus
    ? { onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault() }
    : {};
  const common = {
    className: 'ds-icon-button',
    'data-size': size === 'small' ? 'small' : undefined,
  };
  return (
    <>
      {openPageHref ? (
        <Link
          href={openPageHref}
          {...common}
          className="ds-icon-button ds-panel-open-page"
          data-control="open"
          title={label.openPage}
          aria-label={label.openPage}
        >
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      ) : (
        onOpenPage && (
          <button
            type="button"
            {...common}
            {...guard}
            className="ds-icon-button ds-panel-open-page"
            data-control="open"
            onClick={onOpenPage}
            title={label.openPage}
            aria-label={label.openPage}
          >
            <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        )
      )}
      {onTogglePin && (
        <button
          type="button"
          {...common}
          {...guard}
          className="ds-icon-button ds-panel-pin"
          data-control="pin"
          onClick={onTogglePin}
          aria-pressed={pinned}
          title={pinned ? label.unpin : label.pin}
          aria-label={pinned ? label.unpin : label.pin}
        >
          {pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
        </button>
      )}
      {onToggleFull && (
        <button
          type="button"
          {...common}
          {...guard}
          className="ds-icon-button ds-panel-full"
          data-control="full"
          onClick={onToggleFull}
          aria-pressed={full === true}
          title={full ? label.exitFull : label.enterFull}
          aria-label={full ? label.exitFull : label.enterFull}
        >
          {full ? (
            <Minimize2 size={16} aria-hidden="true" />
          ) : (
            <Maximize2 size={16} aria-hidden="true" />
          )}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          {...common}
          {...guard}
          className="ds-icon-button ds-panel-close"
          data-control="close"
          onClick={onClose}
          title={label.close}
          aria-label={label.close}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
