import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { ChevronDownIcon } from 'lucide-react';
import { CommandItem, CommandList } from '@/components/ui/command';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

export interface InputSuggestion {
  value: string;
  label: string;
  description?: ReactNode;
}

interface SuggestionsInputProps extends Omit<
  ComponentProps<typeof InputGroupInput>,
  'value' | 'onChange'
> {
  value: string;
  suggestions: InputSuggestion[];
  onValueChange: (value: string) => void;
  triggerLabel?: string;
}

// A text field that suggests values as they are typed (a schedule, a time zone), on the
// app's combobox building blocks: cmdk gives the field its combobox role, the active
// option and the arrow keys, Radix's Popover holds the list. The typed text is the value;
// a suggestion only replaces it when it is chosen.
export function RoutineSuggestionsInput({
  value,
  suggestions,
  onValueChange,
  triggerLabel,
  ...inputProps
}: SuggestionsInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const query = value.trim().toLowerCase();
  const hasExactMatch = suggestions.some((suggestion) => suggestion.value.toLowerCase() === query);
  const matches =
    showAll || hasExactMatch
      ? suggestions
      : suggestions.filter((suggestion) => matchesQuery(suggestion, query));
  const isOpen = open && matches.length > 0;

  function close() {
    setOpen(false);
    setShowAll(false);
  }

  function choose(suggestion: InputSuggestion) {
    onValueChange(suggestion.value);
    close();
  }

  return (
    <CommandPrimitive shouldFilter={false} loop className="contents">
      <Popover open={isOpen} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <PopoverAnchor asChild>
          <InputGroup aria-invalid={inputProps['aria-invalid']}>
            <CommandPrimitive.Input
              asChild
              value={value}
              onValueChange={(next) => {
                onValueChange(next);
                setShowAll(false);
                setOpen(true);
              }}
            >
              <InputGroupInput
                {...inputProps}
                ref={inputRef}
                // The field's own label names it, not cmdk's hidden one.
                aria-labelledby={inputProps['aria-labelledby']}
                aria-expanded={isOpen}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' && !isOpen) setOpen(true);
                  // With no list open, Enter submits the form rather than choosing.
                  if (event.key === 'Enter' && !isOpen) event.stopPropagation();
                  if (event.key === 'Escape') close();
                }}
              />
            </CommandPrimitive.Input>
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                aria-label={triggerLabel}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                onClick={() => {
                  if (isOpen) return close();
                  setShowAll(true);
                  setOpen(true);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <ChevronDownIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            // The input and its trigger live in the anchor, outside the popup. Keep the
            // popover open when they are clicked or focused; they manage open state.
            const target = event.detail.originalEvent.target as Element | null;
            if (
              target?.closest('[data-slot="input-group"]') ===
              inputRef.current?.closest('[data-slot="input-group"]')
            ) {
              event.preventDefault();
            }
          }}
        >
          <CommandList className="max-h-72">
            {matches.map((suggestion) => (
              <CommandItem
                key={suggestion.value}
                value={suggestion.value}
                onMouseDown={(event) => event.preventDefault()}
                onSelect={() => choose(suggestion)}
                className="justify-between gap-4"
              >
                <span>{suggestion.label}</span>
                {suggestion.description && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {suggestion.description}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </PopoverContent>
      </Popover>
    </CommandPrimitive>
  );
}

function matchesQuery(suggestion: InputSuggestion, query: string) {
  return (
    suggestion.label.toLowerCase().includes(query) ||
    suggestion.value.toLowerCase().includes(query) ||
    (typeof suggestion.description === 'string' &&
      suggestion.description.toLowerCase().includes(query))
  );
}
