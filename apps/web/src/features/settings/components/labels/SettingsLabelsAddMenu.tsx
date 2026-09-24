import { useRef } from 'react';
import { FolderPlus, Plus, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function SettingsLabelsAddMenu({
  disabled,
  onAddLabel,
  onAddGroup,
}: {
  disabled: boolean;
  onAddLabel: () => void;
  onAddGroup: () => void;
}) {
  const t = useTranslations('settings.labels');
  // The picked entry runs once the menu has closed: the menu hands focus back to its
  // trigger (disabled while a form is open) when it closes, which pulled the focus out
  // of the new name field. Opening the form after that leaves the field focused.
  const picked = useRef<(() => void) | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-full gap-1.5 border-dashed text-muted-foreground hover:text-foreground"
          disabled={disabled}
        >
          <Plus className="size-3.5" />
          {t('add')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-40"
        onCloseAutoFocus={(event) => {
          const run = picked.current;
          picked.current = null;
          if (!run) return;
          event.preventDefault();
          run();
        }}
      >
        <DropdownMenuItem onClick={() => (picked.current = onAddLabel)}>
          <Tag className="size-4" />
          {t('newLabel')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => (picked.current = onAddGroup)}>
          <FolderPlus className="size-4" />
          {t('newGroup')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
