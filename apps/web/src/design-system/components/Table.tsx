import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

// A table, only for real tabular data (docs/design-system.md §4): mono-label head, 40px
// rows, no zebra stripes, row actions as "…" at the end. At ≤ 900px the rows become
// cards (CSS, .ds-table-wrap).
export function Table({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`ds-table-wrap ${className ?? ''}`}>
      <table className="ds-table" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={`ds-th ${className ?? ''}`} {...props} />;
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
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { label?: string }) {
  return <td data-label={label} className={`ds-td ${className ?? ''}`} {...props} />;
}
