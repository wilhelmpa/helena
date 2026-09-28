'use client';

import {
  ExternalLink,
  ImageIcon,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  RefreshCw,
  Settings2,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { WorkspacePanelMode } from '@/hooks/useWorkspacePanel';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WORKSPACE_PANEL_HEADER_CLASS } from './WorkspaceHeader';

export default function WorkspacePanelHeader({
  title,
  advanced,
  canExpandChat,
  canToggleBrowserLossless,
  browserLossless,
  externalUrl,
  isMobile,
  full,
  mode,
  closable,
  picker,
  toolbar,
  slotRef,
  onToggleAdvanced,
  onToggleBrowserLossless,
  onToggleMode,
  onToggleFull,
  onReload,
  onClose,
  dockSheet = false,
  contextProjectKey = null,
  contextProjectName = null,
}: {
  title: string;
  advanced: boolean;
  canExpandChat: boolean;
  canToggleBrowserLossless: boolean;
  browserLossless: boolean;
  externalUrl: string | null | undefined;
  isMobile: boolean;
  // The tool takes the whole window; the header then offers the way back.
  full: boolean;
  mode: WorkspacePanelMode;
  // The panel may close and float over the page (the standard layout, not on the dual
  // kiosk); otherwise it offers neither.
  closable: boolean;
  // Picks the tool this area shows (WorkspaceToolPicker).
  picker: ReactNode;
  // Shown in place of the title, such as the browser's address bar.
  toolbar?: ReactNode;
  // Receives the slot the showing tool may fill with its own bar (PanelHeaderSlotCtx);
  // while it holds anything, the plain title is hidden.
  slotRef?: (element: HTMLElement | null) => void;
  onToggleAdvanced: () => void;
  onToggleBrowserLossless: () => void;
  onToggleMode: () => void;
  onToggleFull: () => void;
  onReload: () => void;
  onClose: () => void;
  dockSheet?: boolean;
  contextProjectKey?: string | null;
  contextProjectName?: string | null;
}) {
  const t = useTranslations('nav.workspace');
  const tChat = useTranslations('aiChat');
  const tCommon = useTranslations('common');
  const tLayout = useTranslations('nav.layout');
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const pageSegment = pathname.split('/')[3];
  const pageLabel =
    !pageSegment || pageSegment === 'view' || pageSegment === 'issue'
      ? tNav('workItems')
      : pageSegment === 'dashboard'
        ? tNav('dashboards')
        : pageSegment === 'files'
          ? tNav('sidebarKnowledge')
          : pageSegment === 'inbox'
            ? tNav('inbox')
            : pageSegment.replaceAll('-', ' ');
  if (dockSheet) {
    return (
      <div className="flex h-[46px] items-center justify-between px-5">
        <div className="helena-home-context min-w-0 flex-1 truncate !p-0">
          {tNav('dockContext')}{' '}
          <strong>
            {contextProjectName ?? contextProjectKey ?? tNav('home')} › {pageLabel}
          </strong>
        </div>
        <div ref={slotRef} className="hidden" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-full"
          onClick={onClose}
          aria-label={tCommon('close')}
        >
          <X size={14} />
        </Button>
      </div>
    );
  }
  return (
    <div className={cn(WORKSPACE_PANEL_HEADER_CLASS, 'gap-1', picker ? 'ps-1.5 pe-3' : 'px-3')}>
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
      {canExpandChat && (
        <Button
          variant={advanced ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5"
          onClick={onToggleAdvanced}
          aria-pressed={advanced}
        >
          <Settings2 />
          <span className="hidden sm:inline">{t('advanced')}</span>
        </Button>
      )}
      {canToggleBrowserLossless && (
        <Button
          variant={browserLossless ? 'secondary' : 'ghost'}
          size="icon"
          className="size-7"
          onClick={onToggleBrowserLossless}
          title={t('browserLossless')}
          aria-label={t('browserLossless')}
          aria-pressed={browserLossless}
        >
          <ImageIcon />
        </Button>
      )}
      {externalUrl && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onReload}
            title={tCommon('reload')}
            aria-label={tCommon('reload')}
          >
            <RefreshCw />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" asChild>
            <a
              href={externalUrl}
              target="_blank"
              rel="noreferrer"
              title={t('openExternal', { tool: title })}
            >
              <ExternalLink />
              <span className="sr-only">{t('openExternal', { tool: title })}</span>
            </a>
          </Button>
        </>
      )}
      {!isMobile && !full && closable && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={onToggleMode}
          title={tChat(mode === 'push' ? 'overlayMode' : 'pushMode')}
          aria-pressed={mode === 'push'}
        >
          {mode === 'push' ? <PinOff /> : <Pin />}
        </Button>
      )}
      {full ? (
        // The way back from "Werkzeug groß": named, since the header and the layout menu
        // are covered.
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={onToggleFull}
          title={tLayout('backHint')}
        >
          <Minimize2 />
          {tLayout('back')}
        </Button>
      ) : (
        !isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={onToggleFull}
            title={tLayout('full')}
            aria-label={tLayout('full')}
          >
            <Maximize2 />
          </Button>
        )
      )}
      {closable && !full && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          title={tCommon('close')}
          aria-label={tCommon('close')}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
