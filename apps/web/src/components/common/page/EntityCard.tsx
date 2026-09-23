import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// The one card shape for a project, an agent or a workflow in a list
// (docs/volition-design-helena-ui.md "Bausteine"): an icon or avatar, a name and an
// optional monospace key in the header, a status badge, up to two metrics, and a
// footer (last active). The whole card is one link; the border lifts on hover
// instead of a shadow, matching the sidebar's flat, line-drawn surfaces.
export default function EntityCard({
  href,
  icon,
  title,
  code,
  status,
  metrics,
  footer,
  className,
}: {
  href: string;
  icon?: ReactNode;
  title: ReactNode;
  code?: string;
  status?: ReactNode;
  metrics?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {code && (
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">{code}</div>
          )}
        </div>
        {status && <div className="shrink-0">{status}</div>}
      </div>
      {metrics && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground [&>*]:tabular-nums">
          {metrics}
        </div>
      )}
      {footer && (
        <div className="mt-auto border-t border-border pt-3 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </Link>
  );
}
