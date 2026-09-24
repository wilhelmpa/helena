import { cloneElement, isValidElement, type ReactNode } from 'react';

// Wraps a Pill (or Pill-shaped trigger) for a non-interactive read-only display on
// the public shared pages: the pill shows its current value with no popover or
// click behaviour, and is not a stop for the keyboard. A pill without a value
// (`active` false, which would show the field's name as a placeholder, looking like
// a button to press) reads as a dash instead.
export default function ReadOnlyPill({ children }: { children: ReactNode }) {
  if (isValidElement<{ active?: boolean; tabIndex?: number }>(children)) {
    if (children.props.active === false) {
      return <span className="text-sm text-muted-foreground">—</span>;
    }
    return (
      <span className="pointer-events-none inline-flex">
        {cloneElement(children, { tabIndex: -1 })}
      </span>
    );
  }
  return <span className="pointer-events-none inline-flex">{children}</span>;
}
