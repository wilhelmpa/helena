import { useSession } from '@/lib/auth-client';
import type { BoardIssue } from '@/lib/api/endpoints/issues';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { type Maps } from '@/utils/project';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import type { PropertyKey } from '@/utils/viewSettings';
import { boardCardData } from '../../utils/boardCardData';
import { AssigneeAvatar } from '@/features/issue/components/shared/IssueBadges';
import { BoardHintPill } from '../shared/BoardHintPill';
import { IssueIdentifier } from '../shared/IssueIdentifier';
import { IssueCardLinks } from './IssueCardLinks';
import { IssueCardSubtasks } from './IssueCardSubtasks';
import { DelegateOrb } from './DelegateOrb';

export function IssueCardBody({
  issue,
  project,
  maps,
  properties,
  onOpen,
  readOnly,
}: {
  issue: BoardIssue;
  project: ProjectDetail;
  maps: Maps;
  properties: PropertyKey[];
  onOpen?: (id: number) => void;
  readOnly?: boolean;
}) {
  const { data: session } = useSession();
  const priorityLabel = usePriorityLabel();
  const { importantValue, meta, labels } = boardCardData(
    issue,
    project,
    maps,
    properties,
    priorityLabel,
  );
  const assignee = issue.assigneeUserId ? maps.assigneeById.get(issue.assigneeUserId) : undefined;
  const delegate = issue.delegateUserId ? maps.assigneeById.get(issue.delegateUserId) : undefined;
  const showAssignee = assignee && assignee.userId !== session?.user.id;

  return (
    <>
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span
          dir="auto"
          className="board-card-title line-clamp-2 min-w-0 wrap-anywhere text-foreground"
        >
          {issue.title}
        </span>
        {importantValue && (
          <span className="board-card-value shrink-0 text-muted-foreground tabular-nums">
            {importantValue}
          </span>
        )}
      </div>

      {meta.length > 0 && (
        <div className="board-card-meta truncate text-muted-foreground">{meta.join(' · ')}</div>
      )}

      {(labels.length > 0 || showAssignee || delegate) && (
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {labels.map((label) => (
              <BoardHintPill key={label.id} name={label.name} />
            ))}
          </div>
          {delegate && (
            <DelegateOrb
              teamId={readOnly ? null : project.project.teamId}
              projectId={project.project.id}
              userId={delegate.userId}
            />
          )}
          {showAssignee && (
            <AssigneeAvatar name={assignee.name} image={assignee.image} className="size-5" />
          )}
        </div>
      )}

      {issue.parentId != null ? (
        <IssueIdentifier issue={issue} className="board-card-id" onOpenParent={onOpen} />
      ) : (
        <span className="board-card-id">{issue.identifier}</span>
      )}
      <IssueCardSubtasks issueId={issue.id} maps={maps} onOpen={onOpen} />
      <IssueCardLinks links={issue.links} maps={maps} onOpen={onOpen} />
    </>
  );
}
