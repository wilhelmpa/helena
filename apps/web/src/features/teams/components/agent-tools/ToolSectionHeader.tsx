import type { ReactNode } from 'react';

// The heading of one list on the Tools page, with the action that adds to it.
export function ToolSectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-md font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}
