import { type ReactNode } from 'react';

// One property row: the name and the control are two cells of the Properties
// grid, so this renders no element of its own around them.
export default function IssuePropertyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="ds-issue-prop-label" title={label}>
        {label}
      </div>
      <div className="ds-issue-prop-value">{children}</div>
    </>
  );
}
