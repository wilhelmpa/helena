import type { DecisionClass, LocalizedText } from '@helena/sdk';
import {
  db,
  helenaDecision,
  helenaDecisionClassSetting,
  integrationCredential,
  project,
} from '@repo/db';
import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { connectionIsLocal, loadConnection } from '#modules/browser-task/connection';
import { decisionClass, decisionClasses } from './classes';
import { evalAllows, latestEval, type EvalView } from './evals-runner';
import { classSetting, effectiveThreshold, effectiveTimeout } from './service';

// The settings of the decision classes (Administrator → Entscheidungen): which connection
// answers each class, its threshold and failsafe, whether the log keeps the input, the
// class's own options, and switching it on — only after its eval passed on that connection.

export interface ConnectionOption {
  id: number;
  label: string;
  provider: string;
  model: string;
  local: boolean;
  projectKey: string | null;
  status: string | null;
}

export async function decisionConnections(teamId: number): Promise<ConnectionOption[]> {
  const rows = await db
    .select({
      id: integrationCredential.id,
      label: integrationCredential.label,
      status: integrationCredential.status,
      projectKey: project.key,
    })
    .from(integrationCredential)
    .leftJoin(project, eq(project.id, integrationCredential.projectId))
    .where(
      and(
        eq(integrationCredential.teamId, teamId),
        eq(integrationCredential.integrationKey, 'decision_model'),
      ),
    )
    .orderBy(integrationCredential.id);
  const options: ConnectionOption[] = [];
  for (const row of rows) {
    const connection = await loadConnection(row.id);
    if (!connection) continue;
    options.push({
      id: row.id,
      label: row.label || connection.backend.id,
      provider: connection.backend.id,
      model: connection.model,
      local: connectionIsLocal(connection),
      projectKey: row.projectKey,
      status: row.status,
    });
  }
  return options;
}

export interface ClassStats {
  total: number;
  decided: number;
  unsure: number;
  failed: number;
  corrected: number;
  wrong: number;
  latencyP50Ms: number | null;
  costEur: number;
}

async function statsOf(teamId: number, since: Date): Promise<Map<string, ClassStats>> {
  const rows = await db
    .select({
      classId: helenaDecision.classId,
      total: sql<number>`count(*)::int`,
      decided: sql<number>`count(*) filter (where ${helenaDecision.status} = 'decided')::int`,
      unsure: sql<number>`count(*) filter (where ${helenaDecision.status} = 'unsure')::int`,
      failed: sql<number>`count(*) filter (where ${helenaDecision.status} in ('timeout', 'error', 'no_backend'))::int`,
      corrected: sql<number>`count(*) filter (where ${helenaDecision.outcome} is not null)::int`,
      wrong: sql<number>`count(*) filter (where ${helenaDecision.outcome} is not null and ${helenaDecision.outcome} <> ${helenaDecision.choice})::int`,
      latency: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${helenaDecision.latencyMs})`,
      cost: sql<number>`coalesce(sum(${helenaDecision.costEur}), 0)::float8`,
    })
    .from(helenaDecision)
    .where(and(eq(helenaDecision.teamId, teamId), gte(helenaDecision.createdAt, since)))
    .groupBy(helenaDecision.classId);
  return new Map(
    rows.map((row) => [
      row.classId,
      {
        total: row.total,
        decided: row.decided,
        unsure: row.unsure,
        failed: row.failed,
        corrected: row.corrected,
        wrong: row.wrong,
        latencyP50Ms: row.latency === null ? null : Math.round(Number(row.latency)),
        costEur: Number(row.cost) || 0,
      },
    ]),
  );
}

export interface ClassView {
  id: string;
  label: LocalizedText;
  description: LocalizedText | null;
  input: DecisionClass['input'];
  defaults: DecisionClass['defaults'];
  eval: { cases: number; minPrecision: number; minCoverage: number } | null;
  setting: {
    enabled: boolean;
    credentialId: number | null;
    fallbackCredentialId: number | null;
    threshold: number;
    thresholdCustom: number | null;
    timeoutMs: number;
    timeoutCustom: number | null;
    storeInput: boolean;
    config: Record<string, unknown>;
  };
  latestEval: EvalView | null;
  canEnable: { ok: boolean; reason: string | null };
  stats: ClassStats;
}

const EMPTY_STATS: ClassStats = {
  total: 0,
  decided: 0,
  unsure: 0,
  failed: 0,
  corrected: 0,
  wrong: 0,
  latencyP50Ms: null,
  costEur: 0,
};

async function classView(
  teamId: number,
  cls: DecisionClass,
  stats: Map<string, ClassStats>,
): Promise<ClassView> {
  const setting = await classSetting(teamId, cls.id);
  const threshold = effectiveThreshold(cls, setting);
  const latest = setting.credentialId
    ? await latestEval(teamId, cls.id, setting.credentialId)
    : null;
  const allowed = setting.credentialId
    ? await evalAllows(teamId, cls.id, setting.credentialId, threshold)
    : ({ ok: false, reason: 'no_connection' } as const);
  return {
    id: cls.id,
    label: cls.label,
    description: cls.description ?? null,
    input: cls.input,
    defaults: cls.defaults,
    eval: cls.eval
      ? {
          cases: cls.eval.cases.length,
          minPrecision: cls.eval.minPrecision,
          minCoverage: cls.eval.minCoverage,
        }
      : null,
    setting: {
      enabled: setting.enabled,
      credentialId: setting.credentialId,
      fallbackCredentialId: setting.fallbackCredentialId,
      threshold,
      thresholdCustom: setting.threshold,
      timeoutMs: effectiveTimeout(cls, setting),
      timeoutCustom: setting.timeoutMs,
      storeInput: setting.storeInput,
      config: setting.config,
    },
    latestEval: latest,
    canEnable: allowed.ok ? { ok: true, reason: null } : { ok: false, reason: allowed.reason },
    stats: stats.get(cls.id) ?? EMPTY_STATS,
  };
}

export async function listClassViews(teamId: number): Promise<ClassView[]> {
  const stats = await statsOf(teamId, new Date(Date.now() - 7 * 86_400_000));
  return Promise.all(decisionClasses().map((cls) => classView(teamId, cls, stats)));
}

export async function getClassView(teamId: number, classId: string): Promise<ClassView> {
  const cls = decisionClass(classId);
  if (!cls) throw new HttpError(404, `Unknown decision class ${classId}.`);
  const stats = await statsOf(teamId, new Date(Date.now() - 7 * 86_400_000));
  return classView(teamId, cls, stats);
}

export interface ClassSettingPatch {
  enabled?: boolean;
  credentialId?: number | null;
  fallbackCredentialId?: number | null;
  threshold?: number | null;
  timeoutMs?: number | null;
  storeInput?: boolean;
  config?: Record<string, unknown>;
}

// A class's own settings are checked by the feature that owns them (the mail classifier's
// actions, the router's options); registered here so this module does not import them.
const configCheckers = new Map<
  string,
  (config: Record<string, unknown>, teamId: number) => Promise<Record<string, unknown>>
>();

export function useClassConfigChecker(
  classId: string,
  check: (config: Record<string, unknown>, teamId: number) => Promise<Record<string, unknown>>,
): void {
  configCheckers.set(classId, check);
}

async function assertConnection(
  teamId: number,
  cls: DecisionClass,
  credentialId: number | null | undefined,
): Promise<void> {
  if (credentialId === null || credentialId === undefined) return;
  const connection = await loadConnection(credentialId);
  if (!connection || connection.teamId !== teamId)
    throw new HttpError(400, 'That decision model connection is not one of this team.');
  if (connection.projectId !== null)
    throw new HttpError(400, 'A decision class needs a connection of the whole team.');
  if (cls.input.cloud === 'never' && !connectionIsLocal(connection))
    throw new HttpError(400, 'This class may only be answered on this machine or in the LAN.');
}

export async function updateClassSetting(
  teamId: number,
  classId: string,
  patch: ClassSettingPatch,
  userId: string | null,
): Promise<ClassView> {
  const cls = decisionClass(classId);
  if (!cls) throw new HttpError(404, `Unknown decision class ${classId}.`);
  const current = await classSetting(teamId, classId);
  await assertConnection(teamId, cls, patch.credentialId);
  await assertConnection(teamId, cls, patch.fallbackCredentialId);
  if (patch.storeInput && cls.input.store === 'never')
    throw new HttpError(400, 'This class never keeps its input.');
  const next = {
    enabled: patch.enabled ?? current.enabled,
    credentialId: patch.credentialId === undefined ? current.credentialId : patch.credentialId,
    fallbackCredentialId:
      patch.fallbackCredentialId === undefined
        ? current.fallbackCredentialId
        : patch.fallbackCredentialId,
    threshold: patch.threshold === undefined ? current.threshold : patch.threshold,
    timeoutMs: patch.timeoutMs === undefined ? current.timeoutMs : patch.timeoutMs,
    storeInput: patch.storeInput ?? current.storeInput,
    config:
      patch.config === undefined
        ? current.config
        : await (configCheckers.get(classId) ?? (async (config) => config))(patch.config, teamId),
  };
  if (next.enabled) {
    if (!next.credentialId) throw new HttpError(409, 'no_connection');
    const threshold = next.threshold ?? cls.defaults.threshold;
    const allowed = await evalAllows(teamId, classId, next.credentialId, threshold);
    if (!allowed.ok) {
      // Switching on needs the eval; a change of connection or threshold that the eval does
      // not cover switches the class off instead of refusing the change.
      if (patch.enabled === true) throw new HttpError(409, allowed.reason);
      next.enabled = false;
    }
  }
  await db
    .insert(helenaDecisionClassSetting)
    .values({ teamId, classId, ...next, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: [helenaDecisionClassSetting.teamId, helenaDecisionClassSetting.classId],
      set: { ...next, updatedByUserId: userId, updatedAt: new Date() },
    });
  return getClassView(teamId, classId);
}

export interface DecisionLogEntry {
  id: number;
  classId: string;
  subject: string | null;
  questionId: string;
  kind: string;
  options: string[];
  question: string | null;
  optionLabels: Record<string, string> | null;
  choice: string | null;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  threshold: number;
  status: string;
  backend: string | null;
  connection: string | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number;
  costEur: number | null;
  error: string | null;
  inputText: string | null;
  outcome: string | null;
  outcomeSource: string | null;
  projectKey: string | null;
  agentId: number | null;
  createdAt: string;
}

export async function listDecisions(
  teamId: number,
  query: {
    classId?: string;
    status?: string;
    before?: number;
    limit?: number;
    subject?: string;
    projectKey?: string;
    projectIds?: number[];
    from?: Date;
    to?: Date;
  },
): Promise<{ items: DecisionLogEntry[]; nextBefore: number | null }> {
  if (query.projectIds?.length === 0) return { items: [], nextBefore: null };
  const limit = Math.max(1, Math.min(200, query.limit ?? 50));
  const rows = await db
    .select({
      decision: helenaDecision,
      projectKey: project.key,
      connection: integrationCredential.label,
    })
    .from(helenaDecision)
    .leftJoin(project, eq(project.id, helenaDecision.projectId))
    .leftJoin(integrationCredential, eq(integrationCredential.id, helenaDecision.credentialId))
    .where(
      and(
        eq(helenaDecision.teamId, teamId),
        query.classId ? eq(helenaDecision.classId, query.classId) : undefined,
        query.status ? eq(helenaDecision.status, query.status) : undefined,
        query.subject ? eq(helenaDecision.subject, query.subject) : undefined,
        query.before ? lt(helenaDecision.id, query.before) : undefined,
        query.projectKey ? eq(project.key, query.projectKey) : undefined,
        query.projectIds ? inArray(helenaDecision.projectId, query.projectIds) : undefined,
        query.from ? gte(helenaDecision.createdAt, query.from) : undefined,
        query.to ? lte(helenaDecision.createdAt, query.to) : undefined,
      ),
    )
    .orderBy(desc(helenaDecision.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map(({ decision: row, projectKey, connection }) => ({
      id: row.id,
      classId: row.classId,
      subject: row.subject,
      questionId: row.questionId,
      kind: row.kind,
      options: row.options,
      question: row.question,
      optionLabels: row.optionLabels,
      choice: row.choice,
      probabilities: row.probabilities,
      confidence: row.confidence,
      threshold: row.threshold,
      status: row.status,
      backend: row.backend,
      connection,
      model: row.model,
      latencyMs: row.latencyMs,
      inputTokens: row.inputTokens,
      costEur: row.costEur,
      error: row.error,
      inputText: row.inputText,
      outcome: row.outcome,
      outcomeSource: row.outcomeSource,
      projectKey,
      agentId: row.agentId,
      createdAt: iso(row.createdAt),
    })),
    nextBefore: rows.length > limit ? page[page.length - 1]!.decision.id : null,
  };
}
