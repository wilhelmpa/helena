import { db, issue, issueActivity, projectColumn } from '@repo/db';
import { and, desc, eq } from 'drizzle-orm';
import { getSubtaskResumeAgent } from '#modules/agents/core/service';
import { enqueueAgentRun } from '#modules/agents/core/run-queue';
import type { IssueRow } from './service';
import { shouldResumeParent, subtaskResumePrompt } from './subtask-resume';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ChildForResume = Pick<
  IssueRow,
  'id' | 'identifier' | 'projectId' | 'parentId' | 'columnId' | 'delegateUserId' | 'title'
>;

export async function enqueueParentResume(
  child: ChildForResume,
  previousColumnId: number,
  previousDelegateUserId: string | null,
  tx: Transaction,
): Promise<void> {
  const parentId = child.parentId;
  if (parentId === null || !(previousDelegateUserId || child.delegateUserId)) return;
  const [childColumn] = await tx
    .select({ stateType: projectColumn.stateType })
    .from(projectColumn)
    .where(eq(projectColumn.id, child.columnId));
  const [parent] = await tx
    .select({
      delegateUserId: issue.delegateUserId,
      archivedAt: issue.archivedAt,
      stateType: projectColumn.stateType,
    })
    .from(issue)
    .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
    .where(and(eq(issue.id, parentId), eq(issue.projectId, child.projectId)));
  if (
    !parent ||
    !childColumn ||
    !shouldResumeParent({
      childParentId: parentId,
      childDelegateUserId: previousDelegateUserId ?? child.delegateUserId,
      previousColumnId,
      currentColumnId: child.columnId,
      childStateType: childColumn.stateType,
      parentStateType: parent.stateType,
      parentDelegateUserId: parent.delegateUserId,
      parentArchived: parent.archivedAt !== null,
    })
  )
    return;
  const agent = await getSubtaskResumeAgent(child.projectId, parent.delegateUserId!);
  if (!agent) return;
  const [comment] = await tx
    .select({ body: issueActivity.body })
    .from(issueActivity)
    .where(and(eq(issueActivity.issueId, child.id), eq(issueActivity.kind, 'comment')))
    .orderBy(desc(issueActivity.createdAt), desc(issueActivity.id))
    .limit(1);
  await enqueueAgentRun(
    {
      agentId: agent.id,
      projectId: child.projectId,
      issueId: parentId,
      sourceActivityId: null,
      trigger: 'subtask',
      prompt: subtaskResumePrompt({
        childIdentifier: child.identifier,
        childTitle: child.title,
        childStateType: childColumn.stateType,
        resultComment: comment?.body ?? null,
      }),
    },
    tx,
  );
}
