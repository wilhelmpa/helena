import type { HTMLAttributes } from 'react';

// The box every list of a page sits in (owner 30.09., O108): surface-1, a 1px line, radius 12 -
// like the task list. A main area is never rows loose on the page ground. Its rows are
// ListRow / KnowledgeRow / a table; column heads sit inside, on top.
export function ListBox({
  className,
  padded = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  // A little air between the box's edge and its rows (rows with a hover fill of their own).
  padded?: boolean;
}) {
  return (
    <div
      className={`ds-list-box ${className ?? ''}`}
      data-padded={padded ? '' : undefined}
      {...props}
    />
  );
}
