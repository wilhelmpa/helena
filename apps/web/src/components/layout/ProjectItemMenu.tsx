import { useState } from 'react';
import { FolderPlus, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import type { ProjectGroup } from '@/utils/projectTree';
import { useCreateProjectGroup, useMoveProjectToGroup } from '@/services/projectGroups.service';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuAction } from '@/components/ui/sidebar';
import NameDialog from '@/components/common/overlay/NameDialog';

// The group of one project: one of its team's groups, none, or a new one.
export default function ProjectItemMenu({
  project,
  groups,
}: {
  project: Project;
  groups: ProjectGroup[];
}) {
  const t = useTranslations('nav.projectGroups');
  const move = useMoveProjectToGroup();
  const create = useCreateProjectGroup();
  const [creating, setCreating] = useState(false);
  const moveTo = (groupId: number | null) =>
    move.mutate({ teamId: project.teamId, projectId: project.id, groupId });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover title={t('projectOptions')}>
            <MoreHorizontal />
            <span className="sr-only">{t('projectOptions')}</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>{t('group')}</DropdownMenuLabel>
          {groups
            .filter((group) => group.teamId === project.teamId)
            .map((group) => (
              <DropdownMenuCheckboxItem
                key={group.id}
                checked={project.departmentId === group.id}
                onSelect={() => moveTo(group.id)}
              >
                {group.name}
              </DropdownMenuCheckboxItem>
            ))}
          <DropdownMenuCheckboxItem
            checked={project.departmentId == null}
            onSelect={() => moveTo(null)}
          >
            {t('noGroup')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <FolderPlus /> {t('newGroup')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {creating && (
        <NameDialog
          title={t('newGroupTitle')}
          description={t('newGroupDescription')}
          label={t('groupName')}
          submitLabel={t('create')}
          onSubmit={(name) =>
            create.mutateAsync({ teamId: project.teamId, projectId: project.id, name })
          }
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
