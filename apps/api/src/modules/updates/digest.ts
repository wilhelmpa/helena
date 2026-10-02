import {
  agentRun,
  aiAgent,
  db,
  listModelServers,
  readLocalAiPolicy,
  projectMember,
  user,
} from '@repo/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { isUpdateRisk, localModelId, parseLocalModelId, type UpdateRisk } from '@helena/sdk';
import { readChatCatalog, type ChatCatalogModel } from '#modules/agents/chat/service';
import { isHomeAgent } from '#modules/agents/core/home-agent';
import { normalizeRuntimePolicy } from '#modules/agents/core/service';
import { registerBuiltins } from '#modules/engine/builtin/index';
import { policyDecider } from '#modules/engine/registry';
import { price } from '#modules/model-prices/service';
import { effectiveModel } from '#modules/local-ai/service';
import { WORK_CLASS } from '#modules/local-ai/work-classes';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { getUpdateSettings, refusedModels } from './settings';
import type { UpdateSettings } from './settings';

// Summaries use a capability-gated, text-only run: no tools, agent instructions,
// memory or skills. Release notes are untrusted model input.

export { DIGEST_SYSTEM_PROMPT } from './digest-prompt';

// What one summary is about: one component, or a group (all Debian packages).
export interface DigestSubject {
  title: string;
  kind: string;
  items: {
    name: string;
    installed: string | null;
    available: string | null;
    security: boolean;
    detail?: string | null;
  }[];
  notes: string | null;
}

const PROMPT_NOTES_MAX = 16_000;

export function digestPrompt(subject: DigestSubject): string {
  const lines = [
    `Komponente: ${subject.title} (${subject.kind})`,
    ...subject.items.map(
      (item) =>
        `- ${item.name}: installiert ${item.installed ?? 'unbekannt'}, neu ${item.available ?? 'unbekannt'}` +
        `${item.security ? ', Sicherheitsupdate' : ''}${item.detail ? ` (${item.detail})` : ''}`,
    ),
    '',
    '<release-notes>',
    // A closing tag inside the notes would end the data early; it is defused.
    (subject.notes ?? 'Keine Versionshinweise verfügbar.')
      .slice(0, PROMPT_NOTES_MAX)
      .replace(/<\/?release-notes>/gi, '[release-notes]'),
    '</release-notes>',
  ];
  return lines.join('\n');
}

export interface DigestResult {
  summary: string;
  highlights: string[];
  risk: UpdateRisk | null;
  breaking: boolean | null;
}

const RISK_WORDS: Record<string, UpdateRisk> = {
  niedrig: 'low',
  gering: 'low',
  low: 'low',
  mittel: 'medium',
  medium: 'medium',
  hoch: 'high',
  high: 'high',
};

// The first JSON object in the answer; the rest (a model that talks anyway) is ignored.
function firstObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        const value = JSON.parse(text.slice(start, index + 1)) as unknown;
        return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Reads the model's answer. A risk word Helena does not know is no rating; an answer that
// is not JSON is kept as the summary text (shortened) with no rating.
export function parseDigest(output: string | null | undefined): DigestResult | null {
  const text = (output ?? '').trim();
  if (!text) return null;
  const value = firstObject(text);
  if (!value) {
    return { summary: text.slice(0, 600), highlights: [], risk: null, breaking: null };
  }
  const summary =
    typeof value.zusammenfassung === 'string'
      ? value.zusammenfassung
      : typeof value.summary === 'string'
        ? value.summary
        : '';
  const rawRisk = String(value.risiko ?? value.risk ?? '')
    .trim()
    .toLowerCase();
  const risk = RISK_WORDS[rawRisk] ?? (isUpdateRisk(rawRisk) ? rawRisk : null);
  const list = Array.isArray(value.wichtig)
    ? value.wichtig
    : Array.isArray(value.highlights)
      ? value.highlights
      : [];
  const highlights = list
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, 5)
    .map((entry) => entry.trim().slice(0, 200));
  const breaking = typeof value.breaking === 'boolean' ? value.breaking : null;
  if (!summary.trim() && highlights.length === 0) return null;
  return { summary: summary.trim().slice(0, 600), highlights, risk, breaking };
}

// ── Who writes it, on which model ──────────────────────────────────────────────────────

// What a runner reports when it runs digest runs text only.
export const DIGEST_CAPABILITY = 'digest-runs';

export interface DigestAgent {
  id: number;
  username: string;
  projectId: number;
}

function canDigest(runtimeState: unknown): boolean {
  const state = runtimeState as { adapter?: string; capabilities?: unknown } | null;
  return (
    !!state &&
    ['helena', 'hermes'].includes(state.adapter ?? '') &&
    Array.isArray(state.capabilities) &&
    state.capabilities.includes(DIGEST_CAPABILITY)
  );
}

export async function pickDigestAgent(settings: UpdateSettings): Promise<DigestAgent | null> {
  const rows = await db
    .select({
      id: aiAgent.id,
      username: aiAgent.username,
      agentRole: aiAgent.agentRole,
      userId: aiAgent.userId,
      runtimeState: aiAgent.runtimeState,
      lastSeenAt: aiAgent.lastSeenAt,
    })
    .from(aiAgent)
    .where(and(eq(aiAgent.kind, 'external'), eq(aiAgent.template, false)))
    .orderBy(
      desc(sql`${aiAgent.lastSeenAt} IS NOT NULL`),
      desc(aiAgent.lastSeenAt),
      asc(aiAgent.id),
    );
  const capable = rows.filter((row) => canDigest(row.runtimeState));
  const native = capable.filter(
    (row) => (row.runtimeState as { adapter?: string })?.adapter === 'helena',
  );
  const candidates = native.length ? native : capable;
  const chosen =
    candidates.find((row) => row.id === settings.agentId) ??
    candidates.find((row) => isHomeAgent(row.agentRole)) ??
    candidates[0];
  if (!chosen) return null;
  const [membership] = await db
    .select({ projectId: projectMember.projectId })
    .from(projectMember)
    .where(eq(projectMember.userId, chosen.userId))
    .orderBy(asc(projectMember.projectId))
    .limit(1);
  if (!membership) return null;
  return { id: chosen.id, username: chosen.username, projectId: membership.projectId };
}

// Agents with a text-only digest runtime.
export async function digestAgents(): Promise<{ id: number; username: string; name: string }[]> {
  const rows = await db
    .select({
      id: aiAgent.id,
      username: aiAgent.username,
      name: user.name,
      runtimeState: aiAgent.runtimeState,
    })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(and(eq(aiAgent.kind, 'external'), eq(aiAgent.template, false)))
    .orderBy(asc(aiAgent.id));
  return rows
    .filter((row) => canDigest(row.runtimeState))
    .map(({ id, username, name }) => ({ id, username, name: name || username }));
}

type CatalogEntry = ChatCatalogModel & { listed?: boolean; verified?: boolean; variantOf?: string };

// Runtime reports may name a local model without its server prefix.
export async function digestModelAvailable(): Promise<(model: string | null) => boolean> {
  const [servers, policy, settings] = await Promise.all([
    listModelServers(),
    readLocalAiPolicy(),
    getUpdateSettings(),
  ]);
  const agent = await pickDigestAgent(settings);
  const catalog = agent ? await readChatCatalog(agent.id) : null;
  return (model) => {
    if (!model) return false;
    const parsed = parseLocalModelId(model);
    const local = servers.flatMap((server) =>
      server.models
        .filter((entry) =>
          parsed ? server.slug === parsed.slug && entry.id === parsed.model : entry.id === model,
        )
        .map((entry) => ({ server, entry })),
    );
    if (parsed || local.length)
      return local.some(
        ({ server, entry }) =>
          (server.kind !== 'lemonade' || entry.downloaded === true) &&
          effectiveModel(localModelId(server.slug, entry.id), policy, [server]) !== null,
      );
    if (!catalog?.updatedAt) return true;
    const entry = catalog.models.find((entry) => entry.id === model) as CatalogEntry | undefined;
    return (
      !!entry &&
      entry.verified !== false &&
      !(entry.verified === undefined && entry.listed === false)
    );
  };
}

// "Automatisch": the cheapest model of the agent's catalog that has a price and that the
// account serves. A model the catalog marks unverified (hub/model-availability) or one a
// digest run was refused on lately is left out; so are large-context variants.
export async function pickDigestModel(
  agentId: number,
  settings: UpdateSettings,
): Promise<{ model: string | null; reasoning: string | null }> {
  const catalog = (await readChatCatalog(agentId)).models as CatalogEntry[];
  const reasoningFor = (entry: CatalogEntry | undefined): string | null => {
    if (!entry || entry.thinkingLevels.length === 0) return null;
    return entry.thinkingLevels.includes(settings.reasoning)
      ? settings.reasoning
      : (entry.thinkingLevels.find((level) => level !== 'none') ?? null);
  };
  if (settings.model) {
    const entry = catalog.find((candidate) => candidate.id === settings.model);
    return { model: settings.model, reasoning: entry ? reasoningFor(entry) : settings.reasoning };
  }
  const refused = await refusedModels();
  const usable = catalog.filter(
    (entry) =>
      !entry.local &&
      !parseLocalModelId(entry.id) &&
      !entry.variantOf &&
      !/-\d+k$/.test(entry.id) &&
      entry.verified !== false &&
      !(entry.verified === undefined && entry.listed === false) &&
      !refused.has(entry.id),
  );
  let best: { entry: CatalogEntry; cost: number } | null = null;
  for (const entry of usable) {
    const found = await price(entry.id, entry.provider ?? null);
    if (!found || found.inputPerMTok === null || found.outputPerMTok === null) continue;
    const cost = Number(found.inputPerMTok) + Number(found.outputPerMTok);
    if (!Number.isFinite(cost)) continue;
    if (!best || cost < best.cost) best = { entry, cost };
  }
  // Nothing priced: the agent's own model, at the chosen reasoning.
  if (!best) return { model: null, reasoning: settings.reasoning };
  return { model: best.entry.id, reasoning: reasoningFor(best.entry) };
}

// ── Queueing and reading the run ────────────────────────────────────────────────────────

export class DigestRefused extends Error {}

// Queues the digest run and answers its id. The agent's pause and budgets refuse it like
// any other run (engine policy `run`).
export async function queueDigestRun(
  agent: DigestAgent,
  prompt: string,
  choice: { model: string | null; reasoning: string | null },
  // Another text-only run than a summary (the local AI judge: `judge`), with its own system
  // prompt at the claim and never a local model.
  workClass: string = WORK_CLASS.summaries,
): Promise<number> {
  // The engine's built-ins bring the default policy (an API without the engine running too).
  registerBuiltins();
  const decision = await policyDecider().decide({
    agentId: agent.id,
    projectId: agent.projectId,
    actionCategory: 'run',
    taskId: null,
  });
  if (decision.decision === 'deny') {
    throw new DigestRefused(`@${agent.username} is paused: ${decision.reason}`);
  }
  const [policy] = await db
    .select({ runtimePolicy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .where(eq(aiAgent.id, agent.id));
  const own = normalizeRuntimePolicy(policy?.runtimePolicy);
  const [run] = await db
    .insert(agentRun)
    .values({
      agentId: agent.id,
      projectId: agent.projectId,
      issueId: null,
      prompt,
      trigger: 'digest',
      // The model the summary runs on without local AI; the claim hands the local one while
      // Lokale KI takes summaries.
      model: choice.model,
      reasoning: choice.reasoning ?? own.reasoningEffort ?? null,
      workClass,
      // One answer, no tool loop: a turn or two is enough, and a short budget stops a model
      // that talks on.
      maxTurns: 3,
      runBudgetSeconds: 300,
    })
    .returning({ id: agentRun.id });
  await bumpControlPlaneRevision(agent.projectId);
  return run!.id;
}

export interface DigestRunState {
  status: 'pending' | 'success' | 'failed' | 'canceled';
  output: string | null;
  error: string | null;
  // The model the run was configured with and the one its session really ran on.
  model: string | null;
  usedModel: string | null;
  // Lokale KI handed it a local model: a failure there says nothing about `model`.
  local: boolean;
  // The runtime's own reading of a failure (hub/model-availability: `model-unavailable`).
  failureCode: string | null;
}

export async function digestRunState(runId: number): Promise<DigestRunState> {
  const [row] = await db
    .select({
      status: agentRun.status,
      output: agentRun.output,
      error: agentRun.lastError,
      model: agentRun.model,
      modelCheck: agentRun.modelCheck,
      failure: agentRun.failure,
    })
    .from(agentRun)
    .where(eq(agentRun.id, runId));
  if (!row)
    return {
      status: 'canceled',
      output: null,
      error: 'The run is gone',
      model: null,
      usedModel: null,
      local: false,
      failureCode: null,
    };
  const check = row.modelCheck as {
    configured?: { source?: string } | null;
    used?: { model?: string | null } | null;
  } | null;
  return {
    status: row.status as DigestRunState['status'],
    output: row.output,
    error: row.error,
    model: row.model,
    usedModel: check?.used?.model ?? null,
    local: check?.configured?.source === 'local',
    failureCode: (row.failure as { code?: unknown } | null)?.code?.toString() ?? null,
  };
}

// A provider's refusal of the model itself ("not supported when using Codex with a ChatGPT
// account", "model … does not exist"), as opposed to a failure that another try may pass.
export function isModelRefusal(error: string | null | undefined): boolean {
  return /not supported|does not exist|model[_ ]not[_ ]found|isn't available|is not available|unknown model/i.test(
    error ?? '',
  );
}
