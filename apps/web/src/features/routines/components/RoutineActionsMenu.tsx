import { MoreHorizontal, Pencil, RotateCw, Trash2, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface RoutineActions {
  canEdit: boolean;
  canDelete: boolean;
  running: boolean;
  onToggle: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function RoutineActionsMenu({ actions }: { actions: RoutineActions }) {
  const t = useTranslations('routines');
  if (!actions.canEdit && !actions.canDelete) return null;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('moreActions')}
              className="size-11 text-muted-foreground hover:text-foreground sm:size-8"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('moreActions')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {actions.canEdit && (
          <DropdownMenuItem
            className="min-h-11 sm:min-h-8"
            disabled={actions.running}
            onSelect={actions.onRun}
          >
            {actions.running ? <RotateCw className="animate-spin" /> : <Zap />}
            {t('runNow')}
          </DropdownMenuItem>
        )}
        {actions.canEdit && (
          <DropdownMenuItem className="min-h-11 sm:min-h-8" onSelect={actions.onEdit}>
            <Pencil />
            {t('edit')}
          </DropdownMenuItem>
        )}
        {actions.canEdit && actions.canDelete && <DropdownMenuSeparator />}
        {actions.canDelete && (
          <DropdownMenuItem
            className="min-h-11 sm:min-h-8"
            variant="destructive"
            onSelect={actions.onDelete}
          >
            <Trash2 />
            {t('delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
