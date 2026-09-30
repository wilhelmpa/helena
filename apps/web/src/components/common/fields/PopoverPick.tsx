import { useState, type ReactNode } from 'react';
import { Check, Plus } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import ReadOnlyPill from './ReadOnlyPill';

export interface PickItem {
  key: string;
  // What cmdk filters the row against as the user types.
  search: string;
  icon: ReactNode;
  label: string;
  selected: boolean;
  // Shown after the label, before the checkmark — a badge saying why a row reads
  // the way it does.
  trailing?: ReactNode;
  // Listed but not selectable.
  disabled?: boolean;
  // Why the row reads the way it does, on hover.
  tooltip?: ReactNode;
  onSelect: () => void;
}

// A named set of PickItems rendered under a heading. An empty group is skipped so
// no bare heading shows.
export interface PickGroup {
  heading: string;
  items: PickItem[];
}

// Naming something that is not in the list yet and creating it right there: a row at the end
// that reads "Create “query”" while the search text matches no item exactly. `create` runs with
// the text; the list closes when it resolves.
export interface PickCreate {
  label: (query: string) => string;
  create: (query: string) => void | Promise<void>;
}

// A Pill trigger opening a searchable list of PickItems in a popover. Closes on
// select unless `closeOnSelect` is false (labels toggle and stay open). `items`
// renders as one flat group without a heading (the default). `groups` renders one
// headed group each, after the flat items — pass either or both.
export default function PopoverPick({
  trigger,
  inputPlaceholder,
  emptyText,
  items,
  groups,
  closeOnSelect = true,
  align = 'start',
  contentClassName,
  modal = false,
  readOnly = false,
  create,
  width,
  search = true,
  footer,
  onOpenChange,
}: {
  trigger: ReactNode;
  inputPlaceholder: string;
  emptyText?: string;
  items?: PickItem[];
  groups?: PickGroup[];
  closeOnSelect?: boolean;
  // Which trigger edge the list lines up with: 'end' for a trigger near the right
  // of the screen, so the list opens inward instead of off-screen.
  align?: 'start' | 'center' | 'end';
  // The list width (a Tailwind class), for a list whose labels need more room.
  contentClassName?: string;
  // 'wide' for a list with a second column (a count, a status) after the label.
  width?: 'default' | 'wide';
  // Set over a surface that swallows pointer events (the React Flow canvas), where
  // an outside click would otherwise not reach the popover and never dismiss it.
  modal?: boolean;
  // When true the pill is shown as-is with no popover — a read-only display of the
  // current value (public shared pages).
  readOnly?: boolean;
  // Offers to create what the search text names when no item is called that.
  create?: PickCreate;
  // A short list needs no search field.
  search?: boolean;
  // Under the list, outside it: where the value comes from and the way back.
  footer?: ReactNode;
  // Called when the list opens or closes.
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  if (readOnly) return <ReadOnlyPill>{trigger}</ReadOnlyPill>;
  const typed = query.trim();
  const named = [...(items ?? []), ...(groups ?? []).flatMap((group) => group.items)].some(
    (item) => item.label.trim().toLocaleLowerCase() === typed.toLocaleLowerCase(),
  );
  const showCreate = !!create && typed !== '' && !named;

  const renderItem = (it: PickItem) => {
    const row = (
      <CommandItem
        key={it.key}
        value={it.search}
        disabled={it.disabled}
        onSelect={() => {
          it.onSelect();
          if (closeOnSelect) setOpen(false);
        }}
      >
        {it.icon}
        <span className="flex-1 truncate">{it.label}</span>
        {it.trailing}
        {it.selected && <Check />}
      </CommandItem>
    );
    if (!it.tooltip) return row;
    // A disabled row takes no pointer events, so the wrapper is what the tooltip
    // listens on.
    return (
      <Tooltip key={it.key}>
        <TooltipTrigger asChild>
          <div>{row}</div>
        </TooltipTrigger>
        <TooltipContent>{it.tooltip}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <Popover
      modal={modal}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className={cn('p-0', width === 'wide' ? 'w-72' : 'w-56', contentClassName)}
        align={align}
      >
        <Command>
          {search && (
            <CommandInput placeholder={inputPlaceholder} value={query} onValueChange={setQuery} />
          )}
          <CommandList>
            {emptyText && !showCreate && <CommandEmpty>{emptyText}</CommandEmpty>}
            {items && items.length > 0 && <CommandGroup>{items.map(renderItem)}</CommandGroup>}
            {groups?.map(
              (group) =>
                group.items.length > 0 && (
                  <CommandGroup key={group.heading} heading={group.heading}>
                    {group.items.map(renderItem)}
                  </CommandGroup>
                ),
            )}
            {showCreate && (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`__create ${typed}`}
                  onSelect={() => {
                    void Promise.resolve(create.create(typed)).then(() => setOpen(false));
                  }}
                >
                  <Plus />
                  <span className="flex-1 truncate">{create.label(typed)}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        {footer}
      </PopoverContent>
    </Popover>
  );
}
