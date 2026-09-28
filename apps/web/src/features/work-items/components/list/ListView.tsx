'use client';

import { useTranslations } from 'next-intl';
import { useGroupLabels } from '@/hooks/useGroupLabels';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import {
  buildGroups,
  buildMaps,
  groupIssues,
  sortIssues,
  type WorkItemsViewProps,
} from '@/utils/project';
import IssueContextMenu from '@/features/issue/components/actions/IssueContextMenu';
import { AssigneeAvatar } from '@/features/issue/components/shared/IssueBadges';
import { BoardHintPill } from '../shared/BoardHintPill';
import { DelegateOrb } from '../kanban/DelegateOrb';
import { boardCardData } from '../../utils/boardCardData';

// The list layout of Aufgaben (draft Aufgaben-list-*): the tasks grouped like the board
// (by status unless the view groups otherwise), one 40px row per task — its key, its
// title, the chosen properties in mono, labels as pills, who works on it. A group head
// is a mono label with the status dot and the count.
export default function ListView({
  project,
  filters,
  settings,
  onOpenIssue,
  readOnly,
}: WorkItemsViewProps) {
  const groupLabels = useGroupLabels();
  const priorityLabel = usePriorityLabel();
  const tColumns = useTranslations('workItems.columns');
  const maps = buildMaps(project);
  const groups = buildGroups(project, settings.group, groupLabels, filters);
  const sorted = sortIssues(project.issues, settings.sort, project);
  const byGroup = groupIssues(groups, sorted, settings.group);
  const properties = settings.properties.filter(
    (property) => property !== 'id' && property !== 'assignee',
  );
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
            {issues.map((issue) => {
              const { meta, labels, importantValue } = boardCardData(
                issue,
                project,
                maps,
                properties,
                priorityLabel,
                tColumns('statusAge'),
              );
              const assignee = issue.assigneeUserId
                ? maps.assigneeById.get(issue.assigneeUserId)
                : undefined;
              const delegate = issue.delegateUserId
                ? maps.assigneeById.get(issue.delegateUserId)
                : undefined;
              return (
                <IssueContextMenu key={issue.id} project={project} issue={issue}>
                  <button
                    type="button"
                    className="ds-issue-list-row"
                    onClick={() => onOpenIssue(issue.id)}
                  >
                    <span className="ds-issue-list-key">{issue.identifier}</span>
                    <span className="ds-issue-list-title" dir="auto">
                      {issue.title}
                    </span>
                    <span className="ds-issue-list-meta">
                      {[importantValue, ...meta].filter(Boolean).join(' · ')}
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
          </section>
        );
      })}
    </div>
  );
}
