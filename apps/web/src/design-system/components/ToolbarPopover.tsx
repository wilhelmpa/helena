'use client';

import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './Menu';
import {
  PAGE_CONTROL_ACTIVE_CLASS,
  PAGE_CONTROL_CLASS,
  usePageToolbarRoom,
} from '../layout/PageToolbar';

// A control of a page's toolbar that opens a panel under it (the display options, the fields
// of a view): the same 32 px control as every other one in the row, its icon and — while
// the row has room — its name, the panel in a popover. One implementation, so the controls
// of every page open, close and fold the same way.
//   labelWhen 'room': the name shows while the toolbar has room, the icon alone after that
//   'always': the name always (a form)   'never': the icon alone
export function ToolbarPopover({
  icon: Icon,
  label,
  labelWhen = 'room',
  active = false,
  contentClassName,
  align = 'end',
  children,
}: {
  icon: LucideIcon;
  label: string;
  labelWhen?: 'room' | 'always' | 'never';
  // Held highlighted while the panel is open, and while it holds a change (the fields differ
  // from their default).
  active?: boolean;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const room = usePageToolbarRoom();
  const named = labelWhen === 'always' || (labelWhen === 'room' && room.actions);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            PAGE_CONTROL_CLASS,
            (open || active) && PAGE_CONTROL_ACTIVE_CLASS,
            !named && 'ds-icon-only',
          )}
        >
          <Icon aria-hidden="true" />
          {named && <span>{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className={contentClassName}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
