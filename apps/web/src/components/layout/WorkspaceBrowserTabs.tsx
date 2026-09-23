'use client';

import { Layers, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BrowserTab } from '@/utils/browserControl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// The browser's tabs: bring one to the front, close one, or open a new one.
export default function WorkspaceBrowserTabs({
  tabs,
  onActivate,
  onClose,
  onNew,
}: {
  tabs: BrowserTab[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
          title={t('tabs')}
          aria-label={t('tabs')}
        >
          <Layers />
          <span className="text-xs tabular-nums">{tabs.length}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {tabs.map((tab) => (
          <DropdownMenuItem
            key={tab.id}
            onSelect={() => onActivate(tab.id)}
            className="gap-2"
            aria-current={tab.active}
          >
            <span className={`min-w-0 flex-1 truncate ${tab.active ? 'font-medium' : ''}`} dir="auto">
              {tab.title}
            </span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('closeTab')}
              title={t('closeTab')}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <X className="size-3.5" />
            </button>
          </DropdownMenuItem>
        ))}
        {tabs.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={onNew} className="gap-2">
          <Plus />
          {t('newTab')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
