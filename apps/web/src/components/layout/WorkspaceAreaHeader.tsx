'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WORKSPACE_PANEL_HEADER_CLASS } from './WorkspaceHeader';

// The header row of a workspace layout's area that shows a tool of its own (the docked
// chat, the second tool beside the panel's): its tool picker, the tool's own bar (the
// chat's title and menu, the browser's address bar) or its name, and the button that
// closes the area, which goes back to the standard layout. The same 40px row as the
// panel's header (WorkspacePanelHeader), so the areas line up side by side.
export default function WorkspaceAreaHeader({
  title,
  picker,
  toolbar,
  slotRef,
  onClose,
}: {
  title: string;
  picker: ReactNode;
  // Shown in place of the title, such as the browser's address bar.
  toolbar?: ReactNode;
  // Receives the slot the tool may fill with its own bar (PanelHeaderSlotCtx).
  slotRef: (element: HTMLElement | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations('nav.layout');
  return (
    <div className={cn(WORKSPACE_PANEL_HEADER_CLASS, 'gap-1 ps-1.5 pe-3')}>
      {picker}
      {toolbar ?? (
        <>
          <div
            ref={slotRef}
            data-slot="panel-header-slot"
            className="peer flex min-w-0 flex-1 items-center gap-0.5 empty:hidden"
          />
          <div className="min-w-0 flex-1 truncate text-sm font-medium peer-[:not(:empty)]:hidden">
            {title}
          </div>
        </>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        onClick={onClose}
        title={t('closeArea')}
        aria-label={t('closeArea')}
      >
        <X />
      </Button>
    </div>
  );
}
