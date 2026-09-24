import type { Logger } from './common';
import type { LocalizedText } from './text';

// The model logins agents share through a runtime (Hermes' Claude and ChatGPT logins, the
// Codex CLI's next to it) as whatever keeps them alive reports them: whether each is usable,
// when its access token runs out, and the command the owner runs when one has to be signed in
// again. Names, states and times only, never a token. Decision:
// docs/helena-decisions/token-keeper.md.

// `ok`: usable, and renewed before it runs out. `expiring`: due for renewal, which waits for a
// moment without agent runs. `expired`: its access token ran out and it is not renewed yet;
// agents cannot use it. `error`: renewing it failed for now (network, provider) and is tried
// again. `invalid`: the provider rejected it; someone has to sign in again.
export type RuntimeLoginState = 'ok' | 'expiring' | 'expired' | 'error' | 'invalid' | 'unknown';

export interface RuntimeLogin {
  // Where the login lives: `hermes` (Hermes' root store), `codex-cli`, or a source's own word.
  store: string;
  // The model provider it signs in to: `anthropic`, `openai-codex`, …
  provider: string;
  // Stable within its store (Hermes' credential pool row id).
  id: string;
  // The runtime's own name for it; can be the account's e-mail address.
  label: string | null;
  // Whether something renews it; a login that is only reported is not a problem when it runs
  // out.
  managed: boolean;
  state: RuntimeLoginState;
  // ISO 8601.
  expiresAt: string | null;
  refreshedAt: string | null;
  // A short reason for the state, with anything token-like cut out.
  error: string | null;
  // What the owner runs in the owner terminal to sign it in again.
  command: string | null;
  // A word about how it relates to others (`linked`, `separate` for the Codex CLI's login).
  note: string | null;
}

export interface RuntimeLoginReport {
  // The registry id of the source that read it.
  source: string;
  // Who wrote it (`helena-token-keeper`).
  reporter: string;
  // ISO 8601.
  checkedAt: string;
  // How often the reporter runs; a report older than a few intervals is stale.
  intervalSeconds: number | null;
  logins: RuntimeLogin[];
  // What the reporter itself could not do (a store it could not read, a view not written).
  errors: string[];
}

export interface RuntimeLoginPollContext {
  now: Date;
  log: Logger;
  signal?: AbortSignal;
}

// A source of login reports (registry `runtimeLoginSources`): the token keeper's status files
// the API reads, or a plugin's.
export interface RuntimeLoginSource {
  id: string;
  label: LocalizedText;
  poll(context: RuntimeLoginPollContext): Promise<RuntimeLoginReport[]>;
}

// A login the owner has to act on: rejected, or one that should be renewed and is not usable.
export function runtimeLoginNeedsOwner(login: Pick<RuntimeLogin, 'state' | 'managed'>): boolean {
  if (login.state === 'invalid') return true;
  return login.managed && (login.state === 'expired' || login.state === 'error');
}

// ── Checking what a source hands over ───────────────────────────────────────────────────

const STATES = new Set<RuntimeLoginState>([
  'ok',
  'expiring',
  'expired',
  'error',
  'invalid',
  'unknown',
]);
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_LOGINS = 64;
// A command is shown and copied, never run by Helena; still only printable text of one line.
const COMMAND = /^[\x20-\x7e]{1,600}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function loginFrom(value: unknown): RuntimeLogin | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const store = text(raw.store, 64);
  const provider = text(raw.provider, 64);
  const id = text(raw.id, 128);
  if (!store || !provider || !id || !KEY.test(store) || !KEY.test(provider) || !KEY.test(id)) {
    return null;
  }
  const command = typeof raw.command === 'string' && COMMAND.test(raw.command) ? raw.command : null;
  return {
    store,
    provider,
    id,
    label: text(raw.label, 120),
    managed: raw.managed === true,
    state: STATES.has(raw.state as RuntimeLoginState)
      ? (raw.state as RuntimeLoginState)
      : 'unknown',
    expiresAt: isoDate(raw.expiresAt),
    refreshedAt: isoDate(raw.refreshedAt),
    error: text(raw.error, 300),
    command,
    note: text(raw.note, 40),
  };
}

// A report from a file or a plugin Helena does not control, made safe to show: known fields
// only, strings cut, logins capped. Null when it names no time.
export function normalizeRuntimeLoginReport(
  value: unknown,
  source: string,
): RuntimeLoginReport | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const checkedAt = isoDate(raw.checkedAt);
  if (!checkedAt) return null;
  const interval = raw.intervalSeconds;
  const seen = new Set<string>();
  const logins = (Array.isArray(raw.logins) ? raw.logins : [])
    .map(loginFrom)
    .filter((login): login is RuntimeLogin => {
      if (!login) return false;
      const key = `${login.store}:${login.provider}:${login.id}`;
      return !seen.has(key) && !!seen.add(key);
    })
    .slice(0, MAX_LOGINS);
  return {
    source,
    reporter: text(raw.reporter, 64) ?? source,
    checkedAt,
    intervalSeconds:
      typeof interval === 'number' && Number.isFinite(interval) && interval > 0
        ? Math.min(Math.round(interval), 7 * 24 * 3600)
        : null,
    logins,
    errors: (Array.isArray(raw.errors) ? raw.errors : [])
      .map((error) => text(error, 300))
      .filter((error): error is string => error !== null)
      .slice(0, 10),
  };
}
