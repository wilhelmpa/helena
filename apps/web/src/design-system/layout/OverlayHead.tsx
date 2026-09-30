'use client';

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { OverlayControls } from '../components/OverlayControls';

// The ONE head of everything that opens over or beside a page (owner 30.09., O102): the tool
// panel with its chat, the overlay of a task, a run, an agent, a file, a receipt, the
// settings modal. 56px, segment tabs at the left (one tab naming the thing when it has no
// views), at the right its own actions (at most one button or one "..." menu, see
// ActionMenu) and then, always in this order and always drawn by OverlayControls, its
// own page - pin - full screen - close. Nothing else draws a head (guard test
// app/overlayGuard.test.ts, measurement in scripts/ui-audit.mjs).
export type OverlayTab = {
  id: string;
  label: ReactNode;
  // A symbol before the name (the tool panel's tabs).
  icon?: ReactNode;
  title?: string;
  // Present: the tab can be closed with a small button (a browser or tool tab).
  onClose?: () => void;
  closeLabel?: string;
};

export function OverlayHead({
  label,
  tabs,
  activeTab,
  onTab,
  addTab,
  tabProps,
  actions,
  controls,
}: {
  // The name of the tab group (screen readers).
  label: string;
  tabs: OverlayTab[];
  activeTab?: string;
  onTab?: (id: string) => void;
  // After the tabs: the "+" that opens another (the tool panel).
  addTab?: ReactNode;
  // What each tab's frame needs besides the look (drag to reorder, the tool panel).
  tabProps?: (tab: OverlayTab) => HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  // The thing's own actions, before the controls.
  actions?: ReactNode;
  controls: Parameters<typeof OverlayControls>[0];
}) {
  const active = activeTab ?? tabs[0]?.id;
  const track = useRef<HTMLDivElement>(null);
  // The open tab stays in view when the row of tabs scrolls (a narrow screen).
  useEffect(() => {
    track.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return (
    <div className="ds-panel-head" data-overlay-head="">
      <div className="ds-panel-tabs">
        <div ref={track} className="ds-panel-tabs-track" role="tablist" aria-label={label}>
          {tabs.map((tab) => (
            <div key={tab.id} className="ds-panel-tab" {...tabProps?.(tab)}>
              <button
                type="button"
                role="tab"
                className="ds-panel-tab-select"
                aria-selected={tab.id === active}
                title={tab.title}
                onClick={() => onTab?.(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
              {tab.onClose && (
                <button
                  type="button"
                  className="ds-panel-tab-close"
                  aria-label={tab.closeLabel}
                  onClick={tab.onClose}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
        {addTab}
      </div>
      <div className="ds-panel-head-tools">
        {actions}
        <OverlayControls {...controls} />
      </div>
    </div>
  );
}
