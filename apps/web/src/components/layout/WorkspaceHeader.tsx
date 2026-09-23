import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const WORKSPACE_HEADER_CLASS = 'flex h-12 shrink-0 items-center border-b';
export const WORKSPACE_HEADER_DESCRIPTION_CLASS =
  'hidden min-w-0 truncate text-xs text-muted-foreground md:block';

export function WorkspaceHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(WORKSPACE_HEADER_CLASS, className)} {...props} />;
}

export function WorkspacePageHeader({
  title,
  description,
  actions,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <WorkspaceHeader className={cn('bg-background px-4 sm:px-6', className)}>
      <div className={cn('flex min-w-0 flex-1 items-center gap-3', contentClassName)}>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="min-w-0 truncate text-xl font-semibold">{title}</h1>
          {description ? (
            <div className={WORKSPACE_HEADER_DESCRIPTION_CLASS}>{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </WorkspaceHeader>
  );
}
