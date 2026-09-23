import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { draggedProject, isProjectDrag } from '@/utils/projectTree';
import { useMoveProjectToGroup } from '@/services/projectGroups.service';
import { cn } from '@/lib/utils';

// Shown while a project is dragged: dropping it here takes it out of its group.
export default function ProjectUngroupDropZone({
  onDragChange,
}: {
  onDragChange: (dragging: boolean) => void;
}) {
  const t = useTranslations('nav.projectGroups');
  const move = useMoveProjectToGroup();
  const [over, setOver] = useState(false);

  return (
    <li
      className={cn(
        'rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground',
        over && 'border-sidebar-ring text-sidebar-foreground',
      )}
      onDragOver={(event) => {
        if (!isProjectDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDragChange(false);
        const project = draggedProject(event);
        if (project) move.mutate({ teamId: project.teamId, projectId: project.id, groupId: null });
      }}
    >
      {t('dropUngrouped')}
    </li>
  );
}
