import { aiAgent, db, helenaModelAvailability, user } from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RuntimeFailure } from '@helena/sdk';
import { iso } from '#shared/lib';
import type { RunModelReport } from '#modules/agents/runtime-sync/model-check';
import { sameModel } from '#modules/agents/runtime-sync/model-check';

// Which models the agents' providers really serve this installation
// (docs/helena-decisions/model-availability.md). A runtime's catalog lists what its provider
// offers, and Hermes adds newer models it expects to work; only a use tells. A refusal
// ("not supported when using Codex with a ChatGPT account") is recorded as 'unavailable' and
// takes the model out of the pickers; a success records 'works', which clears a refusal and
// confirms a model the account's own list does not name. The owner can clear a finding, so
// the next use tries the model again.

export type ModelState = 'unavailable' | 'works';

// The model as a runtime reached it: Claude Code and Codex sign in with logins of their own,
// so a finding of one runtime says nothing about the others.
export interface ModelRoute {
  runtime: string;
  provider: string;
  model: string;
}

export type ModelAvailabilityRow = typeof helenaModelAvailability.$inferSelect;

// A 'works' already on record is seen again at most this often, so a busy agent does not
// write a row with every answer.
const WORKS_REFRESH = sql`interval '1 hour'`;
const DETAIL_LIMIT = 500;

// The runtime an agent runs on: its runtime policy's, Hermes when it names none.
export function runtimeOfPolicy(policy: unknown): string {
  const runtime =
    policy && typeof policy === 'object' ? (policy as { runtime?: unknown }).runtime : undefined;
  return typeof runtime === 'string' && runtime.trim() ? runtime.trim() : 'hermes';
}

// The model a run or chat answer ran on, and where: what the runner asked the runtime for,
// else what the session used, else the runtime's default; the provider the runner routed it
// to. Null when the runner reported none of it.
export function routeOf(
  runtime: string,
  report: RunModelReport | undefined,
  failure?: Pick<RuntimeFailure, 'model'> | null,
): ModelRoute | null {
  const model =
    report?.requested.model ??
    report?.used?.model ??
    report?.defaults?.model ??
    failure?.model ??
    null;
  if (!model?.trim()) return null;
  const provider =
    report?.requested.provider ?? report?.used?.provider ?? report?.defaults?.provider ?? '';
  return { runtime, provider: provider.trim(), model: model.trim() };
}

function clipDetail(detail: string | null | undefined): string | null {
  const value = detail?.replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.length > DETAIL_LIMIT ? `${value.slice(0, DETAIL_LIMIT - 1)}…` : value;
}

export interface ModelSource {
  agentId: number;
  runId?: number | null;
  chatMessageId?: number | null;
}

// Records that the provider refused the model for this account. Seen again, only the time
// it was last seen (and the provider's words) move; the time it began stays.
export async function recordModelUnavailable(
  route: ModelRoute,
  source: ModelSource,
  failure: Pick<RuntimeFailure, 'code' | 'detail'>,
): Promise<void> {
  const values = {
    ...route,
    state: 'unavailable' as const,
    reason: failure.code,
    detail: clipDetail(failure.detail),
    agentId: source.agentId,
    runId: source.runId ?? null,
    chatMessageId: source.chatMessageId ?? null,
  };
  await db
    .insert(helenaModelAvailability)
    .values(values)
    .onConflictDoUpdate({
      target: [
        helenaModelAvailability.runtime,
        helenaModelAvailability.provider,
        helenaModelAvailability.model,
      ],
      set: {
        state: 'unavailable',
        reason: values.reason,
        detail: values.detail,
        agentId: values.agentId,
        runId: values.runId,
        chatMessageId: values.chatMessageId,
        since: sql`CASE WHEN ${helenaModelAvailability.state} = 'unavailable' THEN ${helenaModelAvailability.since} ELSE now() END`,
        observedAt: sql`now()`,
      },
    });
}

// Records that the model served a run or chat answer: a refusal on record is cleared, and a
// model the account's list does not name counts as confirmed.
export async function recordModelWorks(route: ModelRoute, source: ModelSource): Promise<void> {
  await db
    .insert(helenaModelAvailability)
    .values({
      ...route,
      state: 'works',
      agentId: source.agentId,
      runId: source.runId ?? null,
      chatMessageId: source.chatMessageId ?? null,
    })
    .onConflictDoUpdate({
      target: [
        helenaModelAvailability.runtime,
        helenaModelAvailability.provider,
        helenaModelAvailability.model,
      ],
      set: {
        state: 'works',
        reason: null,
        detail: null,
        agentId: source.agentId,
        runId: source.runId ?? null,
        chatMessageId: source.chatMessageId ?? null,
        since: sql`CASE WHEN ${helenaModelAvailability.state} = 'works' THEN ${helenaModelAvailability.since} ELSE now() END`,
        observedAt: sql`now()`,
      },
      setWhere: sql`${helenaModelAvailability.state} <> 'works' OR ${helenaModelAvailability.observedAt} < now() - ${WORKS_REFRESH}`,
    });
}

// What a finished run or chat answer teaches about its model. A refusal of the model is
// recorded; a success is recorded for the model that really ran, and only when it is the
// one asked for (a fallback model that answered says nothing about the one that did not).
// Never fails the report it is part of.
export async function learnFromOutcome(input: {
  runtime: string;
  report: RunModelReport | undefined;
  status: 'success' | 'failed';
  failure?: RuntimeFailure | null;
  source: ModelSource;
}): Promise<void> {
  try {
    if (input.status === 'failed') {
      if (input.failure?.code !== 'model-unavailable') return;
      const route = routeOf(input.runtime, input.report, input.failure);
      if (route) await recordModelUnavailable(route, input.source, input.failure);
      return;
    }
    const report = input.report;
    if (!report) return;
    const asked = report.requested.model;
    const used = report.used?.model ?? null;
    if (asked && used && !sameModel(asked, used)) return;
    const route = routeOf(input.runtime, report);
    if (route) await recordModelWorks(route, input.source);
  } catch (error) {
    console.error('[model-availability] recording the outcome failed', error);
  }
}

// What is known, for the pickers and the checks: the refusal or success on record for a
// model under a runtime. A model the catalog names as a variant of another (a larger
// context window of it) shares that one's finding unless it has one of its own; the
// provider has to match where both name one.
export class ModelAvailabilityIndex {
  constructor(readonly rows: ModelAvailabilityRow[]) {}

  private own(runtime: string, model: string, provider?: string | null) {
    return this.rows.find(
      (row) =>
        row.runtime === runtime &&
        row.model === model &&
        (!provider || !row.provider || row.provider === provider),
    );
  }

  find(
    runtime: string,
    model: string,
    provider?: string | null,
    variantOf?: string | null,
  ): ModelAvailabilityRow | undefined {
    return (
      this.own(runtime, model, provider) ??
      (variantOf ? this.own(runtime, variantOf, provider) : undefined)
    );
  }

  refusal(
    runtime: string,
    model: string | null | undefined,
    provider?: string | null,
    variantOf?: string | null,
  ): ModelAvailabilityRow | undefined {
    if (!model) return undefined;
    const row = this.find(runtime, model, provider, variantOf);
    return row?.state === 'unavailable' ? row : undefined;
  }
}

export async function loadModelAvailability(): Promise<ModelAvailabilityIndex> {
  return new ModelAvailabilityIndex(await db.select().from(helenaModelAvailability));
}

// A model of a runner's catalog, as far as this module reads it.
export interface CatalogModelLike {
  id: string;
  provider?: string;
  listed?: boolean;
  variantOf?: string;
}

export interface UnavailableCatalogModel {
  id: string;
  provider?: string;
  detail: string | null;
  since: string;
  // The finding behind it, which "Erneut prüfen" forgets.
  findingId: number;
}

// The catalog as an agent's pickers see it: a model its provider refused is left out (and
// named apart, so the editor can say why the agent's own model is missing), and every other
// one says whether it is confirmed: listed by the account or seen working (true), only
// expected to work by the runtime (false), or unknown (left out).
export function annotateCatalog<T extends CatalogModelLike>(
  models: T[],
  runtime: string,
  index: ModelAvailabilityIndex,
): { models: (T & { verified?: boolean })[]; unavailable: UnavailableCatalogModel[] } {
  const available: (T & { verified?: boolean })[] = [];
  const unavailable: UnavailableCatalogModel[] = [];
  for (const model of models) {
    const row = index.find(runtime, model.id, model.provider, model.variantOf);
    if (row?.state === 'unavailable') {
      unavailable.push({
        id: model.id,
        ...(model.provider ? { provider: model.provider } : {}),
        detail: row.detail,
        since: iso(row.since),
        findingId: row.id,
      });
      continue;
    }
    const verified =
      model.listed === true || row?.state === 'works'
        ? true
        : model.listed === false
          ? false
          : undefined;
    available.push(verified === undefined ? model : { ...model, verified });
  }
  return { models: available, unavailable };
}

// Every finding, newest first, each refusal with the agents set to the refused model: all
// of them for the Administrator, a team's own for the team.
export async function listModelAvailability(teamId?: number) {
  const rows = await db
    .select()
    .from(helenaModelAvailability)
    .orderBy(sql`${helenaModelAvailability.observedAt} DESC`);
  const refused = rows.filter((row) => row.state === 'unavailable');
  const agents =
    refused.length > 0
      ? await db
          .select({
            id: aiAgent.id,
            teamId: aiAgent.teamId,
            username: aiAgent.username,
            name: user.name,
            template: aiAgent.template,
            model: aiAgent.model,
            runtimePolicy: aiAgent.runtimePolicy,
          })
          .from(aiAgent)
          .innerJoin(user, eq(user.id, aiAgent.userId))
          .where(
            and(
              inArray(aiAgent.model, [...new Set(refused.map((row) => row.model))]),
              teamId === undefined ? undefined : eq(aiAgent.teamId, teamId),
            ),
          )
      : [];
  return rows.map((row) => ({
    id: row.id,
    runtime: row.runtime,
    provider: row.provider,
    model: row.model,
    state: row.state as ModelState,
    reason: row.reason,
    detail: row.detail,
    agentId: row.agentId,
    runId: row.runId,
    chatMessageId: row.chatMessageId,
    since: iso(row.since),
    observedAt: iso(row.observedAt),
    agents:
      row.state === 'unavailable'
        ? agents
            .filter(
              (agent) =>
                agent.model === row.model && runtimeOfPolicy(agent.runtimePolicy) === row.runtime,
            )
            .map(({ id, teamId: team, username, name, template }) => ({
              id,
              teamId: team,
              username,
              name,
              template,
            }))
        : [],
  }));
}

// "Erneut prüfen": forgets a finding, so the next use of the model tries it again.
export async function clearModelAvailability(id: number): Promise<boolean> {
  const rows = await db
    .delete(helenaModelAvailability)
    .where(eq(helenaModelAvailability.id, id))
    .returning({ id: helenaModelAvailability.id });
  return rows.length > 0;
}

// The refusal an agent's own model met, or undefined: for a template copy, a workflow stage
// and the agent editor. An agent on its runtime's default model has none Helena can name.
export async function agentModelRefusal(agent: {
  model: string | null;
  runtimePolicy: unknown;
}): Promise<ModelAvailabilityRow | undefined> {
  if (!agent.model) return undefined;
  const runtime = runtimeOfPolicy(agent.runtimePolicy);
  const rows = await db
    .select()
    .from(helenaModelAvailability)
    .where(
      and(
        eq(helenaModelAvailability.runtime, runtime),
        eq(helenaModelAvailability.model, agent.model),
        eq(helenaModelAvailability.state, 'unavailable'),
      ),
    )
    .limit(1);
  return rows[0];
}

// The models that are refused, for the health overview: each with the agents set to it.
export async function modelAvailabilityHealth() {
  const entries = await listModelAvailability();
  return {
    unavailable: entries
      .filter((entry) => entry.state === 'unavailable')
      .slice(0, 20)
      .map(({ runtime, provider, model, detail, since, agents }) => ({
        runtime,
        provider,
        model,
        detail,
        since,
        agents: agents.slice(0, 20).map(({ id, teamId, username, template }) => ({
          id,
          teamId,
          username,
          template,
        })),
      })),
  };
}
