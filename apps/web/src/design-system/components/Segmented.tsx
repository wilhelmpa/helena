import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { PAGE_CONTROL_CLASS, usePageToolbarRoom } from '../layout/PageToolbar';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './Menu';

// A segment control (docs/design-system.md §9): the track on surface-2, the chosen
// segment lifted onto surface-1. For a page's layout switch (Board · Liste · Tabelle ·
// Kalender · Zeitstrahl), the org chart's Baum/Kreis and the panel's tabs. Never a second
// navigation: its options are views of the same page.
export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
};

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  // In a page's toolbar that has run out of room the segments give way like the tabs: one
  // choice showing the current view (owner 30.09., O104: the bar folds, it never scrolls).
  const room = usePageToolbarRoom();
  if (!room.tabs) {
    const current = options.find((option) => option.value === value) ?? options[0];
    return (
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={current?.title}
            className={`${PAGE_CONTROL_CLASS} min-w-0 text-foreground ${className ?? ''}`}
          >
            {current?.icon}
            <span className="truncate">{current?.label}</span>
            <ChevronDown className="!size-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="min-w-40">
          {options.map((option) => (
            <MenuItem key={option.value} onSelect={() => onChange(option.value)}>
              {option.icon}
              <span className="flex-1">{option.label}</span>
              {option.value === value ? <Check className="text-muted-foreground" /> : null}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    );
  }
  return (
    <div role="tablist" aria-label={label} className={`ds-segmented ${className ?? ''}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-label={typeof option.label === 'string' ? option.label : undefined}
          aria-selected={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
