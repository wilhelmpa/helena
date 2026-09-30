import { alias } from 'drizzle-orm/pg-core';
import { db, agentRun, aiAgent, label, organizationAgentAssignment } from '@repo/db';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  blockedCommentPrefix,
  blockedLabelName,
  blockedLabelNames,
} from '@helena/locales/defaults';
import { HttpError } from '#shared/lib';
import type { Locale } from '#modules/user-preferences/locale';
import { projectLocale } from '#modules/user-preferences/service';
import { noticeRecipients } from '#modules/agents/governance';
import { createComment, type FeedItemRow } from './activity';
import { bulkAddLabels } from './service';

// An agent that cannot go on without a person's answer marks the issue it works on as
// blocked. The issue gets the project's Blocked label and a comment with the question,
// which mentions the person the agent reports to: the owner of the agent it reports to
// in the organization, otherwise the project's owners. The agent's run on the issue
// ends as a success carrying the question, so the run history tells it apart.

const BLOCKED_COLOR = '#dc2626';

// The project's Blocked label, created in the project's language the first time an issue
// of the project is blocked. A label the project already has under that name in any
// language, in any case, is reused.
async function blockedLabelId(projectId: number, locale: Locale): Promise<number> {
  const find = () =>
    db
      .select({ id: label.id })
      .from(label)
      .where(
        and(
          eq(label.projectId, projectId),
          inArray(
            sql`lower(${label.name})`,
            blockedLabelNames().map((name) => name.toLowerCase()),
          ),
        ),
      )
      .orderBy(label.id)
      .limit(1);
  const [existing] = await find();
  if (existing) return existing.id;
  await db
    .insert(label)
    .values({ projectId, name: blockedLabelName(locale), color: BLOCKED_COLOR })
    .onConflictDoNothing();
  const [created] = await find();
  return created!.id;
}

const manager = alias(aiAgent, 'manager');

export async function markIssueBlocked(input: {
  issueId: number;
  projectId: number;
  actorUserId: string;
  question: string;
  updateRun?: boolean;
}): Promise<{ comment: FeedItemRow; runId: number | null }> {
  const [agent] = await db
    .select({ id: aiAgent.id, managerOwnerUserId: manager.ownerUserId })
    .from(aiAgent)
    .leftJoin(
      organizationAgentAssignment,
      and(
        eq(organizationAgentAssignment.agentId, aiAgent.id),
        eq(organizationAgentAssignment.teamId, aiAgent.teamId),
      ),
    )
    .leftJoin(manager, eq(manager.id, organizationAgentAssignment.reportsToAgentId))
    .where(eq(aiAgent.userId, input.actorUserId));
  if (!agent) throw new HttpError(403, 'Only an agent can mark an issue blocked');

  const locale = await projectLocale(input.projectId);
  await bulkAddLabels(
    input.projectId,
    [input.issueId],
    [await blockedLabelId(input.projectId, locale)],
    input.actorUserId,
  );
  const handles = await noticeRecipients(input.projectId, agent.managerOwnerUserId);
  const comment = await createComment({
    issueId: input.issueId,
    actorUserId: input.actorUserId,
    body: [...handles, `**${blockedCommentPrefix(locale)}** ${input.question.trim()}`].join(' '),
    asksForInput: true,
  });
  if (input.updateRun === false) return { comment, runId: null };
  const [run] = await db
    .update(agentRun)
    .set({ blockedQuestion: input.question.trim() })
    .where(
      inArray(
        agentRun.id,
        db
          .select({ id: agentRun.id })
          .from(agentRun)
          .where(
            and(
              eq(agentRun.agentId, agent.id),
              eq(agentRun.issueId, input.issueId),
              eq(agentRun.status, 'pending'),
              isNotNull(agentRun.startedAt),
            ),
          )
          .orderBy(desc(agentRun.id))
          .limit(1),
      ),
    )
    .returning({ id: agentRun.id });
  return { comment, runId: run?.id ?? null };
}
