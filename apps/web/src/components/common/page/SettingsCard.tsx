import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// The body of a settings group: the card of the design system (surface-1, radius 12, the card
// shadow — the same box as a SettingsGroup, owner 30.09., "Elemente immer gleich").
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
  return <div className={cn('ds-settings-card', className)}>{children}</div>;
}
