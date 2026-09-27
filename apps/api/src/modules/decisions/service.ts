import { createHash } from 'node:crypto';
import {
  decisionOptionIds,
  decisionQuestionProblem,
  type DecisionClass,
  type DecisionQuestion,
  type DecisionStatus,
} from '@helena/sdk';
import { readAnswer, toSystemOne } from '@helena/decisions';
import { db, aiAgent, project, helenaDecision, helenaDecisionClassSetting } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import {
  askSystemOne,
  DecisionConnectionError,
  connectionIsLocal,
  loadConnection,
  type DecisionConnection,
  type SystemOneReply,
} from '#modules/browser-task/connection';
import { recordUsage } from '#modules/agents/usage/service';
import { costOfUsage } from '#modules/model-prices/service';
import { decisionClass } from './classes';
import { firstStageChatGuard } from './chat-stage';
import { decisionAttempts } from './attempts';
import { withStageGuard } from './stage-request';
import {
  firstStageCandidate,
  stageStillEnabled,
  stageQuestions,
  stageContext,
  stageCircuitResult,
  FIRST_STAGE_READINESS,
} from './first-stage';

// Every caller receives one typed outcome after the optional first stage and configured
// fallbacks. Only answers marked decided may authorize the caller's existing action path.

export interface DecideRequest {
  teamId: number;
  classId: string;
  // What the questions are about; a string, or an object the backend reads as JSON.
  context: string | Record<string, unknown>;
  // Internal request restriction: may narrow but never relax the class's policy.
  // Not a caller-controlled API setting and never persisted as an owner preference.
  localOnly?: boolean;
  questions: Record<string, DecisionQuestion>;
  subject?: string | null;
  projectId?: number | null;
  agentId?: number | null;
  runId?: number | null;
  chatMessageId?: number | null;
  signal?: AbortSignal;
}

export interface DecidedQuestion {
  choice: string | null;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  // Above the threshold: the caller may act on the choice.
  decided: boolean;
  decisionId: number | null;
}

export interface DecideOutcome {
  // decided: every question above the threshold; unsure: answered, not all of them; else why
  // nothing was answered.
  status: DecisionStatus;
  answers: Record<string, DecidedQuestion>;
  credentialId: number | null;
  backend: string | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costEur: number | null;
  threshold: number;
  error: string | null;
}

export interface ClassSetting {
  enabled: boolean;
  credentialId: number | null;
  fallbackCredentialId: number | null;
  threshold: number | null;
  timeoutMs: number | null;
  storeInput: boolean;
  config: Record<string, unknown>;
}

const DEFAULT_SETTING: ClassSetting = {
  enabled: false,
  credentialId: null,
  fallbackCredentialId: null,
  threshold: null,
  timeoutMs: null,
  storeInput: false,
  config: {},
};

export async function classSetting(teamId: number, classId: string): Promise<ClassSetting> {
  const [row] = await db
    .select()
    .from(helenaDecisionClassSetting)
    .where(
      and(
        eq(helenaDecisionClassSetting.teamId, teamId),
        eq(helenaDecisionClassSetting.classId, classId),
      ),
    );
  if (!row) return DEFAULT_SETTING;
  return {
    enabled: row.enabled,
    credentialId: row.credentialId,
    fallbackCredentialId: row.fallbackCredentialId,
    threshold: row.threshold,
    timeoutMs: row.timeoutMs,
    storeInput: row.storeInput,
    config: (row.config as Record<string, unknown>) ?? {},
  };
}

export function effectiveThreshold(cls: DecisionClass, setting: ClassSetting): number {
  return setting.threshold ?? cls.defaults.threshold;
}

export function effectiveTimeout(cls: DecisionClass, setting: ClassSetting): number {
  return setting.timeoutMs ?? cls.defaults.timeoutMs;
}

// Whether a connection may answer a class right now. Helena's local AI registers a gate
// (its master switch and the "Jev / Laya" switch, hub/local-ai); without one every local
// connection is allowed. Returns why not, or null.
export type DecisionGate = (input: {
  teamId: number;
  classId: string;
  connection: DecisionConnection;
  local: boolean;
}) => Promise<string | null>;

let gate: DecisionGate | null = null;

export function useDecisionGate(next: DecisionGate | null): void {
  gate = next;
}

function checkQuestions(questions: Record<string, DecisionQuestion>): void {
  const ids = Object.keys(questions);
  if (ids.length === 0 || ids.length > 16) throw new HttpError(400, 'Ask 1 to 16 questions.');
  for (const [id, question] of Object.entries(questions)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(id)) throw new HttpError(400, `Invalid question id ${id}.`);
    const problem = decisionQuestionProblem(question);
    if (problem) throw new HttpError(400, `Question ${id}: ${problem}.`);
  }
}

function contextText(context: DecideRequest['context']): string {
  return typeof context === 'string' ? context : JSON.stringify(context);
}

export function inputHash(
  context: DecideRequest['context'],
  questions: Record<string, DecisionQuestion>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ context: contextText(context), questions }))
    .digest('hex');
}

class DecisionTimeout extends Error {}

// One request to a connection under the failsafe: the answer, or a timeout.
export async function withinFailsafe(
  connection: DecisionConnection,
  request: { state: unknown; questions: Record<string, unknown> },
  timeoutMs: number,
  signal?: AbortSignal,
  maxRetries?: 0 | 1,
): Promise<SystemOneReply> {
  if (signal?.aborted) throw new DecisionTimeout('decision request cancelled');
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    rejectAbort(new DecisionTimeout('decision request cancelled'));
    controller.abort();
  };
  signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      askSystemOne(connection, request, controller.signal, { maxRetries }),
      aborted,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new DecisionTimeout(`no answer within ${timeoutMs} ms`));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export interface AskResult {
  reply: SystemOneReply;
  answers: Record<
    string,
    { choice: string; probabilities: Record<string, number>; confidence: number }
  >;
}

// Asks one connection the questions and checks every answer; used by decide() and the evals.
export async function askConnection(
  connection: DecisionConnection,
  context: DecideRequest['context'],
  questions: Record<string, DecisionQuestion>,
  timeoutMs: number,
  signal?: AbortSignal,
  maxRetries?: 0 | 1,
): Promise<AskResult> {
  const reply = await withinFailsafe(
    connection,
    { state: context, questions: toSystemOne(questions) as Record<string, unknown> },
    timeoutMs,
    signal,
    maxRetries,
  );
  const answers: AskResult['answers'] = {};
  for (const [id, question] of Object.entries(questions)) {
    answers[id] = readAnswer(question, reply.answers[id]);
  }
  return { reply, answers };
}

function failureOf(error: unknown): { status: DecisionStatus; message: string } {
  if (error instanceof DecisionTimeout) return { status: 'timeout', message: error.message };
  const message =
    error instanceof DecisionConnectionError
      ? error.message
      : 'The decision stage failed or returned invalid data.';
  return { status: 'error', message: message.slice(0, 300) };
}

// A connection the class may use, or why not.
export async function usableDecisionConnection(
  teamId: number,
  cls: DecisionClass,
  credentialId: number | null,
  localOnly = false,
): Promise<{ connection: DecisionConnection } | { refused: string }> {
  if (!credentialId) return { refused: 'no decision model connection is set for this class' };
  const connection = await loadConnection(credentialId);
  if (!connection || connection.teamId !== teamId)
    return { refused: 'the decision model connection is gone' };
  if (connection.projectId !== null)
    return { refused: 'a decision class needs a connection of the whole team' };
  const local = connectionIsLocal(connection);
  if ((localOnly || cls.input.cloud === 'never') && !local)
    return { refused: 'this class may only be answered on this machine or in the LAN' };
  const why = gate ? await gate({ teamId, classId: cls.id, connection, local }) : null;
  if (why) return { refused: why };
  return { connection };
}

function emptyOutcome(
  status: DecisionStatus,
  questions: Record<string, DecisionQuestion>,
  threshold: number,
  error: string | null,
): DecideOutcome {
  return {
    status,
    answers: Object.fromEntries(
      Object.keys(questions).map((id) => [
        id,
        { choice: null, probabilities: null, confidence: null, decided: false, decisionId: null },
      ]),
    ),
    credentialId: null,
    backend: null,
    model: null,
    latencyMs: null,
    inputTokens: 0,
    outputTokens: 0,
    costEur: null,
    threshold,
    error,
  };
}

async function askFirstStage(
  request: DecideRequest,
  connection: DecisionConnection,
  timeoutMs: number,
  stillEnabled: () => Promise<boolean>,
): Promise<AskResult> {
  return withStageGuard(stillEnabled, request.signal, (signal) =>
    askConnection(
      connection,
      stageContext(request.context, request.questions),
      stageQuestions(request.questions),
      timeoutMs,
      signal,
      0,
    ),
  );
}

// Asks a class's questions. Never throws for the backend: a caller always gets an outcome and
// falls back to its default unless a question came back `decided`. Throws only for a request
// that is wrong in itself (unknown class, malformed questions).
export async function decide(request: DecideRequest): Promise<DecideOutcome> {
  const cls = decisionClass(request.classId);
  if (!cls) throw new HttpError(404, `Unknown decision class ${request.classId}.`);
  checkQuestions(request.questions);
  const setting = await classSetting(request.teamId, cls.id);
  const threshold = effectiveThreshold(cls, setting);
  if (!setting.enabled) return emptyOutcome('off', request.questions, threshold, null);
  const timeoutMs = effectiveTimeout(cls, setting);
  const started = Date.now();
  // Public callers resolve access before this point; internal callers also cannot attach
  // another team's project or agent to a request, an input log or its usage records.
  if (request.projectId) {
    const [scope] = await db
      .select({ teamId: project.teamId })
      .from(project)
      .where(eq(project.id, request.projectId));
    if (scope?.teamId !== request.teamId)
      return emptyOutcome('no_backend', request.questions, threshold, 'Invalid project scope.');
  }
  if (request.agentId) {
    const [scope] = await db
      .select({ teamId: aiAgent.teamId })
      .from(aiAgent)
      .where(eq(aiAgent.id, request.agentId));
    if (scope?.teamId !== request.teamId)
      return emptyOutcome('no_backend', request.questions, threshold, 'Invalid agent scope.');
  }
  const chatAllowsStage = await firstStageChatGuard(request).catch(() => async () => false);
  // A stage-setting or eval lookup failure skips the optimization. The existing path stays.
  const stage =
    !request.localOnly &&
    (await chatAllowsStage().catch(() => false)) &&
    JSON.stringify({ context: request.context, questions: request.questions }).length <= 16000
      ? await firstStageCandidate(request.teamId, cls.id, threshold).catch(() => null)
      : null;
  const stillEnabled = async (credentialId: number) =>
    (await chatAllowsStage()) &&
    (await stageStillEnabled(request.teamId, cls.id, credentialId, stage?.policy.revision));
  const attempts = decisionAttempts(
    stage?.connection.credentialId,
    setting.credentialId,
    setting.fallbackCredentialId,
  );
  let partial: DecideOutcome | null = null;
  let partialIsStage = false;
  let last: { status: DecisionStatus; message: string; connection: DecisionConnection | null } = {
    status: 'no_backend',
    message: 'no decision model connection is set for this class',
    connection: null,
  };
  for (const [index, { credentialId, role }] of attempts.entries()) {
    if (request.signal?.aborted) break;
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining < 50) break;
    const isStage = role === 'first-stage';
    let connection: DecisionConnection | null = null;
    try {
      const found = await usableDecisionConnection(
        request.teamId,
        cls,
        credentialId,
        request.localOnly,
      );
      if ('refused' in found) {
        last = { status: 'no_backend', message: found.refused, connection: null };
        continue;
      }
      connection = found.connection;
      // Reserve a share of the same total time budget for each remaining attempt.
      const share = Math.max(1, Math.floor(remaining / (attempts.length - index)));
      const budget = isStage ? Math.min(share, stage!.policy.timeoutMs) : share;
      const result = isStage
        ? await askFirstStage(request, connection, budget, () => stillEnabled(credentialId))
        : await askConnection(
            connection,
            request.context,
            request.questions,
            budget,
            request.signal,
            0,
          );
      if (isStage && !(await stillEnabled(credentialId))) continue;
      const readiness = result.answers[FIRST_STAGE_READINESS];
      const semanticEscalation = Boolean(
        isStage && (readiness?.choice !== 'ready' || readiness.confidence < threshold),
      );
      const outcome = await record(
        request,
        cls,
        setting,
        connection,
        threshold,
        result,
        semanticEscalation,
      );
      if (isStage) {
        stageCircuitResult(request.teamId, credentialId, true);
        if (!(await stillEnabled(credentialId))) continue;
      }
      if (outcome.status === 'decided') return outcome;
      partial = outcome;
      partialIsStage = isStage;
    } catch (error) {
      const failure = failureOf(error);
      last = { ...failure, connection };
      if (isStage) {
        if (await stillEnabled(credentialId).catch(() => false))
          stageCircuitResult(request.teamId, credentialId, false);
      }
      if (connection) {
        const failed = emptyOutcome(last.status, request.questions, threshold, last.message);
        failed.credentialId = credentialId;
        failed.backend = connection.backend.id;
        failed.latencyMs = Date.now() - started;
        await logFailure(request, cls, setting, threshold, connection, failed);
      }
    }
  }
  if (
    partial &&
    (!partialIsStage || (await stillEnabled(partial.credentialId!).catch(() => false)))
  )
    return partial;
  const outcome = emptyOutcome(last.status, request.questions, threshold, last.message);
  outcome.credentialId = last.connection?.credentialId ?? null;
  outcome.backend = last.connection?.backend.id ?? null;
  outcome.latencyMs = Date.now() - started;
  return outcome;
}

async function costOf(connection: DecisionConnection, reply: SystemOneReply) {
  if (connection.backend.providerName === 'local') return 0;
  return costOfUsage(reply.model ?? connection.model, connection.backend.providerName, {
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
  }).catch(() => null);
}

function storedInput(
  cls: DecisionClass,
  setting: ClassSetting,
  request: DecideRequest,
  question: DecisionQuestion,
): string | null {
  if (cls.input.store !== 'optional' || !setting.storeInput) return null;
  return `${question.question}\n\n${contextText(request.context)}`.slice(0, 8000);
}

async function record(
  request: DecideRequest,
  cls: DecisionClass,
  setting: ClassSetting,
  connection: DecisionConnection,
  threshold: number,
  result: AskResult,
  forceUnsure = false,
): Promise<DecideOutcome> {
  const { reply } = result;
  const cost = await costOf(connection, reply);
  const hash = inputHash(request.context, request.questions);
  const ids = Object.keys(request.questions);
  const answers: DecideOutcome['answers'] = {};
  // Tokens and cost belong to the request; the first question's row carries them.
  const rows = await db
    .insert(helenaDecision)
    .values(
      ids.map((id, index) => {
        const answer = result.answers[id]!;
        const question = request.questions[id]!;
        return {
          teamId: request.teamId,
          projectId: request.projectId ?? null,
          agentId: request.agentId ?? null,
          runId: request.runId ?? null,
          chatMessageId: request.chatMessageId ?? null,
          classId: cls.id,
          subject: request.subject?.slice(0, 200) ?? null,
          questionId: id,
          kind: question.kind,
          options: decisionOptionIds(question),
          ...wordingOf(question),
          choice: answer.choice,
          probabilities: answer.probabilities,
          confidence: answer.confidence,
          threshold,
          status: (!forceUnsure &&
          answer.confidence >= threshold &&
          !['uncertain', 'unsure'].includes(answer.choice)
            ? 'decided'
            : 'unsure') as DecisionStatus,
          credentialId: connection.credentialId,
          backend: connection.backend.id,
          model: reply.model ?? connection.model,
          latencyMs: reply.latencyMs,
          inputTokens: index === 0 ? reply.inputTokens : 0,
          outputTokens: index === 0 ? reply.outputTokens : 0,
          costEur: index === 0 ? cost : null,
          inputHash: hash,
          inputText: storedInput(cls, setting, request, question),
        };
      }),
    )
    .returning({ id: helenaDecision.id, questionId: helenaDecision.questionId });
  for (const id of ids) {
    const answer = result.answers[id]!;
    answers[id] = {
      choice: answer.choice,
      probabilities: answer.probabilities,
      confidence: answer.confidence,
      decided:
        !forceUnsure &&
        answer.confidence >= threshold &&
        !['uncertain', 'unsure'].includes(answer.choice),
      decisionId: rows.find((row) => row.questionId === id)?.id ?? null,
    };
  }
  if (request.agentId) {
    await recordUsage({
      agentId: request.agentId,
      projectId: request.projectId ?? null,
      runId: request.runId ?? null,
      chatMessageId: request.chatMessageId ?? null,
      kind: 'tool',
      spend: {
        runtime: 'decisions',
        model: reply.model ?? connection.model,
        provider: connection.backend.providerName,
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
        durationMs: reply.latencyMs,
      },
    }).catch(() => {});
  }
  const all = Object.values(answers).every((answer) => answer.decided);
  return {
    status: all ? 'decided' : 'unsure',
    answers,
    credentialId: connection.credentialId,
    backend: connection.backend.id,
    model: reply.model ?? connection.model,
    latencyMs: reply.latencyMs,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
    costEur: cost,
    threshold,
    error: null,
  };
}

// The question and the option labels as the log keeps them.
function wordingOf(question: DecisionQuestion): {
  question: string;
  optionLabels: Record<string, string> | null;
} {
  return {
    question: question.question.slice(0, 1000),
    optionLabels:
      question.kind === 'choice'
        ? Object.fromEntries(
            (question.options ?? []).map((option) => [option.id, option.label.slice(0, 300)]),
          )
        : null,
  };
}

async function logFailure(
  request: DecideRequest,
  cls: DecisionClass,
  setting: ClassSetting,
  threshold: number,
  connection: DecisionConnection,
  outcome: DecideOutcome,
): Promise<void> {
  const hash = inputHash(request.context, request.questions);
  const rows = await db
    .insert(helenaDecision)
    .values(
      Object.entries(request.questions).map(([id, question]) => ({
        teamId: request.teamId,
        projectId: request.projectId ?? null,
        agentId: request.agentId ?? null,
        runId: request.runId ?? null,
        chatMessageId: request.chatMessageId ?? null,
        classId: cls.id,
        subject: request.subject?.slice(0, 200) ?? null,
        questionId: id,
        kind: question.kind,
        options: decisionOptionIds(question),
        ...wordingOf(question),
        threshold,
        status: outcome.status,
        credentialId: connection.credentialId,
        backend: connection.backend.id,
        model: connection.model,
        latencyMs: outcome.latencyMs,
        error: outcome.error,
        inputHash: hash,
        inputText: storedInput(cls, setting, request, question),
      })),
    )
    .returning({ id: helenaDecision.id, questionId: helenaDecision.questionId })
    .catch(() => [] as { id: number; questionId: string }[]);
  for (const row of rows) {
    const answer = outcome.answers[row.questionId];
    if (answer) answer.decisionId = row.id;
  }
}

// The right answer of a logged decision, once known: the owner's correction, or what the
// caller learned later (the transaction a receipt was confirmed with).
export async function recordOutcome(
  teamId: number,
  decisionId: number,
  outcome: string,
  source: 'owner' | 'caller',
): Promise<boolean> {
  const [row] = await db
    .select({ options: helenaDecision.options })
    .from(helenaDecision)
    .where(and(eq(helenaDecision.id, decisionId), eq(helenaDecision.teamId, teamId)));
  if (!row) return false;
  if (!(row.options as string[]).includes(outcome))
    throw new HttpError(400, 'The outcome must be one of the options the decision had.');
  await db
    .update(helenaDecision)
    .set({ outcome, outcomeSource: source, outcomeAt: new Date() })
    .where(eq(helenaDecision.id, decisionId));
  return true;
}
