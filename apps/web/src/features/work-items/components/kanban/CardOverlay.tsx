import { DragOverlay } from '@dnd-kit/core';
import type { BoardIssue } from '@/lib/api/endpoints/issues';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { type Maps } from '@/utils/project';
import type { PropertyKey } from '@/utils/viewSettings';
import { Card } from '@/design-system';
import { Badge } from '@/components/ui/badge';
import { IssueCardBody } from './IssueCardBody';

// The drag preview shown under the cursor while a card is dragged. Slightly
// transparent, so it does not hide the drop line or the cards it would land
// between. It previews the grabbed card; when the drag carries a whole selection,
// a badge says how many issues move with it.
export function CardOverlay({
  activeId,
  count,
  issues,
  project,
  maps,
  properties,
}: {
  activeId: number | null;
  count: number;
  issues: BoardIssue[];
  project: ProjectDetail;
  maps: Maps;
  properties: PropertyKey[];
}) {
  const issue = activeId != null ? (issues.find((i) => i.id === activeId) ?? null) : null;
  // Offsets of the blank cards drawn behind the previewed one, farthest first so
  // every step stays visible under the one in front of it.
  const depths = Array.from({ length: Math.min(count - 1, 3) }, (_, n) => n + 1).reverse();
  // dropAnimation is disabled: the move is applied optimistically, so the card
  // is already in its new place when the drag ends. The default animation would
  // fly the overlay back to the source position first, making the card look like
  // it snaps back before reappearing in the target column.
  return (
    <DragOverlay dropAnimation={null}>
      {issue ? (
        <div className="relative cursor-grabbing opacity-95">
          {/* A drag carrying several issues reads as a deck with stepped edges. */}
          {depths.map((depth) => (
            <Card
              key={depth}
              pad="none"
              className="kanban-card absolute inset-0"
              style={{ transform: `translate(${depth * 6}px, ${depth * 6}px)` }}
            />
          ))}
          <Card gap={2} className="kanban-card board-card relative">
            <IssueCardBody issue={issue} project={project} maps={maps} properties={properties} />
            {count > 1 && (
              <Badge className="absolute -top-2 -right-2 rounded-full shadow">{count}</Badge>
            )}
          </Card>
        </div>
      ) : null}
    </DragOverlay>
  );
}
