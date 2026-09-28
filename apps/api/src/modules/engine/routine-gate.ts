import {
  db,
  aiAgent,
  helenaSchedule,
  issue,
  mailAccount,
  mailMessage,
  pipelineRun,
  project,
  projectColumn,
} from '@repo/db';
import { and, desc, eq, gt, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { classSetting, decide } from '#modules/decisions/service';
import {
  HEARTBEAT_PRECHECK_CLASS,
  LOCAL_DECISION_MODEL,
  ROUTINE_GATE_CLASS,
} from '#modules/decisions/classes';
import { heartbeatPrecheckQuestions, routineGateQuestions } from '#modules/decisions/questions';
import { connectionIsLocal, loadConnection } from '#modules/browser-task/connection';

export type GateMode = 'off' | 'shadow' | 'active';
export type GateSource = 'none' | 'mail' | 'audit';

export interface RoutineGateResult {
  mode: GateMode;
  source: GateSource;
  recommendation: 'run' | 'skip';
  reason: string;
  counts: Record<string, number>;
  decisionId: number | null;
  confidence: number | null;
  status: string;
}

const numberCount = (condition: SQL) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

function scheduleDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export async function inspectRoutineGate(
  row: typeof helenaSchedule.$inferSelect,
  scheduledFor: Date,
): Promise<RoutineGateResult> {
  const mode = row.gateMode as GateMode;
  const source = row.gateSource as GateSource;
  const result: RoutineGateResult = {
    mode,
    source,
    recommendation: 'run',
    reason: 'No reliable gate signal is available.',
    counts: {},
    decisionId: null,
    confidence: null,
    status: 'unavailable',
  };
  if (mode === 'off') return { ...result, reason: 'Gate is off.', status: 'off' };
  if (source === 'none') return result;

  const [owner] = await db
    .select({ teamId: project.teamId })
    .from(project)
    .where(eq(project.id, row.projectId));
  if (!owner) return result;
  const [previous] = await db
    .select({ scheduledFor: pipelineRun.scheduledFor })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.scheduleId, row.id),
        lt(pipelineRun.scheduledFor, scheduledFor),
        eq(pipelineRun.status, 'succeeded'),
      ),
    )
    .orderBy(desc(pipelineRun.scheduledFor))
    .limit(1);
  if (!previous?.scheduledFor)
    return { ...result, reason: 'No previous completed fire establishes a baseline.' };

  let borderline = false;
  let evidence = '';
  if (source === 'mail') {
    const accounts = await db
      .select({
        id: mailAccount.id,
        lastSyncAt: mailAccount.lastSyncAt,
        syncStatus: mailAccount.syncStatus,
      })
      .from(mailAccount)
      .where(and(eq(mailAccount.projectId, row.projectId), eq(mailAccount.enabled, true)));
    result.counts.accounts = accounts.length;
    if (accounts.length === 0) return { ...result, reason: 'No project mailbox is configured.' };
    const [counts] = await db
      .select({
        newMail: numberCount(gt(mailMessage.createdAt, previous.scheduledFor)),
        unread: numberCount(sql`${mailMessage.seen} = false`),
      })
      .from(mailMessage)
      .innerJoin(mailAccount, eq(mailAccount.id, mailMessage.accountId))
      .where(and(eq(mailAccount.projectId, row.projectId), isNull(mailMessage.deletedAt)));
    result.counts.newMail = counts?.newMail ?? 0;
    result.counts.unread = counts?.unread ?? 0;
    if (result.counts.newMail > 0 || result.counts.unread > 1)
      return {
        ...result,
        reason: 'New or multiple unread messages require triage.',
        status: 'work',
      };
    if (
      accounts.some(
        (account) =>
          account.syncStatus !== 'synced' ||
          !account.lastSyncAt ||
          account.lastSyncAt.getTime() < scheduledFor.getTime() ||
          Date.now() - account.lastSyncAt.getTime() > 30 * 60_000,
      )
    ) {
      return { ...result, reason: 'Mailbox sync did not cover the scheduled time.' };
    }
    borderline = result.counts.unread === 1;
    if (borderline) {
      const [message] = await db
        .select({ subject: mailMessage.subject })
        .from(mailMessage)
        .innerJoin(mailAccount, eq(mailAccount.id, mailMessage.accountId))
        .where(
          and(
            eq(mailAccount.projectId, row.projectId),
            isNull(mailMessage.deletedAt),
            eq(mailMessage.seen, false),
          ),
        )
        .limit(1);
      evidence = message?.subject.slice(0, 200) ?? '';
    }
  } else {
    const today = scheduleDate(scheduledFor, row.timezone);
    const [counts] = await db
      .select({
        open: sql<number>`count(*)`.mapWith(Number),
        overdue: numberCount(sql`${issue.dueDate} <= ${today}`),
      })
      .from(issue)
      .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
      .where(
        and(
          eq(issue.projectId, row.projectId),
          isNull(issue.archivedAt),
          sql`${projectColumn.stateType} in ('backlog', 'unstarted', 'started')`,
        ),
      );
    result.counts.open = counts?.open ?? 0;
    result.counts.overdue = counts?.overdue ?? 0;
    if (result.counts.overdue > 0 || result.counts.open > 1)
      return { ...result, reason: 'Open or overdue tickets require an audit.', status: 'work' };
    borderline = result.counts.open === 1;
    if (borderline) {
      const [ticket] = await db
        .select({ title: issue.title })
        .from(issue)
        .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
        .where(
          and(
            eq(issue.projectId, row.projectId),
            isNull(issue.archivedAt),
            sql`${projectColumn.stateType} in ('backlog', 'unstarted', 'started')`,
          ),
        )
        .limit(1);
      evidence = ticket?.title.slice(0, 200) ?? '';
    }
  }
  if (!borderline)
    return { ...result, recommendation: 'skip', reason: 'No work was counted.', status: 'empty' };

  const precheckSetting = await classSetting(owner.teamId, HEARTBEAT_PRECHECK_CLASS);
  const classId = precheckSetting.enabled ? HEARTBEAT_PRECHECK_CLASS : ROUTINE_GATE_CLASS;
  const setting = precheckSetting.enabled
    ? precheckSetting
    : await classSetting(owner.teamId, ROUTINE_GATE_CLASS);
  const credentialIds = [setting.credentialId, setting.fallbackCredentialId].filter(
    (id): id is number => id !== null,
  );
  const connections = await Promise.all(credentialIds.map(loadConnection));
  if (
    !setting.enabled ||
    connections.length === 0 ||
    connections.some(
      (connection) =>
        !connection || connection.model !== LOCAL_DECISION_MODEL || !connectionIsLocal(connection),
    )
  ) {
    return { ...result, reason: 'Borderline; Qwen3.6 local decision is not configured.' };
  }

  const [agent] = row.agentId
    ? await db
        .select({ username: aiAgent.username })
        .from(aiAgent)
        .where(eq(aiAgent.id, row.agentId))
    : [];
  const outcome = await decide({
    teamId: owner.teamId,
    classId,
    localOnly: true,
    projectId: row.projectId,
    agentId: row.agentId,
    subject: `Routine ${row.id}`,
    context: { source, title: row.title.slice(0, 200), counts: result.counts, evidence },
    questions:
      classId === HEARTBEAT_PRECHECK_CLASS
        ? heartbeatPrecheckQuestions(agent?.username ?? row.title)
        : routineGateQuestions(),
  });
  const answer = outcome.answers[classId === HEARTBEAT_PRECHECK_CLASS ? 'work' : 'run'];
  const trusted =
    outcome.model === LOCAL_DECISION_MODEL && (answer?.confidence ?? 0) >= 0.8 && answer?.decided;
  return {
    ...result,
    recommendation:
      trusted && (answer?.choice === 'skip' || answer?.choice === 'no') ? 'skip' : 'run',
    reason: trusted
      ? `Local decision: ${answer?.choice}.`
      : `Borderline; approved Qwen3.6 decision unavailable (${outcome.status}).`,
    decisionId: answer?.decisionId ?? null,
    confidence: answer?.confidence ?? null,
    status: outcome.status,
  };
}
