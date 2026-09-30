import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { ROW_CLASS } from '@/components/common/page/RowList';
import { Card, MonoLabel, MonoMeta, Tile } from '@/components/helena/DashboardPrimitives';

// The building blocks of Start's widgets (docs/helena-decisions/dashboard.md). Every widget
// is one of two things, in the sidebar's material: a figure tile in the row at the top, or
// a section below. A widget of a feature or a plugin uses these, never a look of its own.

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none';

// A section: the sidebar's group, framed. Its 12px label with the count and the way to the
// full list ("Freigaben ›") is the first row inside the frame; then 32px rows with 1px of air.
export function DashboardSection({
  label,
  count,
  href,
  hrefLabel,
  actions,
  children,
  className,
}: {
  label: ReactNode;
  count?: number | null;
  href?: string;
  hrefLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      gap={2}
      eyebrow={label}
      headingAs="h2"
      actions={
        <>
          {count ? <MonoMeta>{count}</MonoMeta> : null}
          {actions}
          {href && hrefLabel ? <CardLink href={href}>{hrefLabel}</CardLink> : null}
        </>
      }
      className={className}
    >
      {children}
    </Card>
  );
}

// The quiet "… ›" link in a section's label row; it fills like a sidebar row on hover.
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md ps-1.5 pe-1 text-xs font-normal text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
        FOCUS,
      )}
    >
      {children}
      <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
    </Link>
  );
}

// A group label inside a section ("Zuletzt fertig").
export function SectionSubLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex h-7 min-w-0 items-end px-2 pb-1">
      <MonoLabel className="truncate">{children}</MonoLabel>
    </h3>
  );
}

const WIDTHS = ['w-7/12', 'w-5/12', 'w-2/3', 'w-1/2', 'w-1/3', 'w-3/5'];

// Placeholder rows while a section loads: as many 32px rows as it will show, so nothing
// moves when the data arrives.
export function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} aria-hidden className={ROW_CLASS}>
          <span className="size-4 shrink-0 animate-pulse rounded-sm bg-accent" />
          <span
            className={cn('h-3 animate-pulse rounded-sm bg-accent', WIDTHS[index % WIDTHS.length])}
          />
        </div>
      ))}
    </>
  );
}

export type FigureTone = 'default' | 'danger' | 'waiting';

// A figure tile: its label (12px) with an optional status dot, the value (20px, tabular),
// an optional progress bar, and one sub-line (12px). The whole tile opens the details: a
// page (`href`) or a dialog (`onSelect`). Every tile of the row has the same height.
export function FigureTile({
  label,
  value,
  sub,
  subTone = 'default',
  status,
  progress,
  href,
  onSelect,
  title,
}: {
  label: ReactNode;
  // Null while it loads: the tile keeps its size and shows a placeholder.
  value: ReactNode | null;
  sub?: ReactNode;
  subTone?: FigureTone;
  status?: Status;
  // 0–100, with the bar's colour.
  progress?: { percent: number; className: string } | null;
  href?: string;
  onSelect?: () => void;
  title?: string;
}) {
  return (
    <Tile
      label={label}
      value={value}
      note={
        <span
          className={cn(
            subTone === 'danger' && 'text-[var(--dashboard-attention)]',
            subTone === 'waiting' && 'text-[var(--status-waiting)]',
          )}
        >
          {sub}
        </span>
      }
      tone={subTone === 'danger' ? 'attention' : status === 'running' ? 'positive' : 'default'}
      status={status && <StatusBadge status={status} dotOnly />}
      progress={progress}
      href={href}
      onSelect={onSelect}
      title={title}
    />
  );
}
