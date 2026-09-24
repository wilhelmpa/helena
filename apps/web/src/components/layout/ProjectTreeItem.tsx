import { SquareKanban } from 'lucide-react';
import type { Project } from '@/lib/api/endpoints/projects';
import type { ProjectGroup } from '@/utils/projectTree';
import { PROJECT_DRAG_TYPE } from '@/utils/projectTree';
import { cn } from '@/lib/utils';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import ProjectItemMenu from '@/components/layout/ProjectItemMenu';

// One project in the sidebar tree. A team manager drags it onto a group or picks the
// group from its menu.
export default function ProjectTreeItem({
  project,
  active,
  groups,
  onSelect,
  onDragChange,
}: {
  project: Project;
  active: boolean;
  groups: ProjectGroup[];
  onSelect: (key: string) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const manage = project.teamManager === true;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={`${project.name} (${project.key})`}
        onClick={() => onSelect(project.key)}
        draggable={manage}
        onDragStart={(event) => {
          event.dataTransfer.setData(
            PROJECT_DRAG_TYPE,
            JSON.stringify({ id: project.id, teamId: project.teamId }),
          );
          event.dataTransfer.effectAllowed = 'move';
          onDragChange(true);
        }}
        onDragEnd={() => onDragChange(false)}
      >
        <SquareKanban />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <span
          className={cn(
            'shrink-0 font-mono text-xs text-muted-foreground',
            // Where the row's menu is always shown (a phone, a touch screen) it takes this
            // place; elsewhere it only replaces it while the row is hovered.
            manage && 'group-hover/menu-item:invisible max-md:hidden [@media(hover:none)]:hidden',
          )}
        >
          {project.key}
        </span>
      </SidebarMenuButton>
      {manage && <ProjectItemMenu project={project} groups={groups} />}
    </SidebarMenuItem>
  );
}
