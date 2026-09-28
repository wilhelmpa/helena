'use client';

import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button, IconButton } from './Button';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './Menu';

export type ActionMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

// The "…" of a row or card (docs/ui-framework.md §Menüs). A menu with one entry is not a
// menu (owner, O36): that entry is shown as a secondary button with its label; no
// entries, nothing.
export function ActionMenu({
  label,
  items,
  size = 'small',
}: {
  // Accessible name of the "…" button ("Aktionen für VOL-4").
  label: string;
  items: ActionMenuItem[];
  size?: 'default' | 'small';
}) {
  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;
  if (visible.length === 1) {
    const item = visible[0]!;
    return (
      <Button
        variant={item.danger ? 'danger' : 'quiet'}
        size={size}
        icon={item.icon}
        disabled={item.disabled}
        onClick={item.onSelect}
      >
        {item.label}
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={label} size={size}>
          <MoreHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        {visible.map((item) => (
          <MenuItem
            key={item.id}
            disabled={item.disabled}
            variant={item.danger ? 'destructive' : 'default'}
            onSelect={item.onSelect}
          >
            {item.icon}
            {item.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

// A tooltip for an icon-only control: the label on hover and keyboard focus.
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
