import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';

// The content column a section page occupies. Shared with the skeleton that stands
// in for a page, so a loading section is the width of the section that replaces it.
export const SECTION_COLUMN_CLASS = 'min-w-[800px] max-w-[60%]';

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
  const width = widthClassName ?? (wide ? 'mx-auto max-w-[1600px]' : SECTION_COLUMN_CLASS);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkspacePageHeader title={title} description={description} actions={actions} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn('flex min-h-full w-full flex-col px-4 pt-5 pb-4 sm:px-6 lg:px-8', width)}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
