'use client';

import type { ReactNode } from 'react';
import { useSidePanelWidth, SidePanelResizeHandle } from './sidePanelWidth';

// The right-hand panel (docs/design-system.md §3, owner 28.09. 10:00): only ever an
// overlay over the page — the page keeps its full width and is never squeezed. Two
// looks: the overlay at the right with the width the user dragged (320px to 90%), and
// full screen. 12px to the window edges, radius 16, a shadow. Closed, it is not there
// at all. The chat, the tools and the previews of Wissen and Belege all use it.
export function SidePanel({
  open,
  full = false,
  label,
  children,
  className,
}: {
  open: boolean;
  full?: boolean;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const { width } = useSidePanelWidth();
  return (
    <aside
      aria-label={label}
      aria-hidden={open ? undefined : true}
      data-open={open ? 'true' : 'false'}
      data-full={full ? 'true' : 'false'}
      className={`ds-side-panel ${className ?? ''}`}
      style={{ '--ds-panel-w': `${width}px` } as React.CSSProperties}
    >
      {open && !full && <SidePanelResizeHandle />}
      {children}
    </aside>
  );
}
