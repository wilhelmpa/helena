'use client';

import { useGroupLabels } from '@/hooks/useGroupLabels';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import {
  buildGroups,
  buildMaps,
  groupIssues,
  sortIssues,
  type WorkItemsViewProps,
} from '@/utils/project';
import { formatShortDate, isDueOverdue } from '@/utils/dates';
import IssueContextMenu from '@/features/issue/components/actions/IssueContextMenu';
import { AssigneeAvatar } from '@/features/issue/components/shared/IssueBadges';
import { PriorityIcon, StateIcon } from '@/features/issue/components/shared/IssueIcons';
import { BoardHintPill } from '../shared/BoardHintPill';
import { DelegateOrb } from '../kanban/DelegateOrb';
import { boardCardData } from '../../utils/boardCardData';
import { useCardMetaWords } from '../../hooks/useCardMetaWords';
import { StatusBox } from '@/design-system';

// The columns of a list row that always keep their place, filled or not (owner, 28.09.:
// the status jumped left and right when a task had no priority or date).
const FIXED = ['id', 'assignee', 'status', 'priority', 'dueDate', 'labels'];

// The list layout of Aufgaben: the tasks grouped like the board (by status unless the view
// groups otherwise), each group in its own framed box. One 40px row per task in fixed
// columns — its key, its title with the other chosen properties, the status as a box, the
// priority, the due date, labels and who works on it — so nothing moves when a value is
// missing. On a phone the row keeps key, title and status.
export default function ListView({
  project,
  filters,
  settings,
  onOpenIssue,
  readOnly,
}: WorkItemsViewProps) {
  const groupLabels = useGroupLabels();
  const priorityLabel = usePriorityLabel();
  const words = useCardMetaWords();
  const maps = buildMaps(project);
  const groups = buildGroups(project, settings.group, groupLabels, filters);
  const sorted = sortIssues(project.issues, settings.sort, project);
  const byGroup = groupIssues(groups, sorted, settings.group);
  const properties = settings.properties.filter((property) => !FIXED.includes(property));
  const shown = groups.filter(
    (group) => settings.showEmptyGroups || (byGroup.get(group.key)?.length ?? 0) > 0,
  );

  return (
    <div className="ds-issue-list">
      {shown.map((group) => {
        const issues = byGroup.get(group.key) ?? [];
        return (
          <section key={group.key} className="ds-issue-list-group">
            <header className="ds-issue-list-head">
              <span
                className="ds-issue-list-dot"
                style={group.color ? { background: group.color } : undefined}
              />
              <span>{group.name}</span>
              <span className="ds-issue-list-count">{issues.length}</span>
            </header>
            {issues.length > 0 && (
              <div className="ds-issue-list-box">
                {issues.map((issue) => {
                  const { meta, importantValue } = boardCardData(
                    issue,
                    project,
                    maps,
                    properties,
                    priorityLabel,
                    words,
                  );
                  const labels = issue.labelIds.flatMap((id) => maps.labelById.get(id) ?? []);
                  const column = maps.columnById.get(issue.columnId);
                  const assignee = issue.assigneeUserId
                    ? maps.assigneeById.get(issue.assigneeUserId)
                    : undefined;
                  const delegate = issue.delegateUserId
                    ? maps.assigneeById.get(issue.delegateUserId)
                    : undefined;
                  const extra = [importantValue, ...meta].filter(Boolean).join(' · ');
                  return (
                    <IssueContextMenu key={issue.id} project={project} issue={issue}>
                      <button
                        type="button"
                        className="ds-issue-list-row"
                        onClick={() => onOpenIssue(issue.id)}
                      >
                        <span className="ds-issue-list-key">{issue.identifier}</span>
                        <span className="ds-issue-list-main">
                          <span className="ds-issue-list-title" dir="auto">
                            {issue.title}
                          </span>
                          {extra && <span className="ds-issue-list-meta">{extra}</span>}
                        </span>
                        <span className="ds-issue-list-cell" data-col="status">
                          {column && (
                            <StatusBox
                              stateType={column.stateType}
                              icon={<StateIcon stateType={column.stateType} color={column.color} />}
                            >
                              {column.name}
                            </StatusBox>
                          )}
                        </span>
                        <span className="ds-issue-list-cell" data-col="priority">
                          {issue.priority && (
                            <>
                              <PriorityIcon priority={issue.priority} />
                              <span>{priorityLabel(issue.priority)}</span>
                            </>
                          )}
                        </span>
                        <span
                          className="ds-issue-list-cell"
                          data-col="due"
                          data-overdue={
                            isDueOverdue(issue.dueDate, column?.stateType) ? 'true' : undefined
                          }
                        >
                          {issue.dueDate && formatShortDate(issue.dueDate)}
                        </span>
                        <span className="ds-issue-list-end">
                          {labels.map((label) => (
                            <BoardHintPill key={label.id} name={label.name} />
                          ))}
                          {delegate && (
                            <DelegateOrb
                              teamId={readOnly ? null : project.project.teamId}
                              projectId={project.project.id}
                              userId={delegate.userId}
                            />
                          )}
                          {assignee && (
                            <AssigneeAvatar
                              name={assignee.name}
                              image={assignee.image}
                              className="size-5"
                            />
                          )}
                        </span>
                      </button>
                    </IssueContextMenu>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
