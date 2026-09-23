import { cn } from '@/lib/utils';

export const WORKSPACE_TOOLBAR_BUTTON_CLASS =
  'flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring [&_svg]:size-3.5 [&_svg]:shrink-0';

export const WORKSPACE_TOOLBAR_BUTTON_ACTIVE_CLASS = 'bg-secondary font-medium text-foreground';

export const WORKSPACE_TOOLBAR_BUTTON_INACTIVE_CLASS =
  'text-muted-foreground hover:bg-accent hover:text-foreground';

export function workspaceToolbarButtonClass(active: boolean, className?: string) {
  return cn(
    WORKSPACE_TOOLBAR_BUTTON_CLASS,
    active ? WORKSPACE_TOOLBAR_BUTTON_ACTIVE_CLASS : WORKSPACE_TOOLBAR_BUTTON_INACTIVE_CLASS,
    className,
  );
}

export const WORKSPACE_TOOLBAR_TRIGGER_CLASS = cn(
  WORKSPACE_TOOLBAR_BUTTON_CLASS,
  WORKSPACE_TOOLBAR_BUTTON_INACTIVE_CLASS,
  'data-[state=active]:bg-secondary data-[state=active]:font-medium data-[state=active]:text-foreground',
);
