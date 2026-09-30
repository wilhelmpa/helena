import { Card } from '@/design-system';
import type { ReactNode } from 'react';

export default function DevicesSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card as="section">
      <h2 className="text-md font-medium">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </Card>
  );
}
