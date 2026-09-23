import { useRouter } from 'next/navigation';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ViewFolder } from '@/lib/api/endpoints/views';
import { usePermissions } from '@/hooks/usePermissions';
import { useCreateView, useDeleteViewFolder, useUpdateViewFolder } from '@/services/views.service';
import { viewPath } from '@/utils/paths';
import { defaultViewSettings } from '@/utils/viewSettings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// The actions of one area in the sidebar: add a board to it, rename it, delete it.
// Deleting keeps its boards and tasks in the project without an area.
export default function SidebarAreaMenu({
  projectKey,
  area,
}: {
  projectKey: string;
  area: ViewFolder;
}) {
  const t = useTranslations('views');
  const router = useRouter();
  const { can } = usePermissions();
  const createView = useCreateView(projectKey);
  const updateArea = useUpdateViewFolder(projectKey);
  const deleteArea = useDeleteViewFolder(projectKey);
  const canCreate = can('views', 'create');
  const canEdit = can('views', 'edit');
  const canDelete = can('views', 'delete');

  if (!canCreate && !canEdit && !canDelete) return null;

  async function addBoard() {
    const name = window.prompt(t('boardNamePrompt'))?.trim();
    if (!name) return;
    const created = await createView.mutateAsync({
      input: {
        name,
        folderId: area.id,
        display: { layout: 'kanban', ...defaultViewSettings('kanban') },
      },
    });
    router.push(viewPath(projectKey, created.id));
  }

  function rename() {
    const name = window.prompt(t('folderNamePrompt'), area.name)?.trim();
    if (name && name !== area.name) updateArea.mutate({ id: area.id, name });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t('areaOptions')}
          className="absolute end-1 top-1 flex size-5 items-center justify-center rounded-md text-sidebar-foreground opacity-0 group-hover/area:opacity-100 hover:bg-sidebar-accent focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {canCreate && (
          <DropdownMenuItem onSelect={() => void addBoard()}>
            <Plus /> {t('newBoard')}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem onSelect={rename}>
            <Pencil /> {t('renameFolder')}
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              if (window.confirm(t('deleteFolderConfirm', { name: area.name }))) {
                deleteArea.mutate(area.id);
              }
            }}
          >
            <Trash2 /> {t('deleteFolder')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
