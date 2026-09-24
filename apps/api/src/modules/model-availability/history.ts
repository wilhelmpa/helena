// What the runs and chat answers from before model availability already showed: a failed run
// or answer whose provider refused its model gets its failure, and the model is recorded as
// unavailable (scripts/learn-model-availability.ts runs it once, after the switch).

import { classifyProviderFailure, type RuntimeFailure } from '@helena/sdk';
import { agentChatCatalog, agentChatMessage, agentRun, aiAgent, db } from '@repo/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { ModelCheck } from '#modules/agents/runtime-sync/model-check';
import { recordModelUnavailable, runtimeOfPolicy } from './service';

// The provider the agent's runner lists the model under.
async function providerOf(agentId: number, model: string): Promise<string> {
  const [row] = await db
    .select({ models: agentChatCatalog.models })
    .from(agentChatCatalog)
    .where(eq(agentChatCatalog.agentId, agentId));
  const found = ((row?.models as { id: string; provider?: string }[] | null) ?? []).find(
    (entry) => entry.id === model,
  );
  return found?.provider ?? '';
}

interface Failed {
  kind: 'run' | 'chat';
  id: number;
  agentId: number;
  runtimePolicy: unknown;
  output: string | null;
  lastError: string | null;
  // The model the run was set to, as it recorded it.
  model: string | null;
}

async function failedWork(days: number): Promise<Failed[]> {
  const since = sql`now() - make_interval(days => ${days})`;
  const runs = await db
    .select({
      id: agentRun.id,
      agentId: agentRun.agentId,
      runtimePolicy: aiAgent.runtimePolicy,
      output: agentRun.output,
      lastError: agentRun.lastError,
      runModel: agentRun.model,
      modelCheck: agentRun.modelCheck,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .where(
      and(eq(agentRun.status, 'failed'), isNull(agentRun.failure), gt(agentRun.createdAt, since)),
    );
  const answers = await db
    .select({
      id: agentChatMessage.id,
      agentId: agentChatMessage.agentId,
      runtimePolicy: aiAgent.runtimePolicy,
      lastError: agentChatMessage.lastError,
      model: agentChatMessage.model,
      modelCheck: agentChatMessage.modelCheck,
    })
    .from(agentChatMessage)
    .innerJoin(aiAgent, eq(aiAgent.id, agentChatMessage.agentId))
    .where(
      and(
        eq(agentChatMessage.status, 'failed'),
        isNull(agentChatMessage.failure),
        gt(agentChatMessage.createdAt, since),
      ),
    );
  const configured = (check: unknown) => (check as ModelCheck | null)?.configured.model ?? null;
  return [
    ...runs.map((row) => ({
      kind: 'run' as const,
      id: row.id,
      agentId: row.agentId,
      runtimePolicy: row.runtimePolicy,
      output: row.output,
      lastError: row.lastError,
      model: row.runModel ?? configured(row.modelCheck),
    })),
    ...answers
      .filter((row) => row.agentId != null)
      .map((row) => ({
        kind: 'chat' as const,
        id: row.id,
        agentId: row.agentId!,
        runtimePolicy: row.runtimePolicy,
        output: null,
        lastError: row.lastError,
        model: configured(row.modelCheck) ?? row.model,
      })),
  ];
}

// Reads the failed runs and answers of the last `days` days; with `apply`, records what
// they show. Answers the lines it printed, for the caller to show.
export async function learnFromHistory(options: {
  days: number;
  apply: boolean;
  log?: (line: string) => void;
}): Promise<{ read: number; refused: number }> {
  const { days, apply } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const work = await failedWork(days);
  let found = 0;
  for (const item of work) {
    const failure: RuntimeFailure | null = classifyProviderFailure({
      output: item.output ?? '',
      error: item.lastError,
    });
    if (!failure || failure.code !== 'model-unavailable') continue;
    const model = item.model ?? failure.model ?? null;
    if (!model) continue;
    found++;
    const runtime = runtimeOfPolicy(item.runtimePolicy);
    const provider = await providerOf(item.agentId, model);
    log(
      `${apply ? 'learn' : 'would learn'}: ${item.kind} ${item.id} of agent ${item.agentId}: ` +
        `${runtime}/${provider || '-'} ${model} unavailable (${failure.detail ?? ''})`,
    );
    if (!apply) continue;
    if (item.kind === 'run')
      await db.update(agentRun).set({ failure }).where(eq(agentRun.id, item.id));
    else await db.update(agentChatMessage).set({ failure }).where(eq(agentChatMessage.id, item.id));
    await recordModelUnavailable(
      { runtime, provider, model },
      {
        agentId: item.agentId,
        ...(item.kind === 'run' ? { runId: item.id } : { chatMessageId: item.id }),
      },
      failure,
    );
  }
  log(
    `${work.length} failed runs and answers of the last ${days} days read, ${found} refused a model` +
      (apply ? '' : ' (dry run: nothing written)'),
  );
  return { read: work.length, refused: found };
}
