'use client';

import { useTranslations } from 'next-intl';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/usePermissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { MruEntry } from '../hooks/useNoteBoardMru';
import { boardListIcon } from '../utils/visibility';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';

// One board tab in the notes header; the active one also carries the board menu.
// Who sees the board is changed on the canvas instead (NoteBoardAccessPicker).
export default function NoteBoardTab({
  tab,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  tab: MruEntry;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('notes');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const canEdit = can('note_boards', 'edit');
  const canDelete = can('note_boards', 'delete');
  const showMenu = active && (canEdit || canDelete);
  const Icon = boardListIcon(tab.visibility);

  return (
    <div className={cn(PAGE_CONTROL_CLASS, 'h-7 gap-0 px-0', active && PAGE_CONTROL_ACTIVE_CLASS)}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        className={cn('flex h-full items-center gap-1.5 ps-2', showMenu ? 'pe-1' : 'pe-2')}
      >
        <Icon className="!size-3.5" />
        <span className="max-w-40 truncate">{tab.name}</span>
      </button>

      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('boardOptions')}
            className="me-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <MoreHorizontal className="!size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {canEdit && (
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="size-4" /> {t('renameBoard')}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="size-4" /> {tCommon('delete')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
