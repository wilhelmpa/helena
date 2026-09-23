import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// The body of a settings group: one hairline-framed surface, the sidebar's own 1px
// line (docs/volition-design-helena-ui.md "filigran") — no fill, no shadow.
//
// For a list of rows pass `divide-y` and let each row carry its own padding (a
// SettingsRow does); for a field form pass the padding here (p-4).
export default function SettingsCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'divide-sidebar-border overflow-hidden rounded-lg border border-sidebar-border bg-card',
        className,
      )}
    >
      {children}
    </div>
  );
}
