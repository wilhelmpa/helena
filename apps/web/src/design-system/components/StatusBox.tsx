import type { ReactNode } from 'react';

// The status of a task as a box of its own (owner, O43/O45/E2): a small outlined chip with the
// state's icon and its name. One look for the list, the table and the board card; the icon is
// the caller's (the state icon of the feature that knows the column), the name is the column's.
export function StatusBox({
  icon,
  stateType,
  className,
  children,
}: {
  icon?: ReactNode;
  stateType?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`ds-issue-status ${className ?? ''}`} data-state-type={stateType}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
