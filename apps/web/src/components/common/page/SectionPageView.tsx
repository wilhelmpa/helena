'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';

// The content column a section page occupies: the full width up to the default content
// measure (PageBody's 1080px), never a fixed minimum — a phone gets the whole screen,
// not a sideways scroll. Shared with the skeleton that stands in for a page, so a
// loading section is the width of the section that replaces it.
export const SECTION_COLUMN_CLASS = 'w-full max-w-[67.5rem]';

// The page gutter: 16px on every side, at every width, the same as the dashboard grid
// and its gaps (owner, 2026-09-24: "Padding im Hauptbereich überall homogen wie beim
// Dashboard"). Every page body inside the shell uses this one.
export const PAGE_GUTTER_CLASS = 'px-4 py-4';

// The chrome for a section page rendered inside the app shell: the scroll
// container, the content column, and a header (the title; no intro line under it,
// docs/volition/ui-standard.md).
// `wide` gives a page whose content is a list, table or grid the whole shell (16px
// gutter, no centred column), like the dashboard; the default column is for forms and
// stays left-aligned, so the left edge is the same everywhere;
// `widthClassName` overrides the column outright.
// The column is a flex column at least as tall as the viewport area, so a child
// marked `flex-1` (an empty state) fills the space left under the header.
export default function SectionPageView({
  title,
  actions,
  wide = false,
  widthClassName,
  children,
}: {
  title: string;
  actions?: ReactNode;
  wide?: boolean;
  widthClassName?: string;
  children: ReactNode;
}) {
  const width = widthClassName ?? (wide ? 'w-full' : SECTION_COLUMN_CLASS);
  return (
    <div className="ds-section-page flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkspacePageHeader title={title} actions={actions} />
      <div className="ds-section-page-scroll @container/page min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            'ds-section-page-col flex min-h-full w-full flex-col',
            PAGE_GUTTER_CLASS,
            width,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
