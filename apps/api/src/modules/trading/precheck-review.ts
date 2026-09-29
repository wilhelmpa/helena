import { aiAgent, db, issue, projectColumn, projectMember } from '@repo/db';
import { projectCoordinatorUsername } from '@repo/agent-naming';
import { and, asc, eq } from 'drizzle-orm';
import type { ToolCallContext } from '@helena/sdk';
import { getProjectById } from '#modules/projects/service';
import { createIssue } from '#modules/issues/service';

export async function queuePaperReview(
  ctx: ToolCallContext,
  requestId: string,
  reason: string,
): Promise<number | null> {
  if (!ctx.project?.key) return null;
  const project = await getProjectById(ctx.project.id);
  if (!project || project.teamId !== ctx.project.teamId) return null;
  const title = `Paper precheck ${ctx.credentialId}:${requestId}`;
  const [existing] = await db
    .select({ id: issue.id })
    .from(issue)
    .where(and(eq(issue.projectId, project.id), eq(issue.title, title)))
    .limit(1);
  if (existing) return existing.id;
  const [coordinator] = await db
    .select({ userId: aiAgent.userId })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, project.id)),
    )
    .where(
      and(
        eq(aiAgent.teamId, project.teamId),
        eq(aiAgent.username, projectCoordinatorUsername(project.key)),
      ),
    )
    .limit(1);
  const [column] = await db
    .select({ id: projectColumn.id })
    .from(projectColumn)
    .where(and(eq(projectColumn.projectId, project.id), eq(projectColumn.stateType, 'unstarted')))
    .orderBy(asc(projectColumn.position))
    .limit(1);
  if (!coordinator || !column) return null;
  const created = await createIssue(
    project,
    {
      columnId: column.id,
      title,
      description: reason,
      delegateUserId: coordinator.userId,
    },
    ctx.caller?.userId ?? ctx.agent?.userId,
    { fromWorkflow: true },
  );
  return created.id;
}
