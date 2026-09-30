import { db, helenaLocalAiEval, helenaModelServer } from '@repo/db';
import { classEvalVersion, type LocalAiEvalResult, type LocalAiTaskClass } from '@helena/sdk';

export async function storeCliEval(input: {
  baseUrl: string;
  model: string;
  entry: LocalAiTaskClass;
  result: LocalAiEvalResult;
  ranAt: Date;
}): Promise<boolean> {
  if (
    !Number.isFinite(input.result.score) ||
    input.result.score < 0 ||
    input.result.score > 1 ||
    input.result.cases.length === 0
  )
    return false;
  const servers = await db
    .select({ id: helenaModelServer.id, baseUrl: helenaModelServer.baseUrl })
    .from(helenaModelServer);
  const base = input.baseUrl.replace(/\/+$/, '');
  const matches = servers.filter((server) => server.baseUrl.replace(/\/+$/, '') === base);
  if (matches.length !== 1) return false;
  const threshold = input.entry.threshold ?? 0.8;
  await db.insert(helenaLocalAiEval).values({
    serverId: matches[0]!.id,
    model: input.model,
    classId: input.entry.id,
    evalVersion: classEvalVersion(input.entry),
    score: input.result.score,
    threshold,
    passed: input.result.score >= threshold,
    cases: input.result.cases.length,
    details: input.result.cases
      .filter((item) => !item.passed)
      .slice(0, 20)
      .map((item) => ({ id: item.id, detail: item.detail?.slice(0, 200) ?? null })),
    latencyMsP50: input.result.latencyMsP50 === null ? null : Math.round(input.result.latencyMsP50),
    tokensPerSecond: input.result.tokensPerSecond,
    status: 'done',
    ranAt: input.ranAt,
    finishedAt: new Date(),
  });
  return true;
}
