import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ViewFolder } from '@/lib/api/endpoints/views';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { useCreateView, useDeleteViewFolder, useUpdateViewFolder } from '@/services/views.service';
import { filesPath, viewPath } from '@/utils/paths';
import { defaultViewSettings } from '@/utils/viewSettings';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import NameDialog from '@/components/common/overlay/NameDialog';
import AreaDialog from '@/components/layout/AreaDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// The actions of one area in the sidebar: add a board to it, open its folder on the
// Files page, rename it, delete it. Deleting keeps its boards and tasks in the project
// without an area.
export default function SidebarAreaMenu({
  projectKey,
  area,
  areas,
}: {
  projectKey: string;
  area: ViewFolder;
  areas: ViewFolder[];
}) {
  const t = useTranslations('views');
  const tCommon = useTranslations('common');
  const [dialog, setDialog] = useState<'board' | 'rename' | 'delete' | null>(null);
  const router = useRouter();
  const { can } = usePermissions();
  const features = useProjectFeatures();
  const createView = useCreateView(projectKey);
  const updateArea = useUpdateViewFolder(projectKey);
  const deleteArea = useDeleteViewFolder(projectKey);
  const canCreate = can('views', 'create');
  const canEdit = can('views', 'edit');
  const canDelete = can('views', 'delete');
  const canOpenFolder = features.documents && can('documents', 'read');

  if (!canCreate && !canEdit && !canDelete && !canOpenFolder) return null;

  async function addBoard(name: string) {
    const created = await createView.mutateAsync({
      input: {
        name,
        folderId: area.id,
        display: { layout: 'kanban', ...defaultViewSettings('kanban') },
      },
    });
    router.push(viewPath(projectKey, created.id));
  }

  return (
    <>
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
            <DropdownMenuItem onSelect={() => setDialog('board')}>
              <Plus /> {t('newBoard')}
            </DropdownMenuItem>
          )}
          {canOpenFolder && (
            <DropdownMenuItem asChild>
              <Link href={filesPath(projectKey, area.folder)}>
                <FolderOpen /> {t('openFolder')}
              </Link>
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onSelect={() => setDialog('rename')}>
              <Pencil /> {t('renameFolder')}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
              <Trash2 /> {t('deleteFolder')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === 'board' && (
        <NameDialog
          title={t('newBoard')}
          description={t('newBoardDescription', { name: area.name })}
          label={t('boardNamePrompt')}
          submitLabel={t('create')}
          onSubmit={addBoard}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'rename' && (
        <AreaDialog
          title={t('renameFolder')}
          submitLabel={tCommon('save')}
          area={area}
          areas={areas}
          onSubmit={(input) => updateArea.mutateAsync({ id: area.id, ...input })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={t('deleteFolder')}
          confirmLabel={t('deleteFolder')}
          onConfirm={async () => {
            await deleteArea.mutateAsync(area.id);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        >
          <p className="text-sm text-muted-foreground">
            {t('deleteFolderConfirm', { name: area.name })}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
