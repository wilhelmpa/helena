import { useDraggable } from '@dnd-kit/core';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { Issue } from '@/lib/api/endpoints/issues';
import { useIsPhone } from '@/hooks/useIsPhone';
import { usePermissions } from '@/hooks/usePermissions';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import IssueContextMenu from '@/features/issue/components/actions/IssueContextMenu';
import type { Maps } from '@/utils/project';
import type { PropertyKey } from '@/utils/viewSettings';
import { CalendarChipFace } from './CalendarChipFace';

// A draggable chip inside a day cell. A click (no drag) opens the issue; a drag
// moves it to another day or the unscheduled panel.
export function CalendarDayChip({
  project,
  issue,
  color,
  properties,
  maps,
  onOpen,
}: {
  project: ProjectDetail;
  issue: Issue;
  color: string;
  properties: PropertyKey[];
  maps: Maps;
  onOpen: (id: number) => void;
}) {
  // Drag is disabled on phones so a touch scrolls instead of picking up the issue
  // (see the `sm:touch-none` below), and without work_items edit (rescheduling a
  // issue is an issue edit).
  const { can } = usePermissions();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    disabled: useIsPhone() || !can('work_items', 'edit'),
  });
  return (
    <Tooltip>
      <IssueContextMenu project={project} issue={issue}>
        <TooltipTrigger asChild>
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onOpen(issue.id);
            }}
            className={cn(
              'flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs transition-colors hover:bg-accent sm:touch-none',
              isDragging && 'opacity-40',
            )}
          >
            <CalendarChipFace issue={issue} color={color} properties={properties} maps={maps} />
          </div>
        </TooltipTrigger>
      </IssueContextMenu>
      <TooltipContent>{`${issue.identifier} ${issue.title}`}</TooltipContent>
    </Tooltip>
  );
}
