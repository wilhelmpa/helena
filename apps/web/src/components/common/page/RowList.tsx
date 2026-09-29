import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// The sidebar's list look for the main area and the panels (docs/volition-design-helena-
// ui.md "Die Sidebar ist die Referenz"): a group label, then 32px rows — 16px icon, 14px
// title, the 12px detail after it on the same line, a trailing slot (a count, a status
// dot, a key in mono) — inside one hairline frame. A row that goes somewhere is a
// RowLink and takes the sidebar's hover fill and pointer; a row that only reports
// (RowStatic) has neither, so it never looks clickable.

// The group label: the sidebar's SidebarGroupLabel (12px, medium, muted, 32px high).
export function SectionLabel({
  children,
  icon,
  trailing,
  className,
  as: Tag = 'h2',
}: {
  children: ReactNode;
  icon?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  as?: 'h2' | 'h3' | 'div';
}) {
  return (
    <Tag
      className={cn(
        'flex h-8 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Tag>
  );
}

// The frame around a group of rows: 1px sidebar-border hairline, 4px inset, rows
// separated by 1px of air rather than lines — the sidebar menu's own rhythm.
export function RowList({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-px rounded-md border border-sidebar-border p-1', className)}
      {...props}
    />
  );
}

export const ROW_CLASS =
  'flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm outline-none [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground';
export const ROW_INTERACTIVE_CLASS =
  'cursor-pointer transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring';

function RowBody({
  icon,
  title,
  detail,
  trailing,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <>
      {icon}
      <span className="min-w-0 shrink truncate" dir="auto">
        {title}
      </span>
      {detail ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
          {detail}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {trailing && <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>}
    </>
  );
}

type RowProps = {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  className?: string;
};

// A row that opens something: a link with the sidebar's hover fill.
export function RowLink({ href, className, ...body }: RowProps & { href: string }) {
  return (
    <Link href={href} className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS, className)}>
      <RowBody {...body} />
    </Link>
  );
}

// A row that only reports a state: no hover, no pointer.
export function RowStatic({ className, ...body }: RowProps) {
  return (
    <div className={cn(ROW_CLASS, className)}>
      <RowBody {...body} />
    </div>
  );
}

// The one line an empty group shows inside its frame.
export function RowEmpty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn(ROW_CLASS, 'text-muted-foreground')}>
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}
