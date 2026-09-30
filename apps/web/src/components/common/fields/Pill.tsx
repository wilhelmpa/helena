import type { ComponentProps } from 'react';
import { PillButton } from '@/design-system';

// A field trigger: the design system's pill button (icon + label), the same for the field
// selects, the new-issue modal and the issue detail panel. It never grows past the room it is
// given, so a caller puts its text in a `truncate` span rather than letting a long value push
// out of the column.
export function Pill({
  active,
  children,
  className,
  ...props
}: { active?: boolean } & Omit<ComponentProps<typeof PillButton>, 'tone' | 'fit'>) {
  return (
    <PillButton fit tone={active ? 'active' : 'neutral'} className={className} {...props}>
      {children}
    </PillButton>
  );
}
