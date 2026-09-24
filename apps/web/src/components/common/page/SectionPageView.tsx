'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';

// The content column a section page occupies: the full width up to the default content
// measure (PageBody's 1080px), never a fixed minimum — a phone gets the whole screen,
// not a sideways scroll. Shared with the skeleton that stands in for a page, so a
// loading section is the width of the section that replaces it.
export const SECTION_COLUMN_CLASS = 'w-full max-w-[67.5rem]';

// The page gutter (docs/volition-design-helena-ui.md "Spacing"): 16px, 24px beside a
// wide desktop column. Every page body inside the shell uses this one.
export const PAGE_GUTTER_CLASS = 'px-4 py-4';

// The chrome for a section page rendered inside the app shell: the scroll
// container, the content column, and a header (title and description).
// `wide` gives a page whose content is a table the room to span the shell;
// `widthClassName` overrides the column outright.
// The column is a flex column at least as tall as the viewport area, so a child
// marked `flex-1` (an empty state) fills the space left under the header.
export default function SectionPageView({
  title,
  description,
  actions,
  wide = false,
  widthClassName,
  children,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  widthClassName?: string;
  children: ReactNode;
}) {
  const width = widthClassName ?? (wide ? 'mx-auto w-full max-w-[1600px]' : SECTION_COLUMN_CLASS);
  // In the single-row header the description is not shown (see WorkspacePageHeader).
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkspacePageHeader title={title} description={description} actions={actions} />
      <div className="@container/page min-h-0 flex-1 overflow-y-auto">
        <div className={cn('flex min-h-full w-full flex-col', PAGE_GUTTER_CLASS, width)}>
          {children}
        </div>
      </div>
    </div>
  );
}
