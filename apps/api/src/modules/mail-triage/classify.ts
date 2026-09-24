import {
  aiAgent,
  db,
  helenaDecisionClassSetting,
  helenaMailClassification,
  mailAccount,
  mailAttachment,
  mailFolder,
  mailMessage,
  mailMessageFolder,
  mailThread,
  mailThreadIssue,
  project,
  projectMember,
  type MailClassificationAction,
  type MailClassificationAnswer,
} from '@repo/db';
import { and, asc, desc, eq, gte, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { MAIL_CLASS } from '#modules/decisions/classes';
import {
  MAIL_CATEGORIES,
  MAIL_PRIORITIES,
  NO_PROJECT,
  mailContext,
  mailQuestions,
  projectOptionId,
} from '#modules/decisions/questions';
import { decide, recordOutcome } from '#modules/decisions/service';
import { createTaskFromThread } from '#modules/mail/threads/filing';
import { moveThread } from '#modules/mail/threads/move';
import { mailTriageConfig, type MailTriageConfig } from './config';

// The mail classifier (docs/helena-decisions/decisions.md §5): for every new inbox mail of a
// team whose class "Mail einordnen" is on, one request to the decision model with five
// questions — the project, the kind of mail, the priority, whether it needs a reply, whether
// it asks for something to be done — and then what the owner configured: a project
// suggestion or move, a task (suggested or created), a hand-over to an agent, the invoice's
// attachments as receipts. Below the threshold nothing is acted on; the answers stay visible
// as "unsicher", and the owner's corrections go back to the decision log.

const BATCH = 20;

// Taking an invoice mail's attachments as receipts belongs to the receipts module, which
// registers itself here so this one does not import it.
type ReceiptIntake = (input: {
  teamId: number;
  projectId: number;
  messageId: number;
  actorUserId: string | null;
}) => Promise<number[]>;

let receiptIntake: ReceiptIntake | null = null;

export function useReceiptIntake(intake: ReceiptIntake | null): void {
  receiptIntake = intake;
}

export interface ClassificationView {
  id: number;
  threadId: number;
  messageId: number;
  status: string;
  projectId: number | null;
  projectKey: string | null;
  category: string | null;
  priority: string | null;
  needsReply: boolean | null;
  createTask: boolean | null;
  answers: Record<string, MailClassificationAnswer>;
  actions: MailClassificationAction[];
  issueId: number | null;
  error: string | null;
  corrected: boolean;
  createdAt: string;
}

async function teamProjects(teamId: number) {
  return db
    .select({
      id: project.id,
      key: project.key,
      name: project.name,
      description: project.description,
    })
    .from(project)
    .where(eq(project.teamId, teamId))
    .orderBy(asc(project.name));
}

// The classes that are on, with their config and the owner who configured them (the actor of
// what they do automatically).
async function activeTeams() {
  return db
    .select({
      teamId: helenaDecisionClassSetting.teamId,
      config: helenaDecisionClassSetting.config,
      actorUserId: helenaDecisionClassSetting.updatedByUserId,
    })
    .from(helenaDecisionClassSetting)
    .where(
      and(
        eq(helenaDecisionClassSetting.classId, MAIL_CLASS),
        eq(helenaDecisionClassSetting.enabled, true),
      ),
    );
}

// New inbox mail of a team not classified yet: in an inbox folder, not sent from the account's
// own address, arrived after the class was switched on.
async function pendingMessages(teamId: number, config: MailTriageConfig, limit: number) {
  const since = config.since ? new Date(config.since) : new Date();
  return db
    .select({ id: mailMessage.id })
    .from(mailMessage)
    .innerJoin(mailAccount, eq(mailAccount.id, mailMessage.accountId))
    .where(
      and(
        eq(mailMessage.teamId, teamId),
        isNull(mailMessage.deletedAt),
        gte(mailMessage.createdAt, since),
        sql`lower(${mailMessage.fromAddress}) <> lower(${mailAccount.address})`,
        config.accountIds.length ? inArray(mailMessage.accountId, config.accountIds) : undefined,
        sql`EXISTS (SELECT 1 FROM ${mailMessageFolder} mf JOIN ${mailFolder} f ON f.id = mf.folder_id
                    WHERE mf.message_id = ${mailMessage.id} AND f.role = 'inbox')`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(helenaMailClassification)
            .where(eq(helenaMailClassification.messageId, mailMessage.id)),
        ),
      ),
    )
    .orderBy(asc(mailMessage.id))
    .limit(limit);
}

function answerOf(
  outcome: Awaited<ReturnType<typeof decide>>,
  id: string,
): MailClassificationAnswer {
  const answer = outcome.answers[id];
  return {
    choice: answer?.choice ?? null,
    confidence: answer?.confidence ?? null,
    decided: answer?.decided ?? false,
  };
}

async function agentWorksIn(agentId: number, projectId: number) {
  const [row] = await db
    .select({ userId: aiAgent.userId })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, projectId)),
    )
    .where(eq(aiAgent.id, agentId));
  return row?.userId ?? null;
}

// Classifies one message and does what the config says. Returns null when the class is off
// (the message stays pending).
export async function classifyMessage(
  teamId: number,
  config: MailTriageConfig,
  messageId: number,
  actorUserId: string | null,
): Promise<ClassificationView | null> {
  const [message] = await db
    .select({ message: mailMessage, thread: mailThread, account: mailAccount })
    .from(mailMessage)
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .innerJoin(mailAccount, eq(mailAccount.id, mailMessage.accountId))
    .where(and(eq(mailMessage.id, messageId), eq(mailMessage.teamId, teamId)));
  if (!message) throw new HttpError(404, 'Mail not found');
  const projects = await teamProjects(teamId);
  const attachments = await db
    .select({ filename: mailAttachment.filename })
    .from(mailAttachment)
    .where(eq(mailAttachment.messageId, messageId));
  const outcome = await decide({
    teamId,
    classId: MAIL_CLASS,
    context: mailContext({
      fromName: message.message.fromName,
      fromAddress: message.message.fromAddress,
      to: message.account.address,
      subject: message.message.subject,
      text: message.message.textBody,
      attachments: attachments.map((a) => a.filename),
    }),
    questions: mailQuestions(projects),
    subject: `mail:${messageId}`,
    projectId: message.thread.projectId,
  });
  if (outcome.status === 'off') return null;
  const answers = Object.fromEntries(
    ['project', 'category', 'priority', 'needs_reply', 'create_task'].map((id) => [
      id,
      answerOf(outcome, id),
    ]),
  ) as Record<string, MailClassificationAnswer>;
  const decided = (id: string) => (answers[id]!.decided ? answers[id]!.choice : null);
  const projectChoice = decided('project');
  const projectId =
    projectChoice && projectChoice !== NO_PROJECT
      ? (projects.find((p) => projectOptionId(p.key) === projectChoice)?.id ?? null)
      : null;
  const category = decided('category');
  const priority = decided('priority');
  const needsReply = decided('needs_reply');
  const createTask = decided('create_task');
  const anyDecided = Object.values(answers).some((answer) => answer.decided);
  const status =
    outcome.answers.project?.choice == null ? 'failed' : anyDecided ? 'classified' : 'unsure';
  const [row] = await db
    .insert(helenaMailClassification)
    .values({
      teamId,
      threadId: message.thread.id,
      messageId,
      status,
      projectId,
      category:
        category && (MAIL_CATEGORIES as readonly string[]).includes(category) ? category : null,
      priority:
        priority && (MAIL_PRIORITIES as readonly string[]).includes(priority) ? priority : null,
      needsReply: needsReply === null ? null : needsReply === 'yes',
      createTask: createTask === null ? null : createTask === 'yes',
      answers,
      error: status === 'failed' ? (outcome.error ?? outcome.status) : null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  if (status === 'classified') await act(row, message.thread, config, actorUserId);
  return classificationView(row.id);
}

async function act(
  row: typeof helenaMailClassification.$inferSelect,
  thread: typeof mailThread.$inferSelect,
  config: MailTriageConfig,
  actorUserId: string | null,
): Promise<void> {
  const actions: MailClassificationAction[] = [];
  let issueId: number | null = null;
  let threadProject = thread.projectId;
  try {
    if (row.projectId && row.projectId !== thread.projectId && config.project !== 'off') {
      if (config.project === 'auto' && thread.projectId === null) {
        await moveThread(thread.id, row.projectId);
        threadProject = row.projectId;
        actions.push({ kind: 'moved', projectId: row.projectId });
      } else {
        await db
          .update(mailThread)
          .set({ suggestedProjectId: row.projectId, updatedAt: new Date() })
          .where(eq(mailThread.id, thread.id));
        actions.push({ kind: 'suggested', projectId: row.projectId });
      }
    }
    const [linked] = await db
      .select({ issueId: mailThreadIssue.issueId })
      .from(mailThreadIssue)
      .where(eq(mailThreadIssue.threadId, thread.id))
      .limit(1);
    const target = threadProject ?? row.projectId;
    if (row.createTask && !linked && target) {
      const agentUser =
        config.agent !== 'off' && config.agentId
          ? await agentWorksIn(config.agentId, target)
          : null;
      const handTo = agentUser && config.agent === 'auto';
      const create = config.task === 'auto' || handTo;
      if (create && actorUserId) {
        const created = await createTaskFromThread(thread.id, target, actorUserId, {
          assigneeUserId: handTo ? agentUser : undefined,
        });
        issueId = created.issueId;
        actions.push({
          kind: handTo ? 'agent' : 'task',
          issueId,
          projectId: target,
          agentId: handTo ? config.agentId : null,
        });
      } else {
        if (config.task !== 'off')
          actions.push({ kind: 'task', projectId: target, note: 'suggested' });
        if (agentUser && config.agent === 'suggest')
          actions.push({
            kind: 'agent',
            projectId: target,
            agentId: config.agentId,
            note: 'suggested',
          });
      }
    }
    if (row.category === 'invoice' && config.receipts === 'auto' && target && receiptIntake) {
      const receiptIds = await receiptIntake({
        teamId: row.teamId,
        projectId: target,
        messageId: row.messageId,
        actorUserId,
      });
      if (receiptIds.length) actions.push({ kind: 'receipt', projectId: target, receiptIds });
    }
  } catch (error) {
    actions.push({
      kind: 'skipped',
      note: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    });
  }
  await db
    .update(helenaMailClassification)
    .set({ actions, issueId })
    .where(eq(helenaMailClassification.id, row.id));
}

// The job (every minute, engine system job): classify what came in.
export async function classifyPending(): Promise<number> {
  let done = 0;
  for (const team of await activeTeams()) {
    const config = mailTriageConfig((team.config as Record<string, unknown>) ?? {});
    for (const message of await pendingMessages(team.teamId, config, BATCH)) {
      try {
        if (await classifyMessage(team.teamId, config, message.id, team.actorUserId)) done += 1;
      } catch (error) {
        console.error(`[mail-triage] mail ${message.id} not classified`, error);
      }
    }
  }
  return done;
}

export async function anyTeamClassifies(): Promise<boolean> {
  return (await activeTeams()).length > 0;
}

export async function classificationView(id: number): Promise<ClassificationView | null> {
  const [row] = await db
    .select({ row: helenaMailClassification, projectKey: project.key })
    .from(helenaMailClassification)
    .leftJoin(project, eq(project.id, helenaMailClassification.projectId))
    .where(eq(helenaMailClassification.id, id));
  if (!row) return null;
  return toView(row.row, row.projectKey);
}

function toView(
  row: typeof helenaMailClassification.$inferSelect,
  projectKey: string | null,
): ClassificationView {
  return {
    id: row.id,
    threadId: row.threadId,
    messageId: row.messageId,
    status: row.status,
    projectId: row.projectId,
    projectKey,
    category: row.category,
    priority: row.priority,
    needsReply: row.needsReply,
    createTask: row.createTask,
    answers: row.answers,
    actions: row.actions,
    issueId: row.issueId,
    error: row.error,
    corrected: row.correctedAt !== null,
    createdAt: iso(row.createdAt),
  };
}

// The newest classification of each thread, for the inbox list.
export async function classificationsOfThreads(
  threadIds: number[],
): Promise<Map<number, ClassificationView>> {
  if (threadIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([helenaMailClassification.threadId], {
      row: helenaMailClassification,
      projectKey: project.key,
    })
    .from(helenaMailClassification)
    .leftJoin(project, eq(project.id, helenaMailClassification.projectId))
    .where(inArray(helenaMailClassification.threadId, threadIds))
    .orderBy(helenaMailClassification.threadId, desc(helenaMailClassification.id));
  return new Map(rows.map((entry) => [entry.row.threadId, toView(entry.row, entry.projectKey)]));
}

// The owner corrects an answer: the classification shows the right one, and the decision log
// learns it (the outcome of that question's decision).
export async function correctClassification(
  threadId: number,
  input: { category?: string; priority?: string; projectId?: number | null; needsReply?: boolean },
  userId: string,
): Promise<ClassificationView> {
  const [row] = await db
    .select()
    .from(helenaMailClassification)
    .where(eq(helenaMailClassification.threadId, threadId))
    .orderBy(desc(helenaMailClassification.id))
    .limit(1);
  if (!row) throw new HttpError(404, 'This mail has not been classified.');
  if (input.category && !(MAIL_CATEGORIES as readonly string[]).includes(input.category))
    throw new HttpError(400, 'Unknown category.');
  if (input.priority && !(MAIL_PRIORITIES as readonly string[]).includes(input.priority))
    throw new HttpError(400, 'Unknown priority.');
  let projectKey: string | null = null;
  if (input.projectId) {
    const [target] = await db
      .select({ key: project.key })
      .from(project)
      .where(and(eq(project.id, input.projectId), eq(project.teamId, row.teamId)));
    if (!target) throw new HttpError(400, 'The project is not one of this team.');
    projectKey = target.key;
  }
  const [updated] = await db
    .update(helenaMailClassification)
    .set({
      ...(input.category ? { category: input.category } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.needsReply !== undefined ? { needsReply: input.needsReply } : {}),
      correctedByUserId: userId,
      correctedAt: new Date(),
    })
    .where(eq(helenaMailClassification.id, row.id))
    .returning();
  // The corrections go to the decisions of this mail.
  const outcomes: Record<string, string> = {
    ...(input.category ? { category: input.category } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.needsReply !== undefined ? { needs_reply: input.needsReply ? 'yes' : 'no' } : {}),
    ...(input.projectId !== undefined
      ? { project: projectKey ? projectOptionId(projectKey) : NO_PROJECT }
      : {}),
  };
  const decisions = await db.execute(sql`
    SELECT DISTINCT ON (question_id) id, question_id AS "questionId"
    FROM helena_decision
    WHERE team_id = ${row.teamId} AND subject = ${`mail:${row.messageId}`}
    ORDER BY question_id, id DESC`);
  for (const decision of decisions as unknown as { id: number; questionId: string }[]) {
    const outcome = outcomes[decision.questionId];
    if (outcome)
      await recordOutcome(row.teamId, Number(decision.id), outcome, 'owner').catch(() => {});
  }
  const [withKey] = await db
    .select({ key: project.key })
    .from(project)
    .where(eq(project.id, updated!.projectId ?? -1));
  return toView(updated!, withKey?.key ?? null);
}

// A suggestion the owner accepts: the task (for the thread's project), or the hand-over to the
// configured agent.
export async function acceptSuggestion(
  threadId: number,
  kind: 'task' | 'agent',
  userId: string,
): Promise<ClassificationView> {
  const [row] = await db
    .select()
    .from(helenaMailClassification)
    .where(eq(helenaMailClassification.threadId, threadId))
    .orderBy(desc(helenaMailClassification.id))
    .limit(1);
  if (!row) throw new HttpError(404, 'This mail has not been classified.');
  const [thread] = await db.select().from(mailThread).where(eq(mailThread.id, threadId));
  const target = thread?.projectId ?? row.projectId;
  if (!target) throw new HttpError(400, 'Move the mail to a project first.');
  const [setting] = await db
    .select({ config: helenaDecisionClassSetting.config })
    .from(helenaDecisionClassSetting)
    .where(
      and(
        eq(helenaDecisionClassSetting.teamId, row.teamId),
        eq(helenaDecisionClassSetting.classId, MAIL_CLASS),
      ),
    );
  const config = mailTriageConfig((setting?.config as Record<string, unknown>) ?? {});
  let assignee: string | undefined;
  if (kind === 'agent') {
    if (!config.agentId) throw new HttpError(400, 'No agent is configured for mail.');
    assignee = (await agentWorksIn(config.agentId, target)) ?? undefined;
    if (!assignee) throw new HttpError(400, 'The agent does not work in this project.');
  }
  const created = await createTaskFromThread(threadId, target, userId, {
    assigneeUserId: assignee,
  });
  const actions = [
    ...row.actions.filter(
      (action) =>
        !(action.note === 'suggested' && (action.kind === 'task' || action.kind === 'agent')),
    ),
    {
      kind,
      issueId: created.issueId,
      projectId: target,
      agentId: kind === 'agent' ? config.agentId : null,
    },
  ];
  await db
    .update(helenaMailClassification)
    .set({ actions, issueId: created.issueId })
    .where(eq(helenaMailClassification.id, row.id));
  return (await classificationView(row.id))!;
}

// Classifies a thread's newest mail now ("Einordnen"), whatever the job's window says.
export async function classifyThreadNow(
  threadId: number,
  actorUserId: string,
): Promise<ClassificationView | null> {
  const [latest] = await db
    .select({ id: mailMessage.id, teamId: mailMessage.teamId })
    .from(mailMessage)
    .where(and(eq(mailMessage.threadId, threadId), isNull(mailMessage.deletedAt)))
    .orderBy(desc(mailMessage.sentAt), desc(mailMessage.id))
    .limit(1);
  if (!latest) throw new HttpError(404, 'Mail thread not found');
  const [setting] = await db
    .select({
      config: helenaDecisionClassSetting.config,
      enabled: helenaDecisionClassSetting.enabled,
    })
    .from(helenaDecisionClassSetting)
    .where(
      and(
        eq(helenaDecisionClassSetting.teamId, latest.teamId),
        eq(helenaDecisionClassSetting.classId, MAIL_CLASS),
      ),
    );
  if (!setting?.enabled)
    throw new HttpError(409, 'The mail classifier is off (Einstellungen → Entscheidungen).');
  await db
    .delete(helenaMailClassification)
    .where(eq(helenaMailClassification.messageId, latest.id));
  return classifyMessage(
    latest.teamId,
    mailTriageConfig((setting.config as Record<string, unknown>) ?? {}),
    latest.id,
    actorUserId,
  );
}
