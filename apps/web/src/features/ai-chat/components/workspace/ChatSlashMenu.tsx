'use client';

import { useTranslations } from 'next-intl';
import { Slash, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
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
    <div
      role="listbox"
      aria-label={t('composer.slashMenu')}
      className="absolute bottom-full z-10 mb-2 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
    >
      {items.map((item, index) => {
        const key =
          item.kind === 'prompt' ? `prompt-${item.prompt.id}` : `command-${item.command.name}`;
        const label = item.kind === 'prompt' ? item.prompt.title : `/${item.command.name}`;
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
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm',
              index === highlight ? 'bg-accent' : 'hover:bg-accent/60',
            )}
          >
            {item.kind === 'prompt' ? (
              <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Slash className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span dir="auto" className="min-w-0 flex-1 truncate">
              {label}
            </span>
            {meta && (
              <span dir="ltr" className="shrink-0 text-xs text-muted-foreground">
                {meta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
