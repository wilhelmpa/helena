'use client';

import { ChevronDown, ListFilter, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PAGE_CONTROL_ACTIVE_CLASS,
  PAGE_CONTROL_CLASS,
  usePageToolbarRoom,
  type PageSelectOption,
} from '@/components/layout/PageToolbar';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type PageFilter = {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string;
  // The value that means "no filter"; any other value counts as a filter that is on.
  defaultValue: string;
  options: PageSelectOption<string>[];
  onChange: (value: string) => void;
};

// Several filters of a page behind one "Filter" control in the header row, so a page
// with four of them keeps its row short and every label readable: one submenu per
// filter naming its current choice, and "reset" once any is on. The control shows how
// many filters are on and takes the selected fill then, also when the row has folded
// it to its icon. On a phone, where a submenu has no room beside the menu, the choices
// are listed in the menu itself under each filter's name.
export function PageFilterMenu({
  label,
  resetLabel,
  filters,
  onReset,
}: {
  label: string;
  resetLabel: string;
  filters: PageFilter[];
  onReset: () => void;
}) {
  const room = usePageToolbarRoom();
  const phone = useMediaQuery('(max-width: 639px)');
  const active = filters.filter((filter) => filter.value !== filter.defaultValue).length;
  const name = active > 0 ? `${label} · ${active}` : label;
  const trigger = (
    <button
      type="button"
      aria-label={name}
      className={cn(
        PAGE_CONTROL_CLASS,
        !room.actions && 'w-8 justify-center px-0',
        active > 0 && PAGE_CONTROL_ACTIVE_CLASS,
      )}
    >
      <ListFilter aria-hidden="true" />
      {room.actions ? (
        <>
          <span>{label}</span>
          {active > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">{active}</span>
          ) : null}
          <ChevronDown className="!size-3.5 text-muted-foreground" aria-hidden="true" />
        </>
      ) : null}
    </button>
  );
  return (
    <DropdownMenu>
      {room.actions ? (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{name}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent align="end" className="max-h-[70svh] min-w-60">
        {filters.map((filter) => {
          const current = filter.options.find((option) => option.value === filter.value);
          const on = filter.value !== filter.defaultValue;
          const choices = filter.options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={option.value === filter.value}
              onCheckedChange={() => filter.onChange(option.value)}
            >
              {option.icon ? <option.icon /> : null}
              <span className="truncate">{option.label}</span>
            </DropdownMenuCheckboxItem>
          ));
          if (phone) {
            return (
              <div key={filter.id} role="group" aria-label={filter.label}>
                <DropdownMenuLabel className="flex items-center gap-1.5 [&>svg]:size-3.5">
                  <filter.icon aria-hidden="true" />
                  {filter.label}
                </DropdownMenuLabel>
                {choices}
              </div>
            );
          }
          return (
            <DropdownMenuSub key={filter.id}>
              <DropdownMenuSubTrigger>
                <filter.icon />
                <span className="shrink-0">{filter.label}</span>
                <span
                  className={cn(
                    'ms-auto min-w-0 truncate ps-3 text-xs',
                    on ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {current?.label}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 min-w-48">
                {choices}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
        {active > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReset}>
              <X />
              {resetLabel}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
