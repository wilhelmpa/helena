'use client';

import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { resolveText } from '@helena/sdk/web';
import { useWorkspaceLayoutChoice } from '@/context/workspaceLayout';
import { useHotkeyLabel } from '@/context/useHotkeys';
import { byKey } from '@/utils/messageKey';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import WorkspaceLayoutPictogram from './WorkspaceLayoutPictogram';

// The layout menu in the header's tool group: a 32px button showing the current layout's
// picture, opening one row per layout (its picture and name). Layouts come from the
// layout registry (extensions/workspaceLayouts.ts), plugins' included. Not on a phone,
// where one thing shows at a time.
export default function WorkspaceLayoutMenu() {
  const t = useTranslations('nav.layout');
  const translate = byKey(useTranslations());
  const locale = useLocale();
  const choice = useWorkspaceLayoutChoice();
  const cycleKey = useHotkeyLabel('layout.cycle');
  if (!choice || !choice.available) return null;
  const current = choice.layouts.find((layout) => layout.id === choice.current);
  const name = (layout: (typeof choice.layouts)[number]) =>
    resolveText(layout.label, locale, (key) => translate(key));
  const label = current ? t('menuCurrent', { layout: name(current) }) : t('menu');
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className="hidden size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground md:flex"
            >
              {current ? <WorkspaceLayoutPictogram layout={current} icon /> : null}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {cycleKey ? t('menuHint', { layout: label, key: cycleKey }) : label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('menu')}</DropdownMenuLabel>
        {choice.layouts.map((layout) => {
          const active = layout.id === choice.current;
          return (
            <DropdownMenuItem
              key={layout.id}
              role="menuitemradio"
              aria-checked={active}
              onSelect={() => choice.setLayout(layout.id)}
              className={cn('gap-3 py-1.5', active && 'font-medium')}
            >
              <WorkspaceLayoutPictogram
                layout={layout}
                className={active ? 'text-foreground' : 'text-muted-foreground'}
              />
              <span className="min-w-0 flex-1 truncate">{name(layout)}</span>
              {active ? (
                <DropdownMenuShortcut>
                  <Check className="size-4" aria-hidden="true" />
                </DropdownMenuShortcut>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
