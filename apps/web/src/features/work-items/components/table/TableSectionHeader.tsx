import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type IssueGroup } from '@/utils/project';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TableDropZone } from './TableDropZone';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import InlineColumnCreate from '../kanban/InlineColumnCreate';

// A primary group header row. A drop onto it appends to the group's bucket
// (disabled when sub-grouped, where issues live under sub-headers).
export function TableSectionHeader({
  group,
  project,
  count,
  collapsed,
  disabled,
  dropId,
  onDrop,
  onToggle,
  readOnly,
}: {
  group: IssueGroup;
  project: ProjectDetail;
  count: number;
  collapsed: boolean;
  disabled: boolean;
  dropId: string;
  onDrop: (issueId: number) => void;
  onToggle: () => void;
  // In a read-only share the add affordance is hidden.
  readOnly?: boolean;
}) {
  const t = useTranslations('workItems');
  const { can } = usePermissions();
  const canCreateIssue = can('work_items', 'create') && !readOnly;
  const [creating, setCreating] = useState(false);
  return (
    <TableDropZone
      id={dropId}
      disabled={disabled}
      onDrop={onDrop}
      className="group/section flex items-center justify-between bg-muted px-4 py-1.5"
    >
      <button
        type="button"
        onClick={onToggle}
        className="board-column-heading flex items-center gap-2 text-muted-foreground"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: group.color ?? 'var(--muted-foreground)' }}
        />
        {group.name}
        <span className="text-muted-foreground">{count}</span>
      </button>
      {creating && (
        <InlineColumnCreate
          project={project}
          group={group}
          onClose={() => setCreating(false)}
          compact
        />
      )}
      {canCreateIssue && !creating && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground opacity-0 group-focus-within/section:opacity-100 group-hover/section:opacity-100"
              onClick={() => setCreating(true)}
              aria-label={t('newIssue')}
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('newIssue')}</TooltipContent>
        </Tooltip>
      )}
    </TableDropZone>
  );
}
