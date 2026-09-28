'use client';

import { useTranslations } from 'next-intl';
import { Slash, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { SlashItem } from '../../utils/chatCommands';

// The `/` menu: the member's saved prompts and the Hermes slash commands, best match
// first, filtered and highlighted from the parent (see ChatComposer) so the same
// keydown handler that drives the textarea also drives Up/Down/Enter here — a second,
// independent keyboard listener would only race it.
export default function ChatSlashMenu({
  items,
  highlight,
  onHighlight,
  onSelect,
}: {
  items: SlashItem[];
  highlight: number;
  onHighlight: (index: number) => void;
  onSelect: (item: SlashItem) => void;
}) {
  const t = useTranslations('chatWorkspace');

  return (
    <Popover open>
      <PopoverAnchor asChild>
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px" />
      </PopoverAnchor>
      <PopoverContent
        role="listbox"
        aria-label={t('composer.slashMenu')}
        side="top"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="max-h-72 w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-16px)] scrollbar-thin overflow-y-auto rounded-md p-1"
      >
        {items.map((item, index) => {
          const key =
            item.kind === 'prompt' ? `prompt-${item.prompt.id}` : `command-${item.command.name}`;
          const label = item.kind === 'prompt' ? item.prompt.title : `/${item.command.name}`;
          const description =
            item.kind === 'command' && item.command.action
              ? t(`commands.${item.command.action}`)
              : undefined;
          const meta =
            item.kind === 'prompt'
              ? `/${item.prompt.command}`
              : item.command.args
                ? `/${item.command.name} ${item.command.args}`
                : item.command.refusal
                  ? t('composer.refusedCommand')
                  : undefined;
          return (
            <button
              key={key}
              type="button"
              role="option"
              aria-selected={index === highlight}
              onMouseEnter={() => onHighlight(index)}
              onClick={() => onSelect(item)}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm',
                index === highlight ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              {item.kind === 'prompt' ? (
                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Slash className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                dir="auto"
                className={item.kind === 'command' ? 'shrink-0' : 'min-w-0 truncate'}
              >
                {label}
              </span>
              <span dir="auto" className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {description}
              </span>
              {meta && (
                <span dir="ltr" className="shrink-0 text-xs text-muted-foreground">
                  {meta}
                </span>
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
