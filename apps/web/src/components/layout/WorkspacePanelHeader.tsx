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
  fullscreen,
  mode,
  pinned = false,
  splitControl,
  toolbar,
  slotRef,
  onToggleAdvanced,
  onToggleBrowserLossless,
  onToggleMode,
  onToggleFullscreen,
  onReload,
  onClose,
}: {
  title: string;
  advanced: boolean;
  canExpandChat: boolean;
  canToggleBrowserLossless: boolean;
  browserLossless: boolean;
  externalUrl: string | null | undefined;
  isMobile: boolean;
  fullscreen: boolean;
  mode: WorkspacePanelMode;
  // A pinned panel offers no pin, fullscreen or close buttons.
  pinned?: boolean;
  splitControl: ReactNode;
  // Shown in place of the title, such as the browser's address bar.
  toolbar?: ReactNode;
  // Receives the slot the showing tool may fill with its own bar (PanelHeaderSlotCtx);
  // while it holds anything, the plain title is hidden.
  slotRef?: (element: HTMLElement | null) => void;
  onToggleAdvanced: () => void;
  onToggleBrowserLossless: () => void;
  onToggleMode: () => void;
  onToggleFullscreen: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('nav.workspace');
  const tChat = useTranslations('aiChat');
  const tCommon = useTranslations('common');
  return (
    <div className={cn(WORKSPACE_PANEL_HEADER_CLASS, 'gap-1 px-3')}>
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
          title={`${t('browser')} PNG`}
          aria-label={`${t('browser')} PNG`}
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
      {splitControl}
      {!isMobile && !fullscreen && !pinned && (
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
      {!pinned && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={onToggleFullscreen}
            title={tCommon(fullscreen ? 'exitFullscreen' : 'fullscreen')}
            aria-pressed={fullscreen}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            title={tCommon('close')}
          >
            <X />
          </Button>
        </>
      )}
    </div>
  );
}
