import { useCallback, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronsRightLeft, EyeOff, Pin, PinOff, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { BoardIssue } from '@/lib/api/endpoints/issues';
import { type Maps, type IssueGroup } from '@/utils/project';
import { cn } from '@/lib/utils';
import type { PropertyKey } from '@/utils/viewSettings';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BoardCard } from './BoardCard';
import { CardDropSlot } from './CardDropSlot';
import { DropLine } from '../shared/DropLine';
import { useIsOverContainer } from '../../hooks/useIsOverContainer';
import { useIncomingCount } from '../../hooks/useIncomingCount';
import { PINNED_COLUMN } from '../../utils/kanban';
import { wipAllows, wipFullColor, WIP_FULL_TINT, type WipState } from '../../utils/wipLimit';
import { WipCount } from './WipCount';
import InlineColumnCreate from './InlineColumnCreate';

// One flat-board column: a fixed header plus a vertically scrollable, virtualized
// list of its cards. The DOM holds only the cards in the viewport and near it, so
// a column with a large backlog stays fast. Card heights vary, so the virtualizer
// measures each rendered card instead of assuming a fixed size.
export function BoardColumn({
  project,
  group,
  issues,
  maps,
  properties,
  manualOrder,
  onMoveIssue,
  onOpenIssue,
  onHide,
  onCollapse,
  pinned,
  onTogglePin,
  wip,
  filtered,
  boardIssues,
  readOnly,
}: {
  project: ProjectDetail;
  group: IssueGroup;
  issues: BoardIssue[];
  maps: Maps;
  properties: PropertyKey[];
  // Whether the view is ordered manually. A card moves within the column only then.
  // With any other sort field, that field decides the order.
  manualOrder: boolean;
  // `index` is where the drop lands in this column's issues. The board turns it
  // into a position for each issue the drag carries.
  onMoveIssue: (issueIds: number[], group: IssueGroup, index: number) => void;
  onOpenIssue: (id: number) => void;
  onHide: () => void;
  onCollapse: () => void;
  pinned: boolean;
  onTogglePin: () => void;
  // The column's WIP limit. It is null when the column has no limit, and null when
  // the board is not grouped by status. `filtered` says whether the cards shown are
  // only part of the column.
  wip: WipState | null;
  filtered: boolean;
  // Every issue that the board holds. It tells which of a drag's cards are already
  // in this column when only some of them are on screen.
  boardIssues: BoardIssue[];
  readOnly?: boolean;
}) {
  const t = useTranslations('workItems');
  const { can } = usePermissions();
  const canCreateIssue = can('work_items', 'create') && !readOnly;
  const [creating, setCreating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // A column with a full hard limit accepts no card from another column. It is not
  // a drop target during such a drag. Cards already in the column still reorder
  // within it, because that adds no card to the column.
  const incoming = useIncomingCount(group, boardIssues);
  const closed = incoming > 0 && !wipAllows(wip, incoming);
  // The scroll area is the append drop target. Merge its ref with the ref of the
  // virtualizer's scroll element.
  const columnId = `col:${group.key}`;
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: columnId,
    disabled: closed,
    data: { onDrop: (ids: number[]) => onMoveIssue(ids, group, issues.length) },
  });
  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      dropRef(el);
    },
    [dropRef],
  );
  const isOverColumn = useIsOverContainer(columnId, issues);

  const virtualizer = useVirtualizer({
    count: issues.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 130,
    overscan: 8,
    getItemKey: (index) => issues[index].id,
  });
  const cardsHeight = virtualizer.getTotalSize();

  return (
    <div
      className={cn(
        'group/column flex h-full min-w-[260px] flex-1 basis-[260px] flex-col rounded-[18px] bg-kanban-column p-3 shadow-[0_0_0_1px_var(--board-column-outline)] max-sm:min-w-[calc(100vw-32px)] max-sm:flex-none max-sm:snap-start',
        pinned && PINNED_COLUMN,
        wip?.full && WIP_FULL_TINT[wipFullColor(wip)],
      )}
    >
      <div
        className="relative mb-1 flex min-h-4 items-center justify-between gap-1 px-1 pt-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="board-column-heading flex min-w-0 items-center gap-2 truncate text-muted-foreground">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: group.color ?? 'var(--muted-foreground)' }}
          />
          <span className="truncate">{group.name}</span>
          <WipCount filteredCount={issues.length} wip={wip} filtered={filtered} />
        </div>
        <div className="absolute end-0 top-0 z-10 flex shrink-0 items-center gap-0.5 bg-kanban-column ps-1 opacity-0 transition-opacity group-focus-within/column:opacity-100 group-hover/column:opacity-100">
          {!readOnly && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden size-5 text-muted-foreground md:inline-flex"
                    onClick={onTogglePin}
                    aria-label={pinned ? t('unpin') : t('pin')}
                  >
                    {pinned ? <PinOff /> : <Pin />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{pinned ? t('unpin') : t('pin')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 text-muted-foreground"
                    onClick={onCollapse}
                    aria-label={t('collapse')}
                  >
                    <ChevronsRightLeft />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('collapse')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 text-muted-foreground"
                    onClick={onHide}
                    aria-label={t('hide')}
                  >
                    <EyeOff />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('hide')}</TooltipContent>
              </Tooltip>
            </>
          )}
          {canCreateIssue && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground"
                  onClick={() => setCreating(true)}
                  aria-label={t('newIssue')}
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('newIssue')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {creating && (
        <InlineColumnCreate project={project} group={group} onClose={() => setCreating(false)} />
      )}

      <div
        ref={mergedRef}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto rounded-[14px]',
          isOverColumn && 'bg-kanban-column-raised',
        )}
      >
        <div
          style={{
            height: cardsHeight,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const issue = issues[vi.index];
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <CardDropSlot
                  issueId={issue.id}
                  disabled={!manualOrder || closed}
                  onDrop={(ids) => onMoveIssue(ids, group, vi.index)}
                >
                  <BoardCard
                    project={project}
                    issue={issue}
                    maps={maps}
                    properties={properties}
                    onOpen={onOpenIssue}
                    readOnly={readOnly}
                  />
                </CardDropSlot>
              </div>
            );
          })}
          {isOver && manualOrder && issues.length > 0 && (
            <DropLine style={{ top: cardsHeight + 3 }} />
          )}
        </div>
      </div>
    </div>
  );
}
