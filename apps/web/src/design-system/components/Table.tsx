import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

// A table, only for real tabular data (docs/design-system.md §4): mono-label head, 40px
// rows, no zebra stripes, row actions as "…" at the end. At ≤ 900px the rows become
// cards (CSS, .ds-table-wrap) — unless `stack` is off: a table whose cells carry no
// `label` keeps its columns and scrolls sideways instead.
export function Table({
  children,
  label,
  className,
  stack = true,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  stack?: boolean;
}) {
  return (
    <div className={`ds-table-wrap ${className ?? ''}`}>
      <table className="ds-table" aria-label={label} data-stack={stack ? undefined : 'off'}>
        {children}
      </table>
    </div>
  );
}

// Where a column's head and cells sit: numbers and row actions at the end.
export type TableAlign = 'start' | 'center' | 'end';

export function Th({
  className,
  alignment,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { alignment?: TableAlign }) {
  return (
    <th scope="col" data-align={alignment} className={`ds-th ${className ?? ''}`} {...props} />
  );
}

export function Tr({
  selected,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return <tr className={`ds-tr ${selected ? 'is-selected' : ''} ${className ?? ''}`} {...props} />;
}

// `label` repeats the column head on the card layout of a narrow screen.
export function Td({
  label,
  alignment,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { label?: string; alignment?: TableAlign }) {
  return (
    <td
      data-label={label}
      data-align={alignment}
      className={`ds-td ${className ?? ''}`}
      {...props}
    />
  );
}
