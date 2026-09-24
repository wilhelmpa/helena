import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LayoutDashboard, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Dashboard } from '@/lib/api/endpoints/dashboards';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';

export default function DashboardTab({
  dashboard,
  active,
  canEdit,
  canDelete,
  onSelect,
  onRename,
  onDelete,
}: {
  dashboard: Dashboard;
  active: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('dashboards');
  const tCommon = useTranslations('common');
  const [menuOpen, setMenuOpen] = useState(false);
  // Reordering tabs is a dashboards edit; disable dragging without it.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dashboard.id,
    disabled: !canEdit,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  // The options menu holds rename (edit) and delete; hide it when neither is allowed.
  const showMenu = active && (canEdit || canDelete);
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        PAGE_CONTROL_CLASS,
        'h-7 gap-0 px-0',
        canEdit ? 'cursor-grab' : 'cursor-default',
        active && PAGE_CONTROL_ACTIVE_CLASS,
        isDragging && 'opacity-40',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        className={cn('flex h-full items-center gap-1.5 ps-2', showMenu ? 'pe-1' : 'pe-2')}
      >
        <LayoutDashboard className="!size-3.5" />
        <span className="max-w-48 truncate">{dashboard.name}</span>
      </button>
      {showMenu ? (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={t('options')}
              aria-label={t('options')}
              className="me-1 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground"
            >
              <MoreHorizontal className="!size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-40 p-1">
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRename();
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-accent"
              >
                <Pencil className="size-4" /> {t('rename')}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" /> {tCommon('delete')}
              </button>
            )}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
