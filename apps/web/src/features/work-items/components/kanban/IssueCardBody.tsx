import { useSession } from '@/lib/auth-client';
import { Inline, StatusBox } from '@/design-system';
import type { BoardIssue } from '@/lib/api/endpoints/issues';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { type Maps } from '@/utils/project';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import type { PropertyKey } from '@/utils/viewSettings';
import { boardCardData } from '../../utils/boardCardData';
import { useCardMetaWords } from '../../hooks/useCardMetaWords';
import { AssigneeAvatar } from '@/features/issue/components/shared/IssueBadges';
import { StateIcon } from '@/features/issue/components/shared/IssueIcons';
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
  const words = useCardMetaWords();
  const { importantValue, meta, labels, status } = boardCardData(
    issue,
    project,
    maps,
    properties,
    priorityLabel,
    words,
  );
  const assignee = issue.assigneeUserId ? maps.assigneeById.get(issue.assigneeUserId) : undefined;
  const delegate = issue.delegateUserId ? maps.assigneeById.get(issue.delegateUserId) : undefined;
  const showAssignee = assignee && assignee.userId !== session?.user.id;

  return (
    <>
      <Inline gap={2} align="baseline" justify="between" className="min-w-0">
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
      </Inline>

      {meta.length > 0 && (
        <div className="board-card-meta truncate text-muted-foreground">{meta.join(' · ')}</div>
      )}

      {(labels.length > 0 || showAssignee || delegate || status) && (
        <Inline gap={2} className="min-w-0">
          <Inline gap={1} wrap className="min-w-0 flex-1">
            {status && (
              <StatusBox
                stateType={status.stateType}
                icon={<StateIcon stateType={status.stateType} color={status.color} />}
              >
                {status.name}
              </StatusBox>
            )}
            {labels.map((label) => (
              <BoardHintPill key={label.id} name={label.name} />
            ))}
          </Inline>
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
        </Inline>
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
