import { useRef } from 'react';
import { Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import DndContext from '@/components/common/dnd/DndContext';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  buildGroups,
  buildMaps,
  groupIssues,
  sortIssues,
  type WorkItemsViewProps,
} from '@/utils/project';
import { usePersistedSet } from '@/hooks/usePersistedSet';
import { useTableColumnWidths } from '../../hooks/useTableColumnWidths';
import { useIssueReorder } from '../../hooks/useIssueReorder';
import { useGroupLabels } from '@/hooks/useGroupLabels';
import {
  buildTableItems,
  collapsedKey,
  columnWidthsKey,
  resolveColumns,
  type FlatItem,
} from '../../utils/table';
import { IssueDragOverlay } from '../shared/IssueDragOverlay';
import { TableColumnHeader } from './TableColumnHeader';
import { TableSectionHeader } from './TableSectionHeader';
import { TableSubHeader } from './TableSubHeader';
import { TableRow } from './TableRow';
import { GroupDot } from '../shared/GroupDot';

interface TableViewProps extends WorkItemsViewProps {
  // Which stored set of column widths this table uses: a saved view's own, the
  // All tab's, or the single set every cycle / initiative board shares.
  widthScope: string;
}

export default function TableView({
  project,
  filters,
  customFields,
  settings,
  onSettingsChange,
  onOpenIssue,
  readOnly,
  widthScope,
}: TableViewProps) {
  const t = useTranslations('workItems');
  const groupLabels = useGroupLabels();
  const reorder = useIssueReorder({ project, sort: settings.sort, readOnly });
  const collapsed = usePersistedSet(
    collapsedKey(project.project.id, settings.group, settings.subgroup),
  );
  const { widths, setWidth, persistWidths } = useTableColumnWidths(
    columnWidthsKey(project.project.key, widthScope),
  );

  const grouped = settings.group !== 'none';
  const subgrouped = grouped && settings.subgroup !== 'none';
  const sorted = sortIssues(project.issues, settings.sort, project);
  const groups = buildGroups(project, settings.group, groupLabels, filters);
  const subGroups = subgrouped ? buildGroups(project, settings.subgroup, groupLabels, filters) : [];
  const groupedIssues = groupIssues(groups, sorted, settings.group);
  const subgroupedIssues = subgrouped ? groupIssues(subGroups, sorted, settings.subgroup) : null;
  const hiddenGroups = [...groups, ...subGroups].filter(
    (group) =>
      settings.hiddenGroups.includes(group.key) &&
      (settings.showEmptyGroups ||
        ((groupedIssues.get(group.key) ?? subgroupedIssues?.get(group.key))?.length ?? 0) > 0),
  );
  const maps = buildMaps(project);

  const { columns, gridTemplate, minWidth, alignTop } = resolveColumns(
    settings.properties,
    customFields,
    widths,
  );

  const items = buildTableItems({
    groups,
    subGroups,
    sorted,
    settings,
    collapsed: collapsed.values,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
    getItemKey: (index) => {
      const it = items[index];
      if (it.kind === 'header') return `h${it.group.key}`;
      if (it.kind === 'subheader') return `s${it.dropKey}`;
      return `r${it.issue.id}`;
    },
  });

  function renderItem(item: FlatItem) {
    switch (item.kind) {
      case 'header': {
        // When sub-grouped, issues live under the sub-headers, so the group header
        // is only a drop target while the group is collapsed and they are hidden.
        const isCollapsed = collapsed.values.has(item.group.key);
        return (
          <TableSectionHeader
            group={item.group}
            project={project}
            count={item.count}
            collapsed={isCollapsed}
            disabled={subgrouped && !isCollapsed}
            dropId={`sec:${item.dropKey}`}
            onDrop={(id) => reorder.moveIssue(id, item.assign, item.bucket, item.bucket.length)}
            onToggle={() => collapsed.toggle(item.group.key)}
            readOnly={readOnly}
          />
        );
      }
      case 'subheader':
        return (
          <TableSubHeader
            sub={item.sub}
            count={item.count}
            collapsed={collapsed.values.has(item.dropKey)}
            dropId={`sec:${item.dropKey}`}
            onDrop={(id) => reorder.moveIssue(id, item.assign, item.bucket, item.bucket.length)}
            onToggle={() => collapsed.toggle(item.dropKey)}
          />
        );
      case 'row':
        return (
          <TableRow
            project={project}
            issue={item.issue}
            orderedColumns={columns}
            maps={maps}
            showId={settings.properties.includes('id')}
            alignTop={alignTop}
            indented={subgrouped}
            gridTemplate={gridTemplate}
            dropDisabled={!reorder.manualOrder && grouped}
            onDrop={(draggedId) =>
              reorder.moveIssue(draggedId, item.assign, item.bucket, item.index)
            }
            onClick={() => onOpenIssue(item.issue.id)}
            onOpenIssue={onOpenIssue}
          />
        );
    }
  }

  return (
    <DndContext
      sensors={reorder.sensors}
      collisionDetection={reorder.collisionDetection}
      onDragStart={reorder.onDragStart}
      onDragCancel={reorder.onDragCancel}
      onDragEnd={reorder.onDragEnd}
    >
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <TableColumnHeader
          columns={columns}
          gridTemplate={gridTemplate}
          minWidth={minWidth}
          onResize={setWidth}
          onResizeEnd={persistWidths}
        />

        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
            minWidth,
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => (
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
              {renderItem(items[vi.index])}
            </div>
          ))}
        </div>
        {hiddenGroups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 text-sm text-muted-foreground">
            <span>{t('hiddenGroups')}</span>
            {hiddenGroups.map((group) => (
              <button
                key={group.key}
                type="button"
                disabled={readOnly}
                aria-label={`${t('show')} ${group.name}`}
                className="flex items-center gap-1 rounded-md bg-accent/40 px-2 py-1 text-foreground hover:bg-accent"
                onClick={() =>
                  onSettingsChange({
                    ...settings,
                    hiddenGroups: settings.hiddenGroups.filter((key) => key !== group.key),
                  })
                }
              >
                <GroupDot group={group} />
                {group.name}
                <Eye className="size-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>

      <IssueDragOverlay issue={reorder.activeIssue} />
    </DndContext>
  );
}
