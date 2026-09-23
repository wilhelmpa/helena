import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ProjectGroup } from '@/utils/projectTree';
import { draggedProject, isProjectDrag } from '@/utils/projectTree';
import { usePersistedBoolean } from '@/hooks/usePersistedBoolean';
import { useMoveProjectToGroup } from '@/services/projectGroups.service';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import ProjectGroupMenu from '@/components/layout/ProjectGroupMenu';
import ProjectTreeItem from '@/components/layout/ProjectTreeItem';

// One group of the sidebar's project tree, folding out to its projects. A project of
// the same team dropped on the header moves into the group.
export default function ProjectTreeGroup({
  group,
  groups,
  currentProjectKey,
  onSelectProject,
  onDragChange,
}: {
  group: ProjectGroup;
  groups: ProjectGroup[];
  currentProjectKey: string | null;
  onSelectProject: (key: string) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const [open, setOpen] = usePersistedBoolean(`sidebar:project-group:${group.id}`, true);
  const [over, setOver] = useState(false);
  const move = useMoveProjectToGroup();
  const manage = group.projects.some((project) => project.teamManager);
  const hasActive = group.projects.some((project) => project.key === currentProjectKey);

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/project-group">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={!open && hasActive}
            className={cn(over && 'ring-2 ring-sidebar-ring')}
            onDragOver={(event) => {
              if (!manage || !isProjectDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              setOver(false);
              onDragChange(false);
              const project = draggedProject(event);
              if (project?.teamId === group.teamId) {
                event.preventDefault();
                move.mutate({ teamId: group.teamId, projectId: project.id, groupId: group.id });
              }
            }}
          >
            <ChevronRight className="transition-transform group-data-[state=open]/project-group:rotate-90" />
            <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
            <span
              className={cn(
                'shrink-0 text-[10px] text-muted-foreground tabular-nums',
                manage && 'group-hover/menu-item:invisible',
              )}
            >
              {group.projects.length}
            </span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        {manage && <ProjectGroupMenu group={group} />}
        <CollapsibleContent>
          <ul className="ms-3.5 flex flex-col gap-1 border-s ps-1.5 pt-1">
            {group.projects.map((project) => (
              <ProjectTreeItem
                key={project.key}
                project={project}
                active={project.key === currentProjectKey}
                groups={groups}
                onSelect={onSelectProject}
                onDragChange={onDragChange}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
