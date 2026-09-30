// The small status dot of a tree row or list row (docs/design-system.md §6): only when
// something is going on — orange pulsing while agents work, amber when something waits
// for you, rose on an error. At rest there is no dot, and never a green one. It stands
// after the text, so the text never moves when the dot comes or goes.
//
// Two more dots that are no status: `unread` (something new, in the accent) and `quiet` (a bullet
// in a list). `bare` drops the gap in front of it, for a dot that stands alone (a corner, a
// bullet). Nobody draws a round coloured span of their own (guard: app/elementGuard.test.ts).
export type StatusDotTone = 'working' | 'waiting' | 'error' | 'unread' | 'quiet';

export function StatusDot({
  tone,
  label,
  bare = false,
  className,
}: {
  tone: StatusDotTone;
  label?: string;
  bare?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`ds-status-dot ${className ?? ''}`}
      data-tone={tone}
      data-bare={bare ? '' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
