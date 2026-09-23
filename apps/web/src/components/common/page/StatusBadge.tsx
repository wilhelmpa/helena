import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// The one status vocabulary the whole app shares (docs/volition-design-helena-ui.md
// "Grundlagen"): an agent run, an approval, a workflow result, a sync state are all one
// of these five. Never spell a status out in a raw Tailwind color — use this and the
// `--status-*` tokens it is built on, so light/dark and a future palette change stay
// in one place.
export type Status = 'running' | 'waiting' | 'success' | 'danger' | 'idle';

const DOT_CLASS: Record<Status, string> = {
  running: 'bg-status-running',
  waiting: 'bg-status-waiting',
  success: 'bg-status-success',
  danger: 'bg-status-danger',
  idle: 'bg-status-idle',
};

// A status dot plus label. `running` pulses gently to read as "live" (a working
// agent, a run in progress); `prefers-reduced-motion` turns the animation off. Pass
// `dotOnly` for a bare presence dot (an avatar corner, a table row) with no label.
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
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1.5 text-xs font-medium text-foreground',
        className,
      )}
    >
      <span className="relative flex size-1.5 shrink-0" aria-hidden>
        {status === 'running' && (
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-75 motion-reduce:hidden',
              DOT_CLASS[status],
            )}
          />
        )}
        <span className={cn('relative inline-flex size-1.5 rounded-full', DOT_CLASS[status])} />
      </span>
      {!dotOnly && children}
    </span>
  );
}
