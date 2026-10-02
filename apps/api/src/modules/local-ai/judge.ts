import { getSetting, readSecret, setSetting, writeSecret } from '@repo/db';
import type { LocalAiChatAnswer, LocalAiChatRequest } from '@helena/sdk';
import { HttpError } from '#shared/lib';
import { openAiEvalContext } from './eval-context';
import { JUDGE_WORK_CLASS } from './judge-prompt';

// The judge of the evals that a program cannot check (Deutsch-Texte: a second, stronger model
// scores each text; docs/helena-decisions/halogen.md §7). Set in Administrator → Lokale KI:
//
// - `run` (the default): a text-only run of a Hermes agent on a subscription model the owner
//   already has (gpt-6-sol, Opus): the same kind of run the update center's summaries are
//   (trigger `digest`: no tools, no SOUL, no memory), with the judge's own system prompt
//   (work class `judge`). Nothing new to log in to.
// - `endpoint`: any OpenAI-compatible endpoint with a key stored in Helena.
// - `off`: the eval refuses to run (it cannot score itself).
//
// Command-line runs (scripts/local-ai-eval.ts) may use judge-cli.ts: the owner's Claude Code or
// Codex CLI, logged in with the owner's own subscription.

export const JUDGE_SETTING_KEY = 'localAi.judge';
export const JUDGE_SECRET_KEY = 'localAi.judge';

export interface JudgeSettings {
  kind: 'off' | 'run' | 'endpoint';
  // The model: a model id of the agent's catalog (`run`), or the endpoint's (`endpoint`).
  model: string | null;
  // The reasoning of a `run` judge (the catalog's levels; null: the model's default).
  reasoning: string | null;
  // The Hermes agent a `run` judge runs on; null: the Home master (as the update summaries).
  agentId: number | null;
  // The endpoint's base URL (…/v1) for `endpoint`.
  baseUrl: string | null;
}

export const DEFAULT_JUDGE: JudgeSettings = {
  kind: 'run',
  model: 'gpt-6-sol',
  reasoning: 'medium',
  agentId: null,
  baseUrl: null,
};

export function normalizeJudge(value: unknown): JudgeSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const text = (entry: unknown, max = 200) =>
    typeof entry === 'string' && entry.trim() ? entry.trim().slice(0, max) : null;
  const kind =
    raw.kind === 'off' || raw.kind === 'endpoint' || raw.kind === 'run' ? raw.kind : null;
  if (!kind) return { ...DEFAULT_JUDGE };
  return {
    kind,
    model: text(raw.model),
    reasoning: text(raw.reasoning, 20),
    agentId:
      typeof raw.agentId === 'number' && Number.isInteger(raw.agentId) && raw.agentId > 0
        ? raw.agentId
        : null,
    baseUrl: text(raw.baseUrl, 500),
  };
}

export async function readJudge(): Promise<JudgeSettings> {
  return normalizeJudge(await getSetting(JUDGE_SETTING_KEY));
}

export async function writeJudge(
  patch: Partial<JudgeSettings> & { key?: string | null },
): Promise<JudgeSettings> {
  const next = normalizeJudge({ ...(await readJudge()), ...patch });
  if (next.kind === 'endpoint') {
    if (!next.baseUrl || !/^https?:\/\//.test(next.baseUrl))
      throw new HttpError(400, 'The judge endpoint must be an http(s) address');
    if (!next.model) throw new HttpError(400, 'The judge endpoint needs a model');
  }
  if (patch.key?.trim())
    await writeSecret(JUDGE_SECRET_KEY, { key: patch.key.trim() }, { key: true });
  await setSetting(JUDGE_SETTING_KEY, next);
  return next;
}

// What Administrator → Lokale KI shows: the settings, whether a key is stored, the agents a
// judge run can run on.
export async function judgeView() {
  const { digestAgents } = await import('#modules/updates/digest');
  const [settings, stored, agents] = await Promise.all([
    readJudge(),
    readSecret<{ key?: string }>(JUDGE_SECRET_KEY),
    digestAgents(),
  ]);
  return { ...settings, hasKey: Boolean(stored?.key), agents };
}

// ── Answers ────────────────────────────────────────────────────────────────────────────

type Judge = (request: LocalAiChatRequest) => Promise<LocalAiChatAnswer>;

// The prompt of a text-only run: the judge's instructions are the run's system prompt
// (JUDGE_SYSTEM_PROMPT); the case's own instructions go first in the prompt.
export function judgePrompt(request: LocalAiChatRequest): string {
  return [request.system ? `Anweisung: ${request.system}` : null, request.prompt]
    .filter(Boolean)
    .join('\n\n');
}

export interface JudgeRunDeps {
  queue(
    prompt: string,
    choice: { model: string | null; reasoning: string | null },
  ): Promise<number>;
  state(runId: number): Promise<{ status: string; output: string | null; error: string | null }>;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

// A judge that answers through a text-only run: it queues the run and waits for its answer
// (the runner claims it within seconds; a subscription model answers in well under a minute).
export function runJudge(
  settings: Pick<JudgeSettings, 'model' | 'reasoning'>,
  deps: JudgeRunDeps,
  timeoutMs = 6 * 60_000,
): Judge {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  return async (request) => {
    const started = now();
    const runId = await deps.queue(judgePrompt(request), {
      model: settings.model,
      reasoning: settings.reasoning,
    });
    for (;;) {
      const state = await deps.state(runId);
      if (state.status === 'success')
        return {
          text: state.output ?? '',
          toolCalls: [],
          inputTokens: null,
          outputTokens: null,
          latencyMs: now() - started,
        };
      if (state.status === 'failed' || state.status === 'canceled')
        throw new Error(
          `The judge run ${runId} ${state.status}: ${(state.error ?? '').slice(0, 160)}`,
        );
      if (now() - started > timeoutMs)
        throw new Error(`The judge run ${runId} did not answer in time`);
      await sleep(3_000);
    }
  };
}

// The judge Helena's own evals use now, or null (the eval then says it needs one).
export async function currentJudge(): Promise<Judge | null> {
  const settings = await readJudge();
  if (settings.kind === 'off') return null;
  if (settings.kind === 'endpoint' && settings.baseUrl && settings.model) {
    const stored = await readSecret<{ key?: string }>(JUDGE_SECRET_KEY);
    return openAiEvalContext({
      baseUrl: settings.baseUrl,
      key: stored?.key ?? null,
      model: settings.model,
    }).chat;
  }
  // The environment's endpoint (LOCAL_AI_JUDGE_*) still counts where one is set.
  const envBase = process.env.LOCAL_AI_JUDGE_BASE_URL;
  if (settings.kind === 'endpoint' && envBase) {
    return openAiEvalContext({
      baseUrl: envBase,
      key: process.env.LOCAL_AI_JUDGE_API_KEY ?? null,
      model: process.env.LOCAL_AI_JUDGE_MODEL ?? settings.model ?? 'gpt-6-sol',
    }).chat;
  }
  if (settings.kind !== 'run') return null;
  const { pickDigestAgent, queueDigestRun, digestRunState } =
    await import('#modules/updates/digest');
  const agent = await pickDigestAgent({ agentId: settings.agentId } as Parameters<
    typeof pickDigestAgent
  >[0]);
  if (!agent) return null;
  return runJudge(settings, {
    // A judge run is no update summary: its own system prompt, and never a local model.
    queue: (prompt, choice) => queueDigestRun(agent, prompt, choice, JUDGE_WORK_CLASS),
    state: digestRunState,
  });
}
