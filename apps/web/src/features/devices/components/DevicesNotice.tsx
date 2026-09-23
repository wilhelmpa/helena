import type { ReactNode } from 'react';

export default function DevicesNotice({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      {title ? <p className="font-medium">{title}</p> : null}
      <p className={title ? 'mt-1 text-muted-foreground' : undefined}>{children}</p>
    </div>
  );
}
