import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';

// Shared tab shell, used by the All tab, the saved tabs and the drag overlay so they
// look identical: a header-row tab like every page's (PageTabs), 28px, 13px text,
// the sidebar's hover and selected fill. Extra div props (the sortable ref and drag
// listeners) pass through.
export default function ViewTabChrome({
  active,
  className,
  children,
  ...props
}: { active: boolean } & ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        PAGE_CONTROL_CLASS,
        'h-7 gap-0 px-0',
        active && PAGE_CONTROL_ACTIVE_CLASS,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
