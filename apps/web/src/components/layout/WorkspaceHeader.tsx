'use client';

import type { ComponentProps, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useShellHeaderActionsSlot, useShellHeaderSlot } from '@/context/shellHeaderSlot';
import { Separator } from '@/components/ui/separator';

export const WORKSPACE_HEADER_CLASS = 'flex h-12 shrink-0 items-center border-b';

// The tool panel's own header (chat/terminal/code/browser/mail): one compact row,
// filigree like the sidebar rather than a second full page header
// (docs/volition-design-helena-ui.md, owner decision 2026-09-23 "so filigran wie
// die Sidebar"). 40px, not AppHeader/WorkspacePageHeader's 48px — a panel is not a
// page. Its buttons and icons already are (size-7 buttons, 16px icons by the
// Button component's own default, see WorkspacePanelHeader).
export const WORKSPACE_PANEL_HEADER_CLASS = 'flex h-10 shrink-0 items-center border-b bg-card';

export function WorkspaceHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(WORKSPACE_HEADER_CLASS, className)} {...props} />;
}

// A page's own heading inside the shell. In the single-row header layout (the default)
// the page has no second header row: the app header already names it (its breadcrumb)
// and the page's actions go into the header's page slot — the owner's "eine Kopfzeile,
// einreihig". A page has no intro line under or beside its title (owner, 2026-09-24:
// the intro lines were noise; docs/volition/ui-standard.md). In the 'classic' layout,
// and outside the shell, the page keeps its own 48px title bar: the title (16,
// semibold) and the actions on the right.
export function WorkspacePageHeader({
  title,
  actions,
  className,
  contentClassName,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const slot = useShellHeaderSlot();
  const actionsSlot = useShellHeaderActionsSlot();
  if (slot) {
    return (
      <>
        <h1 className="sr-only">{title}</h1>
        {actions
          ? createPortal(
              <div className="flex shrink-0 items-center gap-2">{actions}</div>,
              actionsSlot ?? slot,
            )
          : null}
      </>
    );
  }
  return (
    <WorkspaceHeader className={cn('bg-background px-4', className)}>
      <div className={cn('flex min-w-0 flex-1 items-center gap-3', contentClassName)}>
        <h1 className="min-w-0 flex-1 truncate text-md font-semibold">{title}</h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </WorkspaceHeader>
  );
}

// A page's own tab/switcher row (dashboard tabs, note boards). In the single-row header
// it moves into the app header's page slot, after a hairline, instead of stacking a
// second 48px row under it — a React portal, so its context (drag and drop, dialogs)
// stays the page's own. In the 'classic' layout and outside the shell it is that row.
export function ShellHeaderRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const slot = useShellHeaderSlot();
  if (slot) {
    // The phone's page bar (see Shell) starts the row itself: no hairline before it.
    const inHeader = slot.dataset.slot !== 'app-page-bar';
    return createPortal(
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {inHeader ? <Separator orientation="vertical" className="me-1 h-4" /> : null}
        {children}
      </div>,
      slot,
    );
  }
  return <WorkspaceHeader className={className}>{children}</WorkspaceHeader>;
}
