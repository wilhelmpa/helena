'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { PageChromeCtx } from './pageChrome';
import { OverlayHead } from './OverlayHead';
import { useHydrated } from '@/hooks/useHydrated';
import { useTranslations } from 'next-intl';

// The one large modal (docs/design-system.md §3): 1200 × 800, full screen on a phone,
// small (880 × 640) for Mein Konto. Its head is the head of every overlay (OverlayHead: the tab
// naming it, an optional search, then full screen and close), the sections on the left, a
// search with results and their path. The page behind never changes: the modal only lies over
// it, and Esc closes it (out of full screen first).

export type ModalTab = { id: string; label: ReactNode; dot?: string };
export type ModalSectionItem = { id: string; label: ReactNode; danger?: boolean };

export function Modal({
  open,
  label,
  onClose,
  tabs,
  activeTab,
  onTab,
  search,
  onSearch,
  searchPlaceholder,
  nav,
  children,
  title,
  testId,
  size = 'large',
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  tabs?: ModalTab[];
  activeTab?: string;
  onTab?: (id: string) => void;
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  // The left column: the sections of the current tab, or the search results.
  nav?: ReactNode;
  children: ReactNode;
  // Names the modal when it has no tabs: the one tab of its head.
  title?: ReactNode;
  testId?: string;
  // 'small': Mein Konto (the only settings that still open as a modal).
  size?: 'large' | 'small';
}) {
  const t = useTranslations('common');
  const placeholder = searchPlaceholder ?? t('searchSettings');
  const dialog = useRef<HTMLElement>(null);
  const hydrated = useHydrated();
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.dataset.modalOpen = 'true';
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A menu, a select or a dialog inside the modal closes first.
      if (
        document.querySelector(
          '[data-slot="dialog-content"][data-state="open"], [data-slot="alert-dialog-content"][data-state="open"], [data-slot="select-content"][data-state="open"], [data-slot="dropdown-menu-content"][data-state="open"], [data-slot="popover-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"]',
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (full) setFull(false);
      else onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      delete document.body.dataset.modalOpen;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, full]);

  // The section in view in the scrolling row of sections on a phone.
  useEffect(() => {
    if (!open || !hydrated) return;
    dialog.current
      ?.querySelector('.ds-modal-nav-item.is-active')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [open, hydrated, activeTab, nav]);

  // A portal only after hydration: the server has no document, so the first client
  // render must match its empty output (React #418 on a reload with the modal open).
  if (!open || !hydrated) return null;
  return createPortal(
    <div className="ds-modal-layer">
      <div className="ds-modal-scrim" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={size === 'small' ? 'ds-modal is-small' : 'ds-modal'}
        data-full={full ? 'true' : 'false'}
        data-testid={testId}
      >
        <OverlayHead
          label={label}
          tabs={
            tabs
              ? tabs.map((tab) => ({ id: tab.id, label: tab.label }))
              : [{ id: 'title', label: title ?? label }]
          }
          activeTab={activeTab}
          onTab={onTab}
          actions={
            onSearch && (
              <label className="ds-modal-search">
                <Search size={14} aria-hidden="true" />
                <input
                  value={search ?? ''}
                  onChange={(event) => onSearch(event.target.value)}
                  placeholder={placeholder}
                  aria-label={placeholder}
                />
              </label>
            )
          }
          controls={{ full, onToggleFull: () => setFull(!full), onClose }}
        />
        <div className={`ds-modal-main ${nav ? '' : 'is-single'}`}>
          {nav && (
            <nav className="ds-modal-nav" aria-label={label}>
              {nav}
            </nav>
          )}
          <div className="ds-modal-pane">
            <PageChromeCtx.Provider value="modal">{children}</PageChromeCtx.Provider>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

// A row of the modal's section list, or a search result with its path.
export function ModalNavItem({
  active,
  danger,
  path,
  children,
  onClick,
}: {
  active?: boolean;
  danger?: boolean;
  path?: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ds-modal-nav-item ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
    >
      {path && <small>{path}</small>}
      <span>{children}</span>
    </button>
  );
}

export function ModalNavGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="ds-modal-nav-group">
      <span className="ds-mono-label">{label}</span>
      {children}
    </div>
  );
}
