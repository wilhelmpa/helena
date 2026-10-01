import { useDraggable } from '@dnd-kit/core';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { Issue } from '@/lib/api/endpoints/issues';
import { useIsPhone } from '@/hooks/useIsPhone';
import { usePermissions } from '@/hooks/usePermissions';
import { cn } from '@/lib/utils';
import { Card } from '@/design-system';
import IssueContextMenu from '@/features/issue/components/actions/IssueContextMenu';
import type { Maps } from '@/utils/project';
import type { PropertyKey } from '@/utils/viewSettings';
import { CalendarChipFace } from './CalendarChipFace';

// A draggable card in the unscheduled panel.
export function CalendarUnscheduledCard({
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
  // (see the `sm:touch-none` below), and without work_items edit (scheduling a
  // issue by dropping it on a day is an issue edit).
  const { can } = usePermissions();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    disabled: useIsPhone() || !can('work_items', 'edit'),
  });
  return (
    <IssueContextMenu project={project} issue={issue}>
      <Card
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        interactive
        pad="tight"
        layout="row"
        gap={2}
        onClick={(e) => {
          e.preventDefault();
          onOpen(issue.id);
        }}
        className={cn('kanban-card items-center text-xs sm:touch-none', isDragging && 'opacity-40')}
      >
        <CalendarChipFace
          issue={issue}
          color={color}
          properties={['id', ...properties]}
          maps={maps}
        />
      </Card>
    </IssueContextMenu>
  );
}
