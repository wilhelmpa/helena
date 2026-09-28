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
import { and, asc, desc, eq, gte, inArray, isNull, notExists, notInArray, sql } from 'drizzle-orm';
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
import { isTkSender } from './tk';
import { taskEligibility } from './task-policy';
import { withProjectTriageClaim, checkTriageCancellation } from './claim';
import { receiptSummary, triageMessageResult } from './batch-result';
import { EMPTY_RECEIPT_NOTE, FAILED_RECEIPT_NOTE, recordReceiptAttempt } from './receipt-retry';

// Task eligibility follows the application policy; invoice filing is independent of it.
// Uncertain task decisions stay visible for review in the project's inbox.

const BATCH = 20;
const MAX_PER_RUN = 200;

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
  cascade: Record<string, 'act' | 'suggest' | 'escalate'>;
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
async function pendingMessages(
  teamId: number,
  config: MailTriageConfig,
  limit: number,
  attempted: number[],
  projectId?: number,
) {
  const since = config.since ? new Date(config.since) : new Date();
  return db
    .select({ id: mailMessage.id, threadId: mailMessage.threadId })
    .from(mailMessage)
    .innerJoin(mailAccount, eq(mailAccount.id, mailMessage.accountId))
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .where(
      and(
        eq(mailMessage.teamId, teamId),
        projectId === undefined ? undefined : eq(mailThread.projectId, projectId),
        isNull(mailMessage.deletedAt),
        gte(mailMessage.createdAt, since),
        attempted.length ? notInArray(mailMessage.id, attempted) : undefined,
        sql`lower(${mailMessage.fromAddress}) <> lower(${mailAccount.address})`,
        config.accountIds.length ? inArray(mailMessage.accountId, config.accountIds) : undefined,
        sql`EXISTS (SELECT 1 FROM ${mailMessageFolder} mf JOIN ${mailFolder} f ON f.id = mf.folder_id
                    WHERE mf.message_id = ${mailMessage.id} AND f.role = 'inbox')`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(helenaMailClassification)
            .where(
              and(
                eq(helenaMailClassification.messageId, mailMessage.id),
                sql`(${helenaMailClassification.status} <> 'failed' OR ${helenaMailClassification.correctedAt} IS NOT NULL)`,
              ),
            ),
        ),
      ),
    )
    .orderBy(
      sql`case when lower(split_part(${mailMessage.fromAddress}, '@', 2)) = 'tk.de' then 0 else 1 end`,
      // A retried provider failure must not hold up mail that has never been triaged.
      sql`case when exists (select 1 from ${helenaMailClassification} c where c.message_id = ${mailMessage.id} and c.status = 'failed') then 1 else 0 end`,
      asc(mailMessage.id),
    )
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
  scopeProjectId?: number,
): Promise<ClassificationView | null> {
  const [message] = await db
    .select({ message: mailMessage, thread: mailThread, account: mailAccount })
    .from(mailMessage)
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .innerJoin(mailAccount, eq(mailAccount.id, mailMessage.accountId))
    .where(
      and(
        eq(mailMessage.id, messageId),
        eq(mailMessage.teamId, teamId),
        scopeProjectId === undefined ? undefined : eq(mailThread.projectId, scopeProjectId),
      ),
    );
  if (!message) throw new HttpError(404, 'Mail not found');
  const projects = (await teamProjects(teamId)).filter(
    (item) => scopeProjectId === undefined || item.id === scopeProjectId,
  );
  const attachments = await db
    .select({ filename: mailAttachment.filename })
    .from(mailAttachment)
    .where(eq(mailAttachment.messageId, messageId));
  const outcome = await decide({
    teamId,
    classId: MAIL_CLASS,
    localOnly: true,
    context: mailContext({
      fromName: message.message.fromName,
      fromAddress: message.message.fromAddress,
      to: message.account.address,
      subject: message.message.subject,
      text: message.message.textBody,
      attachments: attachments.map((a) => a.filename),
    }),
    questions: mailQuestions(projects, message.thread.projectId),
    subject: `mail:${messageId}`,
    projectId: message.thread.projectId,
  });
  if (outcome.status === 'off') return null;
  const answers = Object.fromEntries(
    ['project', 'category', 'priority', 'needs_reply', 'create_task', 'task_eligibility'].map(
      (id) => [id, answerOf(outcome, id)],
    ),
  ) as Record<string, MailClassificationAnswer>;
  const tkSender = isTkSender(message.message.fromAddress);
  if (tkSender) {
    answers.priority = { choice: 'high', confidence: 1, decided: true };
  }
  if (
    answers.category.decided &&
    ['advertising', 'newsletter'].includes(answers.category.choice ?? '')
  ) {
    // A model can mark spam/phishing as urgent and actionable. Never create an
    // automatic task or reply suggestion for a confidently identified advertisement/newsletter.
    if (!tkSender) answers.priority = { choice: 'low', confidence: 1, decided: true };
    answers.create_task = { choice: 'no', confidence: 1, decided: true };
    answers.needs_reply = { choice: 'no', confidence: 1, decided: true };
  }
  const eligibleTask = taskEligibility(answers, tkSender);
  const decided = (id: string) => (answers[id]!.decided ? answers[id]!.choice : null);
  const projectChoice = decided('project');
  const projectId =
    projectChoice && projectChoice !== NO_PROJECT
      ? (projects.find((p) => projectOptionId(p.key) === projectChoice)?.id ?? null)
      : null;
  const category = decided('category');
  const priority = decided('priority');
  const needsReply = decided('needs_reply');
  const anyDecided = Object.values(answers).some((answer) => answer.decided);
  const status =
    outcome.answers.project?.choice == null
      ? 'failed'
      : eligibleTask !== null && anyDecided
        ? 'classified'
        : 'unsure';
  const values = {
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
    createTask: eligibleTask,
    answers,
    error: status === 'failed' ? (outcome.error ?? outcome.status) : null,
  };
  const [row] = await db
    .insert(helenaMailClassification)
    .values(values)
    .onConflictDoUpdate({
      target: helenaMailClassification.messageId,
      set: {
        status: values.status,
        projectId: values.projectId,
        category: values.category,
        priority: values.priority,
        needsReply: values.needsReply,
        createTask: values.createTask,
        answers: values.answers,
        actions: [],
        issueId: null,
        error: values.error,
      },
      setWhere: and(
        eq(helenaMailClassification.status, 'failed'),
        isNull(helenaMailClassification.correctedAt),
      ),
    })
    .returning();
  if (!row) return null;
  if (status === 'classified') await act(row, message.thread, config, actorUserId);
  else if (status === 'unsure') {
    const receiptAction = await fileReceipts(row, message.thread.projectId, config, actorUserId);
    if (receiptAction)
      await db
        .update(helenaMailClassification)
        .set({ actions: [receiptAction] })
        .where(eq(helenaMailClassification.id, row.id));
  }
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
          priority: row.priority,
        });
        issueId = created.issueId;
        threadProject = target;
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
  } catch (error) {
    actions.push({
      kind: 'skipped',
      note: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    });
  }
  const receiptAction = await fileReceipts(row, threadProject, config, actorUserId);
  if (receiptAction) actions.push(receiptAction);
  await db
    .update(helenaMailClassification)
    .set({ actions, issueId })
    .where(eq(helenaMailClassification.id, row.id));
}

async function fileReceipts(
  row: typeof helenaMailClassification.$inferSelect,
  projectId: number | null,
  config: MailTriageConfig,
  actorUserId: string | null,
): Promise<MailClassificationAction | null> {
  if (row.category !== 'invoice' || config.receipts !== 'auto' || !projectId || !receiptIntake)
    return null;
  try {
    const receiptIds = await receiptIntake({
      teamId: row.teamId,
      projectId,
      messageId: row.messageId,
      actorUserId,
    });
    return {
      kind: 'receipt',
      projectId,
      receiptIds,
      note: receiptIds.length ? null : EMPTY_RECEIPT_NOTE,
      ...(receiptIds.length ? {} : { attemptedAt: new Date().toISOString() }),
    };
  } catch {
    return {
      kind: 'skipped',
      projectId,
      note: FAILED_RECEIPT_NOTE,
      attemptedAt: new Date().toISOString(),
    };
  }
}

// Intake uses additional connections from this process's pool. Admit one receipt retry
// at a time; other scopes remain pending for the next existing run, without a queue.
let receiptRetryRunning = false;

export async function retryReceiptFiling(
  teamId: number,
  config: MailTriageConfig,
  actorUserId: string | null,
  projectId?: number,
  signal?: AbortSignal,
) {
  if (config.receipts !== 'auto' || !receiptIntake || receiptRetryRunning)
    return { completed: 0, failed: 0, receiptIds: [] as number[] };
  receiptRetryRunning = true;
  try {
    return await retryReceiptBatch(teamId, config, actorUserId, projectId, signal);
  } finally {
    receiptRetryRunning = false;
  }
}

async function retryReceiptBatch(
  teamId: number,
  config: MailTriageConfig,
  actorUserId: string | null,
  projectId?: number,
  signal?: AbortSignal,
) {
  const eligible = and(
    eq(helenaMailClassification.teamId, teamId),
    eq(helenaMailClassification.category, 'invoice'),
    inArray(helenaMailClassification.status, ['classified', 'unsure']),
    isNull(mailMessage.deletedAt),
    sql`${mailThread.projectId} IS NOT NULL`,
    eq(mailAccount.enabled, true),
    sql`${mailAccount.credentialId} IS NOT NULL`,
    projectId === undefined ? undefined : eq(mailThread.projectId, projectId),
    config.accountIds.length ? inArray(mailAccount.id, config.accountIds) : undefined,
    sql`NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${helenaMailClassification.actions}) action
      WHERE action->>'kind' = 'receipt' AND action->'receiptIds' IS DISTINCT FROM '[]'::jsonb)`,
  );
  const pending = await db
    .select({ id: helenaMailClassification.id })
    .from(helenaMailClassification)
    .innerJoin(mailMessage, eq(mailMessage.id, helenaMailClassification.messageId))
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .innerJoin(mailAccount, eq(mailAccount.id, mailMessage.accountId))
    .where(eligible)
    .orderBy(
      sql`coalesce((SELECT max(action->>'attemptedAt')
        FROM jsonb_array_elements(${helenaMailClassification.actions}) action
        WHERE action->>'kind' = 'receipt' OR action->>'note' = ${FAILED_RECEIPT_NOTE}), '')`,
      asc(helenaMailClassification.id),
    )
    .limit(BATCH);
  let done = 0;
  let failed = 0;
  const receiptIds: number[] = [];
  for (const candidate of pending) {
    checkTriageCancellation(signal);
    const action = await db.transaction(async (tx) => {
      // Do not consume a pool connection waiting for another replica or owner correction.
      const [locked] = await tx
        .select({ id: helenaMailClassification.id })
        .from(helenaMailClassification)
        .where(eq(helenaMailClassification.id, candidate.id))
        .for('update', { skipLocked: true });
      if (!locked) return null;
      const [current] = await tx
        .select({ row: helenaMailClassification, projectId: mailThread.projectId })
        .from(helenaMailClassification)
        .innerJoin(mailMessage, eq(mailMessage.id, helenaMailClassification.messageId))
        .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
        .innerJoin(mailAccount, eq(mailAccount.id, mailMessage.accountId))
        .where(and(eligible, eq(helenaMailClassification.id, candidate.id)));
      if (!current) return null;
      const result = await fileReceipts(current.row, current.projectId, config, actorUserId);
      if (!result) return null;
      await tx
        .update(helenaMailClassification)
        .set({ actions: recordReceiptAttempt(current.row.actions, result) })
        .where(eq(helenaMailClassification.id, candidate.id));
      return result;
    });
    if (action?.kind === 'receipt' && action.receiptIds?.length) {
      done++;
      receiptIds.push(...action.receiptIds);
    } else if (action?.kind === 'skipped') failed++;
  }
  return { completed: done, failed, receiptIds: receiptSummary(receiptIds).receiptIds };
}

// The scheduled job classifies the next unhandled inbox mail at each check.
export async function classifyPending(): Promise<number> {
  let done = 0;
  for (const team of await activeTeams()) {
    const config = mailTriageConfig((team.config as Record<string, unknown>) ?? {});
    await retryReceiptFiling(team.teamId, config, team.actorUserId);
    const attempted: number[] = [];
    while (attempted.length < MAX_PER_RUN) {
      const batch = await pendingMessages(
        team.teamId,
        config,
        Math.min(BATCH, MAX_PER_RUN - attempted.length),
        attempted,
      );
      if (batch.length === 0) break;
      for (const message of batch) {
        // A temporary failure must not keep the oldest mail at the front of every
        // batch and starve the rest of the mailbox during this run.
        attempted.push(message.id);
        try {
          if (await classifyMessage(team.teamId, config, message.id, team.actorUserId)) done += 1;
        } catch (error) {
          console.error(`[mail-triage] mail ${message.id} not classified`, error);
        }
      }
    }
  }
  return done;
}

export async function runProjectTriage(
  project: { id: number; teamId: number; key: string },
  maxMessages: number,
  signal?: AbortSignal,
) {
  const team = (await activeTeams()).find((item) => item.teamId === project.teamId);
  if (!team) throw new HttpError(409, 'Enable the Mail classification decision class first.');
  const config = mailTriageConfig((team.config as Record<string, unknown>) ?? {});
  const accounts = await db
    .select({ id: mailAccount.id, address: mailAccount.address })
    .from(mailAccount)
    .where(
      and(
        eq(mailAccount.teamId, project.teamId),
        eq(mailAccount.projectId, project.id),
        eq(mailAccount.enabled, true),
        sql`${mailAccount.credentialId} IS NOT NULL`,
        config.accountIds.length ? inArray(mailAccount.id, config.accountIds) : undefined,
      ),
    );
  if (!accounts.length)
    throw new HttpError(409, 'No enabled, connected mailbox selected for this project.');
  if (!team.actorUserId)
    throw new HttpError(409, 'Save the Mail classification settings as an owner first.');
  const scoped = {
    ...config,
    accountIds: accounts.map((item) => item.id),
    project: 'off' as const,
    agent: 'off' as const,
    agentId: null,
  };
  checkTriageCancellation(signal);
  return withProjectTriageClaim(project.id, async () => {
    checkTriageCancellation(signal);
    const receiptRetries = await retryReceiptFiling(
      project.teamId,
      scoped,
      team.actorUserId,
      project.id,
      signal,
    );
    checkTriageCancellation(signal);
    const batch = await pendingMessages(project.teamId, scoped, maxMessages, [], project.id);
    const results: Awaited<ReturnType<typeof triageMessageResult>>[] = [];
    for (const message of batch) {
      checkTriageCancellation(signal);
      results.push(
        await triageMessageResult(project.key, message, () =>
          classifyMessage(project.teamId, scoped, message.id, team.actorUserId, project.id),
        ),
      );
    }
    const remaining = await pendingMessages(
      project.teamId,
      scoped,
      1,
      batch.map((item) => item.id),
      project.id,
    );
    return {
      accounts,
      processed: results.length,
      receiptRetries: receiptRetries.completed,
      ...receiptSummary([
        ...receiptRetries.receiptIds,
        ...results.flatMap((item) => item.receiptIds),
      ]),
      hasMore: remaining.length > 0,
      failed:
        receiptRetries.failed +
        results.filter((item) => item.status === 'failed' || item.actionFailed).length,
      reviewRequired: results.filter((item) => item.status === 'unsure').length,
      results,
    };
  });
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
    cascade: Object.fromEntries(
      Object.entries(row.answers).map(([id, answer]) => [
        id,
        answer.decided
          ? 'act'
          : answer.choice && (answer.confidence ?? 0) >= 0.6
            ? 'suggest'
            : 'escalate',
      ]),
    ),
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
