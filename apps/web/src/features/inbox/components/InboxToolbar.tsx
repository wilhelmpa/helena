'use client';

import type { ReactNode } from 'react';
import { Ellipsis, Eye, ListFilter } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NotificationFilters, NotificationType } from '@/lib/api/endpoints/notifications';
import { cn } from '@/lib/utils';
import {
  PAGE_CONTROL_ACTIVE_CLASS,
  PAGE_CONTROL_CLASS,
  PageToolbar,
  PageToolbarSpacer,
  usePageToolbarRoom,
} from '@/components/layout/PageToolbar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const TYPES: NotificationType[] = ['assigned', 'commented', 'state_changed'];

// The notifications' controls in the page's header row (PageToolbar), after the page's
// tabs (`leading`): filters for reading notifications. Owner actions live in /inbox.
export default function InboxToolbar({
  leading,
  filters,
  onFiltersChange,
  onMarkAllRead,
  onDeleteRead,
  onDeleteReadCompleted,
}: {
  leading?: ReactNode;
  filters: NotificationFilters;
  onFiltersChange: (next: NotificationFilters) => void;
  onMarkAllRead: () => void;
  onDeleteRead: () => void;
  onDeleteReadCompleted: () => void;
}) {
  const t = useTranslations('inbox');
  const selectedTypes = filters.types ?? [];

  const toggleType = (type: NotificationType) => {
    const next = selectedTypes.includes(type)
      ? selectedTypes.filter((t) => t !== type)
      : [...selectedTypes, type];
    onFiltersChange({ ...filters, types: next.length ? next : undefined });
  };

  return (
    <PageToolbar>
      {leading}
      <PageToolbarSpacer />
      <ToolbarMenu icon={ListFilter} label={t('filter')} count={selectedTypes.length}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('notificationType')}
        </DropdownMenuLabel>
        {TYPES.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={selectedTypes.includes(type)}
            onCheckedChange={() => toggleType(type)}
            onSelect={(e) => e.preventDefault()}
          >
            {t(`types.${type}`)}
          </DropdownMenuCheckboxItem>
        ))}
      </ToolbarMenu>
      <ToolbarMenu
        icon={Eye}
        label={t('display')}
        count={(filters.includeRead === false ? 1 : 0) + (filters.includeSnoozed === true ? 1 : 0)}
      >
        <DropdownMenuCheckboxItem
          checked={filters.includeRead !== false}
          onCheckedChange={(v) => onFiltersChange({ ...filters, includeRead: v })}
          onSelect={(e) => e.preventDefault()}
        >
          {t('showRead')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={filters.includeSnoozed === true}
          onCheckedChange={(v) => onFiltersChange({ ...filters, includeSnoozed: v })}
          onSelect={(e) => e.preventDefault()}
        >
          {t('showSnoozed')}
        </DropdownMenuCheckboxItem>
      </ToolbarMenu>
      <ToolbarMenu icon={Ellipsis} label={t('title')} count={0}>
        <DropdownMenuItem onSelect={onMarkAllRead}>{t('markAllRead')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDeleteRead}>{t('deleteAllRead')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDeleteReadCompleted}>
          {t('deleteAllReadCompleted')}
        </DropdownMenuItem>
      </ToolbarMenu>
    </PageToolbar>
  );
}

// A 32px header control opening a menu of switches; drawn active and counted while
// any of them differs from the default.
function ToolbarMenu({
  icon: Icon,
  label,
  count,
  children,
}: {
  icon: typeof ListFilter;
  label: string;
  count: number;
  children: ReactNode;
}) {
  const room = usePageToolbarRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            PAGE_CONTROL_CLASS,
            count > 0 && PAGE_CONTROL_ACTIVE_CLASS,
            !room.actions && count === 0 && 'w-8 justify-center px-0',
          )}
        >
          <Icon aria-hidden="true" />
          {room.actions ? <span>{label}</span> : null}
          {count > 0 ? (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
