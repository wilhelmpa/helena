import type { ReactNode } from 'react';
import { EmptyState as FrameworkEmptyState } from '@/design-system/components/Section';

// Kept for older call sites: the one empty state of the framework (docs/ui-framework.md)
// with a title, one sentence and the action (`children`).
export function EmptyState({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <FrameworkEmptyState icon={icon} title={title} action={children}>
      {description}
    </FrameworkEmptyState>
  );
}
