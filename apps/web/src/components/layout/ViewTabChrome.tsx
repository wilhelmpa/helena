import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { workspaceToolbarButtonClass } from '@/components/layout/WorkspaceToolbarButton';

// Shared tab shell (background/active styling), used by the All tab, the saved
// tabs and the drag overlay so they look identical. Extra div props (the sortable
// ref and drag listeners) pass through.
export default function ViewTabChrome({
  active,
  className,
  children,
  ...props
}: { active: boolean } & ComponentProps<'div'>) {
  return (
    <div className={cn(workspaceToolbarButtonClass(active), 'gap-0 px-0', className)} {...props}>
      {children}
    </div>
  );
}
