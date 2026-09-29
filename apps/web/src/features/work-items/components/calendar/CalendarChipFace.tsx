import type { Issue } from '@/lib/api/endpoints/issues';
import { AssigneeAvatar } from '@/features/issue/components/shared/IssueBadges';
import { PriorityIcon } from '@/features/issue/components/shared/IssueIcons';
import type { Maps } from '@/utils/project';
import { CALENDAR_PROPERTIES, type PropertyKey } from '@/utils/viewSettings';

// What a day chip shows besides the colour dot and the title ("Felder" of the calendar): the
// task's key ahead of the title, the priority, the type, the goal and who works on it after it.
// One line, so each is short and the title gives way first.
export function CalendarChipFace({
  issue,
  color,
  properties,
  maps,
}: {
  issue: Issue;
  color: string;
  properties: PropertyKey[];
  maps: Maps;
}) {
  const has = (key: PropertyKey) =>
    properties.includes(key) && CALENDAR_PROPERTIES.includes(key as never);
  const assignee = issue.assigneeUserId ? maps.assigneeById.get(issue.assigneeUserId) : undefined;
  const type = issue.typeId != null ? maps.typeById.get(issue.typeId) : undefined;
  return (
    <>
      <span
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {has('id') && (
        <span className="shrink-0 text-muted-foreground tabular-nums">{issue.identifier}</span>
      )}
      <span className="truncate text-foreground">{issue.title}</span>
      {has('priority') && issue.priority && (
        <span className="shrink-0" title={issue.priority}>
          <PriorityIcon priority={issue.priority} />
        </span>
      )}
      {has('type') && type && <span className="shrink-0 text-muted-foreground">{type.name}</span>}
      {has('goal') && issue.goal && (
        <span className="min-w-0 shrink truncate text-muted-foreground">{issue.goal.title}</span>
      )}
      {has('assignee') && assignee && (
        <AssigneeAvatar name={assignee.name} image={assignee.image} className="size-4 shrink-0" />
      )}
    </>
  );
}
