import type { ReactNode } from 'react';

export default function DevicesNotice({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-status-waiting/30 bg-status-waiting/10 px-3 py-2.5 text-sm">
      {title ? <p className="font-medium">{title}</p> : null}
      <p className={title ? 'mt-1 text-muted-foreground' : undefined}>{children}</p>
    </div>
  );
}
