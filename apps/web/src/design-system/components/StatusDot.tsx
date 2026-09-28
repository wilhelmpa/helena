// The small status dot of a tree row or list row (docs/design-system.md §6): only when
// something is going on — orange pulsing while agents work, amber when something waits
// for you, rose on an error. At rest there is no dot, and never a green one. It stands
// after the text, so the text never moves when the dot comes or goes.
export type StatusDotTone = 'working' | 'waiting' | 'error';

export function StatusDot({ tone, label }: { tone: StatusDotTone; label?: string }) {
  return (
    <span
      className="ds-status-dot"
      data-tone={tone}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
