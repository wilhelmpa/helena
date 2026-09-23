import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProjectGroup } from '@/utils/projectTree';
import { useDeleteProjectGroup, useRenameProjectGroup } from '@/services/projectGroups.service';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuAction } from '@/components/ui/sidebar';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import NameDialog from '@/components/common/overlay/NameDialog';

// Renaming or deleting a project group. Deleting keeps its projects, without a group.
export default function ProjectGroupMenu({ group }: { group: ProjectGroup }) {
  const t = useTranslations('nav.projectGroups');
  const tCommon = useTranslations('common');
  const rename = useRenameProjectGroup();
  const remove = useDeleteProjectGroup();
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover title={t('groupOptions')}>
            <MoreHorizontal />
            <span className="sr-only">{t('groupOptions')}</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onSelect={() => setDialog('rename')}>
            <Pencil /> {t('renameGroup')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
            <Trash2 /> {t('deleteGroup')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === 'rename' && (
        <NameDialog
          title={t('renameGroup')}
          label={t('groupName')}
          initialName={group.name}
          submitLabel={tCommon('save')}
          onSubmit={(name) => rename.mutateAsync({ teamId: group.teamId, groupId: group.id, name })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={t('deleteGroup')}
          confirmLabel={t('deleteGroup')}
          onConfirm={async () => {
            await remove.mutateAsync({ teamId: group.teamId, groupId: group.id });
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        >
          <p className="text-sm text-muted-foreground">
            {t('deleteGroupConfirm', { name: group.name })}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
