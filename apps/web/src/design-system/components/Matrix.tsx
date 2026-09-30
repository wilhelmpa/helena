'use client';

import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './Menu';

// A matrix of settings (docs/design-system.md §4): rows are things (agents, task classes),
// columns are what can be set on them, and every cell is a value that opens its own picker
// in place. It is a Table with editable cells — so the same head, rows and narrow-screen
// cards — plus these pieces:
//   MatrixCellButton  the value as a quiet button; a dot says where it comes from
//   MatrixCell        the button with a free panel (a form) under it
//   MatrixNote        the line at the foot of a panel: where the value comes from + the way back
//   MatrixBar         the bar that holds the changes made and not yet applied
// A cell offering a plain list uses PopoverPick (with `trigger` = MatrixCellButton).
export type MatrixMark = 'own' | 'changed' | null;

export const MatrixCellButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    label: ReactNode;
    // A second, quieter line (the model behind "Lokal", the threshold of a decider).
    detail?: ReactNode;
    // own: set on this row itself; changed: staged and not applied yet.
    mark?: MatrixMark;
    // Said aloud for the dot, which is only a colour otherwise.
    markLabel?: string;
    chevron?: boolean;
  }
>(function MatrixCellButton(
  { label, detail, mark = null, markLabel, chevron = true, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ds-matrix-cell ${className ?? ''}`}
      data-mark={mark ?? undefined}
      {...props}
    >
      {mark && (
        <span className="ds-matrix-mark" data-kind={mark} role="img" aria-label={markLabel} />
      )}
      <span className="ds-matrix-cell-text">
        <span className="ds-matrix-cell-label">{label}</span>
        {detail && <span className="ds-matrix-cell-detail">{detail}</span>}
      </span>
      {chevron && <ChevronDown className="ds-matrix-cell-chevron" aria-hidden="true" />}
    </button>
  );
});

export function MatrixCell({
  children,
  onOpenChange,
  align = 'start',
  ...button
}: Omit<Parameters<typeof MatrixCellButton>[0], 'ref'> & {
  // The panel; a function gets `close` to end the edit.
  children: ReactNode | ((close: () => void) => ReactNode);
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <MatrixCellButton {...button} />
      </PopoverTrigger>
      <PopoverContent align={align} className="ds-matrix-panel">
        {typeof children === 'function' ? children(() => change(false)) : children}
      </PopoverContent>
    </Popover>
  );
}

// The foot of a cell's panel.
export function MatrixNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ds-matrix-note">
      <span>{children}</span>
      {action}
    </div>
  );
}

// The bar under the matrix while changes wait: what they are, what can be done with them.
export function MatrixBar({ children }: { children: ReactNode }) {
  return (
    <div className="ds-matrix-bar" role="region">
      {children}
    </div>
  );
}
