import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { StatusDot, type StatusDotTone } from '@/design-system/components/StatusDot';

// The one status vocabulary the whole app shares: an agent run, an approval, a workflow
// result, a sync state are all one of these five. The label says what it is; a dot only
// stands after it while something is going on (docs/design-system.md §6) — orange
// pulsing while it runs, amber when it waits for you, rose on an error. Done and idle
// carry no dot, and none is ever green.
export type Status = 'running' | 'waiting' | 'success' | 'danger' | 'idle';

const TONE: Partial<Record<Status, StatusDotTone>> = {
  running: 'working',
  waiting: 'waiting',
  danger: 'error',
};

// `dotOnly`: the bare dot (an avatar corner, a table row) — nothing at rest.
export default function StatusBadge({
  status,
  children,
  dotOnly = false,
  className,
}: {
  status: Status;
  children?: ReactNode;
  dotOnly?: boolean;
  className?: string;
}) {
  const tone = TONE[status];
  if (dotOnly) return tone ? <StatusDot tone={tone} /> : null;
  return (
    <span
      className={cn(
        'ds-status-badge inline-flex w-fit shrink-0 items-center text-xs',
        status === 'danger' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {children}
      {tone && <StatusDot tone={tone} />}
    </span>
  );
}
