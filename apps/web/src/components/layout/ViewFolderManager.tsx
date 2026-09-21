import { ArrowDown, ArrowUp, FolderCog, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ViewFolder } from '@/lib/api/endpoints/views';
import {
  useCreateViewFolder,
  useDeleteViewFolder,
  useReorderViewFolders,
  useUpdateViewFolder,
} from '@/services/views.service';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function ViewFolderManager({
  projectKey,
  folders,
}: {
  projectKey: string;
  folders: ViewFolder[];
}) {
  const t = useTranslations('views');
  const createFolder = useCreateViewFolder(projectKey);
  const updateFolder = useUpdateViewFolder(projectKey);
  const deleteFolder = useDeleteViewFolder(projectKey);
  const reorderFolders = useReorderViewFolders(projectKey);

  function askName(current = ''): string | null {
    const name = window.prompt(t('folderNamePrompt'), current)?.trim();
    return name || null;
  }

  function move(id: number, offset: number) {
    const ordered = [...folders].sort((a, b) => a.position - b.position || a.id - b.id);
    const index = ordered.findIndex((folder) => folder.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    reorderFolders.mutate(ordered.map((folder) => folder.id));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t('manageFolders')}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FolderCog className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem
          onSelect={() => {
            const name = askName();
            if (name) createFolder.mutate(name);
          }}
        >
          <FolderPlus /> {t('newFolder')}
        </DropdownMenuItem>
        {folders.length > 0 && <DropdownMenuSeparator />}
        {folders.map((folder, index) => (
          <div key={folder.id}>
            <DropdownMenuLabel className="truncate">{folder.name}</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => {
                const name = askName(folder.name);
                if (name) updateFolder.mutate({ id: folder.id, name });
              }}
            >
              <Pencil /> {t('renameFolder')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onSelect={() => move(folder.id, -1)}>
              <ArrowUp /> {t('moveFolderUp')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === folders.length - 1}
              onSelect={() => move(folder.id, 1)}
            >
              <ArrowDown /> {t('moveFolderDown')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                if (window.confirm(t('deleteFolderConfirm', { name: folder.name }))) {
                  deleteFolder.mutate(folder.id);
                }
              }}
            >
              <Trash2 /> {t('deleteFolder')}
            </DropdownMenuItem>
            {index < folders.length - 1 && <DropdownMenuSeparator />}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
