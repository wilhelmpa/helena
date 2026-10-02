import { runDecisionEval, type EvalReport } from '@helena/decisions';
import { db, helenaDecisionEval } from '@repo/db';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { loadConnection, type DecisionConnection } from '#modules/browser-task/connection';
import { costOfUsage } from '#modules/model-prices/service';
import { decisionClass, localAiClassForDecision } from './classes';
import { askConnection, classSetting, effectiveThreshold } from './service';
import { jevDecisionPolicy } from './jev-policy';

// The eval of a decision class on one connection (docs/helena-decisions/decisions.md §8): the
// class's labelled cases asked exactly as the feature asks them, scored by code. It runs in the
// background (a local model on the CPU takes minutes); the row says when it finished. A class
// can be switched on only with a passing eval on the chosen connection.

// A question of an eval may take longer than a live decision (a cold model, the CPU).
const EVAL_TIMEOUT_MS = 120_000;
// An eval that has not finished after this long was cut off (a restart).
const STALE_MS = 45 * 60_000;

const running = new Map<number, AbortController>();

// Evals may wait behind interactive work; the realtime admission deadline is for live decisions.
export function evaluationConnection(
  connection: DecisionConnection,
  classId?: string,
): DecisionConnection {
  return {
    ...connection,
    priority: 'background',
    ...(classId && connection.keySource === 'local-ai'
      ? { localAiClassId: localAiClassForDecision(classId) }
      : {}),
    mailBudget: { queueMs: 60_000, generationMs: 60_000 },
  };
}

export interface EvalView {
  id: number;
  classId: string;
  credentialId: number | null;
  backendLabel: string;
  model: string | null;
  threshold: number;
  questions: number;
  answered: number;
  correct: number;
  correctAnswered: number;
  precision: number | null;
  coverage: number | null;
  accuracy: number | null;
  passed: boolean;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  inputTokens: number;
  costEur: number | null;
  failures: {
    case: string;
    question: string;
    expected: string[];
    got: string | null;
    confidence: number | null;
  }[];
  details: Record<string, unknown>;
  error: string | null;
  status: 'running' | 'done' | 'failed' | 'stale';
  createdAt: string;
  finishedAt: string | null;
}

function view(row: typeof helenaDecisionEval.$inferSelect): EvalView {
  const stale = !row.finishedAt && Date.now() - row.createdAt.getTime() > STALE_MS;
  return {
    id: row.id,
    classId: row.classId,
    credentialId: row.credentialId,
    backendLabel: row.backendLabel,
    model: row.model,
    threshold: row.threshold,
    questions: row.questions,
    answered: row.answered,
    correct: row.correct,
    correctAnswered: row.correctAnswered,
    precision: row.precision,
    coverage: row.coverage,
    accuracy: row.accuracy,
    passed: row.passed,
    latencyP50Ms: row.latencyP50Ms,
    latencyP95Ms: row.latencyP95Ms,
    inputTokens: row.inputTokens,
    costEur: row.costEur,
    failures: row.failures,
    details: row.details,
    error: row.error,
    status: stale ? 'stale' : !row.finishedAt ? 'running' : row.error ? 'failed' : 'done',
    createdAt: iso(row.createdAt),
    finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
  };
}

export async function listEvals(teamId: number, classId?: string, limit = 20): Promise<EvalView[]> {
  const rows = await db
    .select()
    .from(helenaDecisionEval)
    .where(
      and(
        eq(helenaDecisionEval.teamId, teamId),
        classId ? eq(helenaDecisionEval.classId, classId) : undefined,
      ),
    )
    .orderBy(desc(helenaDecisionEval.createdAt), desc(helenaDecisionEval.id))
    .limit(Math.max(1, Math.min(100, limit)));
  return rows.map(view);
}

// The newest finished eval of a class on a connection, or null.
export async function latestEval(
  teamId: number,
  classId: string,
  credentialId: number,
): Promise<EvalView | null> {
  const [row] = await db
    .select()
    .from(helenaDecisionEval)
    .where(
      and(
        eq(helenaDecisionEval.teamId, teamId),
        eq(helenaDecisionEval.classId, classId),
        eq(helenaDecisionEval.credentialId, credentialId),
      ),
    )
    .orderBy(desc(helenaDecisionEval.createdAt), desc(helenaDecisionEval.id))
    .limit(1);
  return row ? view(row) : null;
}

// Whether the class may be switched on with this connection and threshold: its newest eval
// there passed at this threshold or a lower one (a stricter threshold only raises precision).
export async function evalAllows(
  teamId: number,
  classId: string,
  credentialId: number,
  threshold: number,
): Promise<{ ok: true } | { ok: false; reason: 'no_eval' | 'eval_failed' | 'eval_threshold' }> {
  const cls = decisionClass(classId);
  if (!cls?.eval) return { ok: true };
  const latest = await latestEval(teamId, classId, credentialId);
  if (!latest || latest.status !== 'done') return { ok: false, reason: 'no_eval' };
  const connection = await loadConnection(credentialId);
  if (connection?.backend.id === 'local-logit' && latest.model !== connection.model)
    return { ok: false, reason: 'no_eval' };
  if (!latest.passed) return { ok: false, reason: 'eval_failed' };
  if (
    connection &&
    ['typesafe', 'vercel'].includes(connection.backend.id) &&
    latest.precision !== 1
  )
    return { ok: false, reason: 'eval_failed' };
  if (threshold + 1e-9 < latest.threshold) return { ok: false, reason: 'eval_threshold' };
  return { ok: true };
}

export async function startEval(
  teamId: number,
  classId: string,
  input: { credentialId?: number | null; threshold?: number | null },
  userId: string | null,
): Promise<EvalView> {
  const cls = decisionClass(classId);
  if (!cls) throw new HttpError(404, `Unknown decision class ${classId}.`);
  if (!cls.eval) throw new HttpError(409, 'This class has no eval.');
  const setting = await classSetting(teamId, classId);
  const credentialId = input.credentialId ?? setting.credentialId;
  if (!credentialId) throw new HttpError(409, 'no_connection');
  const connection = await loadConnection(credentialId);
  if (!connection || connection.teamId !== teamId)
    throw new HttpError(400, 'That decision model connection is not one of this team.');
  const calibrated = jevDecisionPolicy(
    classId,
    connection.backend.id,
    input.threshold ?? effectiveThreshold(cls, setting),
    input.threshold ?? setting.threshold,
  );
  const threshold = calibrated.threshold;
  // One eval per class and connection at a time.
  const [busy] = await db
    .select({ id: helenaDecisionEval.id, createdAt: helenaDecisionEval.createdAt })
    .from(helenaDecisionEval)
    .where(
      and(
        eq(helenaDecisionEval.teamId, teamId),
        eq(helenaDecisionEval.classId, classId),
        eq(helenaDecisionEval.credentialId, credentialId),
        isNull(helenaDecisionEval.finishedAt),
      ),
    );
  if (busy && Date.now() - busy.createdAt.getTime() < STALE_MS)
    throw new HttpError(409, 'An eval of this class on this connection is already running.');
  const [row] = await db
    .insert(helenaDecisionEval)
    .values({
      teamId,
      classId,
      credentialId,
      backendLabel: connection.label || connection.backend.id,
      model: connection.model,
      threshold,
      createdByUserId: userId,
    })
    .returning();
  const controller = new AbortController();
  running.set(row!.id, controller);
  void (async () => {
    let report: EvalReport | null = null;
    let error: string | null = null;
    try {
      report = await runDecisionEval(
        {
          ...cls.eval!,
          ...(['typesafe', 'vercel'].includes(connection.backend.id) && { minPrecision: 1 }),
        },
        threshold,
        async (context, questions) => {
          const result = await askConnection(
            evaluationConnection(connection, classId),
            context,
            questions,
            EVAL_TIMEOUT_MS,
            controller.signal,
          );
          return {
            answers: result.answers,
            latencyMs: result.reply.latencyMs,
            inputTokens: result.reply.inputTokens,
            outputTokens: result.reply.outputTokens,
            model: result.reply.model,
          };
        },
        { concurrency: connection.backend.location === 'cloud' ? 4 : 2, signal: controller.signal },
      );
    } catch (failure) {
      error = (failure instanceof Error ? failure.message : String(failure)).slice(0, 300);
    }
    const cost =
      report && connection.backend.providerName !== 'local'
        ? await costOfUsage(report.model ?? connection.model, connection.backend.providerName, {
            inputTokens: report.inputTokens,
            outputTokens: report.outputTokens,
          }).catch(() => null)
        : report
          ? 0
          : null;
    await db
      .update(helenaDecisionEval)
      .set({
        ...(report
          ? {
              model: report.model ?? connection.model,
              questions: report.questions,
              answered: report.answered,
              correct: report.correct,
              correctAnswered: report.correctAnswered,
              precision: report.precision,
              coverage: report.coverage,
              accuracy: report.accuracy,
              passed: report.passed,
              latencyP50Ms: report.latencyP50Ms,
              latencyP95Ms: report.latencyP95Ms,
              inputTokens: report.inputTokens,
              costEur: cost,
              failures: report.failures,
              details: {
                sweep: report.sweep,
                byQuestion: report.byQuestion,
                errors: report.errors.slice(0, 20),
                minPrecision: cls.eval!.minPrecision,
                minCoverage: cls.eval!.minCoverage,
              },
            }
          : {}),
        error: error ?? (report?.errors.length ? `${report.errors.length} cases failed` : null),
        finishedAt: new Date(),
      })
      .where(eq(helenaDecisionEval.id, row!.id))
      .catch((failure: unknown) => console.error('[decisions] eval result not stored', failure));
    running.delete(row!.id);
  })();
  return view(row!);
}

export async function cancelEval(teamId: number, evalId: number): Promise<boolean> {
  const controller = running.get(evalId);
  controller?.abort();
  const updated = await db
    .update(helenaDecisionEval)
    .set({ finishedAt: new Date(), error: 'cancelled' })
    .where(
      and(
        eq(helenaDecisionEval.id, evalId),
        eq(helenaDecisionEval.teamId, teamId),
        isNull(helenaDecisionEval.finishedAt),
      ),
    )
    .returning({ id: helenaDecisionEval.id });
  return updated.length > 0;
}

// Evals a restart cut off are closed as such, so a class can be evaluated again.
export async function closeStaleEvals(): Promise<void> {
  await db
    .update(helenaDecisionEval)
    .set({ finishedAt: new Date(), error: 'interrupted' })
    .where(
      and(
        isNull(helenaDecisionEval.finishedAt),
        lt(helenaDecisionEval.createdAt, new Date(Date.now() - STALE_MS)),
      ),
    );
}
