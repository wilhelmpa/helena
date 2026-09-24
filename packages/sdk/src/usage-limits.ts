import type { Logger } from './common';
import type { StartGate } from './runtime-profile';
import type { LocalizedText } from './text';

// How much of a subscription's limits is used: the rolling session window (about five
// hours), the weekly window, the model-specific weekly windows, and pay-as-you-go credit.
// A usage-limit source reads these numbers where a login already lives, inside the process
// that holds it (the runner next to Hermes, Claude Code and Codex; a helper running as the
// owner), and hands Helena numbers only: never a token, an e-mail or a provider's raw
// answer. Decision and sources: docs/helena-decisions/provider-limits.md.

// `session`: the rolling window of a few hours. `weekly`: the plan-wide week. `model`: a
// window that counts only one model family or feature (Claude's "Fable" week, a Codex
// model bucket). `monthly`: a calendar or billing month.
export type UsageLimitWindowKind = 'session' | 'weekly' | 'model' | 'monthly' | 'other';

export interface UsageLimitWindow {
  // Stable within the account: `session`, `weekly`, `weekly:fable`, `codex_spark:weekly`.
  id: string;
  kind: UsageLimitWindowKind;
  // The provider's own name for a scoped window (a model family, a feature); null for the
  // plan-wide windows, which Helena names itself.
  label: string | null;
  // Share of the window used, 0–100. Can pass 100 where a provider lets usage run past the cap.
  usedPercent: number | null;
  windowMinutes: number | null;
  // ISO 8601.
  resetsAt: string | null;
  // The provider's own reading of the window, where it gives one.
  severity: 'normal' | 'warning' | 'critical' | null;
  // The provider says this window blocks ordinary use now.
  limited: boolean | null;
}

// Pay-as-you-go beyond the plan: Codex credits, Claude's extra usage. Amounts in `currency`
// units (not cents).
export interface UsageLimitExtra {
  kind: 'credits' | 'extra_usage';
  enabled: boolean;
  unlimited: boolean;
  // What is left (credits) or spent this period (extra usage), and the period's cap.
  balance: number | null;
  used: number | null;
  limit: number | null;
  currency: string | null;
}

// Why a source has no numbers for a login: none there, an API key (no plan windows), a
// Claude token without the profile scope (setup-token), the read failed, or the provider
// offers no limits to read.
export type UsageLimitUnavailable =
  'no_login' | 'api_key' | 'no_profile_scope' | 'failed' | 'unsupported';

export interface UsageLimitSnapshot {
  // gen_ai.provider.name-like: `openai-codex` (the ChatGPT plan), `anthropic` (the Claude
  // plan), `openrouter`, or a plugin's.
  provider: string;
  // A stable, non-secret key of the account at the provider: a hash of the provider's
  // account id where it gives one (so two logins to one account are one row), else of where
  // the login is stored. Never the id itself.
  account: string;
  // The registry id of the source that measured it.
  source: string;
  // Which login it was read through: `hermes`, `codex`, `claude-code`, `owner`, or a label
  // a plugin chooses.
  login: string | null;
  // The plan as the provider names it: `pro`, `plus`, `max`, `team`.
  plan: string | null;
  windows: UsageLimitWindow[];
  extra: UsageLimitExtra | null;
  // Codex: resets banked on the account that restore the whole allowance.
  resetCredits: number | null;
  // The provider's verdict on ordinary use: false while it blocks it.
  allowed: boolean | null;
  // `probe`: asked on purpose. `passive`: read off a response the runtime got anyway.
  via: 'probe' | 'passive';
  // ISO 8601.
  observedAt: string;
  unavailable: UsageLimitUnavailable | null;
}

export type UsageLimitState = 'ok' | 'near' | 'limited' | 'unknown';

// ── Sources ─────────────────────────────────────────────────────────────────────────────

// What a runner knows about one agent when it asks a source for probes and observers.
export interface UsageLimitAgentContext {
  agentId?: number | null;
  // The agent's runtime: `hermes`, `claude`, `codex`, or a plugin runtime.
  runtime: string;
  // HERMES_HOME for Hermes; the runtime's own directory for Claude Code and Codex
  // (CLAUDE_CONFIG_DIR, CODEX_HOME).
  home: string;
  // The environment the runtime's own commands get.
  env: Record<string, string>;
  // The model providers the agent's runtime uses (Hermes: `openai-codex`, `anthropic`, …).
  providers: string[];
  // Serializes a probe with the runtime's own commands where they share a login file that
  // the probe could refresh (Codex' auth.json).
  gate?: StartGate;
  // Names the login the runtime got from Helena for its commands, where it got one
  // (`runtime_login:12`), so agents sharing a login share its account row.
  loginRef?: string | null;
}

export interface UsageLimitProbe {
  // Names the login the probe reads, unique across sources: a runner probes each key once
  // per interval, however many agents share the login.
  key: string;
  provider: string;
  run(signal?: AbortSignal): Promise<UsageLimitSnapshot[]>;
}

// Reads snapshots off a runtime's own output as a run goes.
export interface UsageLimitObserver {
  // One line of the output. Answers the snapshots that changed with it (usually none).
  line(text: string): UsageLimitSnapshot[];
}

export interface UsageLimitPollContext {
  now: Date;
  log: Logger;
  signal?: AbortSignal;
}

// A usage-limit source (registry `usageLimitSources`). A runner source offers `probes` (ask
// the provider through the runtime's login) and `observe` (read what the runtime already
// received); an API source offers `poll` (numbers it can fetch without an agent, such as a
// key the Administrator saved, or files a host tool dropped).
export interface UsageLimitSource {
  id: string;
  label: LocalizedText;
  providers: string[];
  // The runtimes whose logins it reads, for a runner source.
  runtimes?: string[];
  probes?(context: UsageLimitAgentContext): UsageLimitProbe[] | Promise<UsageLimitProbe[]>;
  observe?(format: string, context: UsageLimitAgentContext): UsageLimitObserver | null;
  poll?(context: UsageLimitPollContext): Promise<UsageLimitSnapshot[]>;
}

// ── Reading the numbers ─────────────────────────────────────────────────────────────────

// From this share a window reads as close to its limit, unless the owner chose another.
export const USAGE_LIMIT_NEAR_PERCENT = 80;

const MINUTES_SESSION_MAX = 24 * 60;
const MINUTES_WEEK = 7 * 24 * 60;

// A window's kind from its length: providers name windows by position (Codex' `primary`
// is the weekly window on a plan without a session window), so the length decides.
export function windowKindOf(minutes: number | null | undefined): UsageLimitWindowKind {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return 'other';
  if (minutes <= MINUTES_SESSION_MAX) return 'session';
  if (Math.abs(minutes - MINUTES_WEEK) <= 24 * 60) return 'weekly';
  if (minutes >= 28 * 24 * 60 && minutes <= 31 * 24 * 60) return 'monthly';
  return 'other';
}

// The share used now: a window whose reset time has passed is empty again until the next
// reading says otherwise.
export function effectiveUsedPercent(
  window: Pick<UsageLimitWindow, 'usedPercent' | 'resetsAt'>,
  now: number = Date.now(),
): number | null {
  if (window.usedPercent === null) return null;
  if (window.resetsAt && Date.parse(window.resetsAt) <= now) return 0;
  return window.usedPercent;
}

function resetPassed(window: Pick<UsageLimitWindow, 'resetsAt'>, now: number): boolean {
  return !!window.resetsAt && Date.parse(window.resetsAt) <= now;
}

export function windowState(
  window: UsageLimitWindow,
  nearPercent: number = USAGE_LIMIT_NEAR_PERCENT,
  now: number = Date.now(),
): UsageLimitState {
  const used = effectiveUsedPercent(window, now);
  const fresh = !resetPassed(window, now);
  if ((fresh && window.limited === true) || (used !== null && used >= 100)) return 'limited';
  // The provider's colour for the meter ('warning', 'critical') reads as close to the limit;
  // only a full window or the provider's own "blocked" is the limit itself.
  const flagged = fresh && (window.severity === 'warning' || window.severity === 'critical');
  if ((used !== null && used >= nearPercent) || flagged) return 'near';
  return used === null ? 'unknown' : 'ok';
}

const STATE_RANK: Record<UsageLimitState, number> = { unknown: 0, ok: 1, near: 2, limited: 3 };

export function worstState(states: Iterable<UsageLimitState>): UsageLimitState {
  let worst: UsageLimitState = 'unknown';
  for (const state of states) if (STATE_RANK[state] > STATE_RANK[worst]) worst = state;
  return worst;
}

// An account's state is its worst window's. The provider's own "blocked" counts even
// without a full window: until the earliest reset of its windows, when the block most likely
// lifted (a window the provider marked as the blocking one already is `limited` itself).
export function snapshotState(
  snapshot: Pick<UsageLimitSnapshot, 'windows' | 'allowed' | 'unavailable'>,
  nearPercent: number = USAGE_LIMIT_NEAR_PERCENT,
  now: number = Date.now(),
): UsageLimitState {
  if (snapshot.unavailable) return 'unknown';
  const state = worstState(snapshot.windows.map((window) => windowState(window, nearPercent, now)));
  if (snapshot.allowed !== false || state === 'limited') return state;
  const resets = snapshot.windows
    .map((window) => (window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN))
    .filter((time) => !Number.isNaN(time));
  if (resets.length > 0 && Math.min(...resets) <= now) return state;
  return 'limited';
}

// ── Checking what a source hands over ───────────────────────────────────────────────────

const MAX_WINDOWS = 32;
const MAX_TEXT = 128;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const WINDOW_KINDS = new Set<UsageLimitWindowKind>([
  'session',
  'weekly',
  'model',
  'monthly',
  'other',
]);
const UNAVAILABLE = new Set<UsageLimitUnavailable>([
  'no_login',
  'api_key',
  'no_profile_scope',
  'failed',
  'unsupported',
]);

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function finite(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function windowFrom(value: unknown): UsageLimitWindow | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id);
  if (!id || !KEY.test(id)) return null;
  const kind = WINDOW_KINDS.has(raw.kind as UsageLimitWindowKind)
    ? (raw.kind as UsageLimitWindowKind)
    : 'other';
  const severity =
    raw.severity === 'normal' || raw.severity === 'warning' || raw.severity === 'critical'
      ? raw.severity
      : null;
  return {
    id,
    kind,
    label: text(raw.label),
    usedPercent: finite(raw.usedPercent, 0, 1000),
    windowMinutes: finite(raw.windowMinutes, 0, 366 * 24 * 60),
    resetsAt: isoDate(raw.resetsAt),
    severity,
    limited: flag(raw.limited),
  };
}

function extraFrom(value: unknown): UsageLimitExtra | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== 'credits' && raw.kind !== 'extra_usage') return null;
  const money = (amount: unknown) => finite(amount, -1e9, 1e9);
  return {
    kind: raw.kind,
    enabled: raw.enabled === true,
    unlimited: raw.unlimited === true,
    balance: money(raw.balance),
    used: money(raw.used),
    limit: money(raw.limit),
    currency: text(raw.currency, 8),
  };
}

// A snapshot from a source Helena does not control (a runner, a plugin, a spool file), made
// safe to store: known fields only, strings cut, numbers bounded, windows capped. Null when
// it names no provider, account or time.
export function normalizeUsageLimitSnapshot(value: unknown): UsageLimitSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const provider = text(raw.provider, 64);
  const account = text(raw.account, 128);
  const source = text(raw.source, 128);
  const observedAt = isoDate(raw.observedAt);
  if (!provider || !account || !source || !observedAt) return null;
  if (!KEY.test(provider) || !KEY.test(account) || !KEY.test(source)) return null;
  const windows = (Array.isArray(raw.windows) ? raw.windows : [])
    .map(windowFrom)
    .filter((window): window is UsageLimitWindow => window !== null)
    .slice(0, MAX_WINDOWS);
  const seen = new Set<string>();
  const unique = windows.filter((window) => !seen.has(window.id) && seen.add(window.id));
  const unavailable = UNAVAILABLE.has(raw.unavailable as UsageLimitUnavailable)
    ? (raw.unavailable as UsageLimitUnavailable)
    : null;
  const resetCredits = finite(raw.resetCredits, 0, 1e6);
  return {
    provider,
    account,
    source,
    login: text(raw.login, 64),
    plan: text(raw.plan, 64),
    windows: unique,
    extra: extraFrom(raw.extra),
    resetCredits: resetCredits === null ? null : Math.round(resetCredits),
    allowed: flag(raw.allowed),
    via: raw.via === 'passive' ? 'passive' : 'probe',
    observedAt,
    unavailable,
  };
}
