'use client';

import { ExternalLink, ImageIcon, RefreshCw, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function WorkspacePanelHeader({
  title,
  advanced,
  canExpandChat,
  canToggleBrowserLossless,
  browserLossless,
  externalUrl,
  picker,
  toolbar,
  slotRef,
  onToggleAdvanced,
  onToggleBrowserLossless,
  onReload,
}: {
  title: string;
  advanced: boolean;
  canExpandChat: boolean;
  canToggleBrowserLossless: boolean;
  browserLossless: boolean;
  externalUrl: string | null | undefined;
  // Picks the tool this area shows (WorkspaceToolPicker).
  picker: ReactNode;
  // Shown in place of the title, such as the browser's address bar.
  toolbar?: ReactNode;
  // Receives the slot the showing tool may fill with its own bar (PanelHeaderSlotCtx);
  // while it holds anything, the plain title is hidden.
  slotRef?: (element: HTMLElement | null) => void;
  onToggleAdvanced: () => void;
  onToggleBrowserLossless: () => void;
  onReload: () => void;
}) {
  const t = useTranslations('nav.workspace');
  const tCommon = useTranslations('common');
  return (
    <div className="ds-panel-subbar">
      {picker}
      {toolbar ? (
        <>
          {toolbar}
          <div
            ref={slotRef}
            data-slot="panel-control-slot"
            className="flex shrink-0 items-center empty:hidden"
          />
        </>
      ) : (
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
    </div>
  );
}
