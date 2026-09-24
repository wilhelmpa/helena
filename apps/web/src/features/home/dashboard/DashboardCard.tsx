import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROW_CLASS } from '@/components/common/page/RowList';

// The one card of Start: the sidebar's surface in a hairline frame, a 32px header row
// (16px icon, 14px title, a count in mono, the card's own controls, and the way to the
// full list), then 32px rows with 1px of air between them — the sidebar menu's rhythm.
// A card that has somewhere to go names it in the header ("Alle ›"), so the header is
// the only place a card links from besides its rows.
export default function DashboardCard({
  title,
  icon,
  count,
  href,
  hrefLabel,
  actions,
  children,
  className,
  bodyClassName,
  labelledBy,
}: {
  title: ReactNode;
  icon?: ReactNode;
  count?: ReactNode;
  href?: string;
  hrefLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  labelledBy?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn(
        'flex min-w-0 flex-col rounded-lg border border-sidebar-border bg-card p-1',
        className,
      )}
    >
      <header className="flex h-8 min-w-0 shrink-0 items-center gap-2 ps-2 pe-1 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
        {icon}
        <h2 id={labelledBy} className="min-w-0 truncate text-md font-semibold">
          {title}
        </h2>
        {count != null && count !== false && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
        <span className="flex-1" />
        {actions}
        {href && hrefLabel && <CardLink href={href}>{hrefLabel}</CardLink>}
      </header>
      <div className={cn('flex min-h-0 flex-1 flex-col gap-px', bodyClassName)}>{children}</div>
    </section>
  );
}

// "Alle ›" in a card's header: a quiet 12px link that fills like a sidebar row on hover.
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md ps-1.5 pe-1 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
    >
      {children}
      <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
    </Link>
  );
}

const WIDTHS = ['w-7/12', 'w-5/12', 'w-2/3', 'w-1/2', 'w-1/3', 'w-3/5'];

// Placeholder rows while a card loads: as many 32px rows as the card will show, so
// nothing moves when the data arrives.
export function SkeletonRows({ count, className }: { count: number; className?: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} aria-hidden className={cn(ROW_CLASS, className)}>
          <span className="size-4 shrink-0 animate-pulse rounded-sm bg-accent" />
          <span
            className={cn('h-3 animate-pulse rounded-sm bg-accent', WIDTHS[index % WIDTHS.length])}
          />
        </div>
      ))}
    </>
  );
}
