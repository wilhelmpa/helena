import { createHash } from 'node:crypto';
import {
  windowKindOf,
  type UsageLimitExtra,
  type UsageLimitSnapshot,
  type UsageLimitWindow,
  type UsageLimitWindowKind,
} from '@helena/sdk';

// Turns what each tool prints about a plan's limits into @helena/sdk snapshots. Every
// function here reads only the fields it names; nothing else of a tool's answer (e-mail,
// user id, account id, banner texts) is carried on. The shapes were verified against the
// installed tools (docs/helena-decisions/provider-limits.md §1).

type Json = Record<string, unknown>;

const obj = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const money = (value: unknown): number | null => {
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return num(value);
};

// The account key: a hash of the provider's own account id, so two logins to one account
// (Hermes' ChatGPT login and the owner's Codex) end up as one row, and the id never leaves
// the runner. Hermes' bridge computes the same with the same input.
export function accountHash(provider: string, id: string): string {
  return createHash('sha256').update(`${provider}:${id}`).digest('hex').slice(0, 16);
}

// Where no account id is to be had: a hash of where the login is stored.
export function locationHash(source: string, location: string): string {
  return `loc-${createHash('sha256').update(`${source}:${location}`).digest('hex').slice(0, 16)}`;
}

function epochIso(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

function isoOrNull(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

// `GPT-5.3 Codex Spark` → `gpt-5.3-codex-spark`, for a window id.
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9._]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'window'
  );
}

function window(fields: Partial<UsageLimitWindow> & Pick<UsageLimitWindow, 'id' | 'kind'>) {
  return {
    label: null,
    usedPercent: null,
    windowMinutes: null,
    resetsAt: null,
    severity: null,
    limited: null,
    ...fields,
  } satisfies UsageLimitWindow;
}

const PLAN_WIDE: Record<string, UsageLimitWindowKind> = { session: 'session', weekly: 'weekly' };

// A plan-wide window's id is its kind (`session`, `weekly`); a second one of the same kind
// (two session windows) gets its position on.
function uniqueIds(windows: UsageLimitWindow[]): UsageLimitWindow[] {
  const seen = new Map<string, number>();
  return windows.map((entry) => {
    const count = seen.get(entry.id) ?? 0;
    seen.set(entry.id, count + 1);
    return count === 0 ? entry : { ...entry, id: `${entry.id}-${count + 1}` };
  });
}

// ── ChatGPT plan through Codex' app-server (`account/rateLimits/read`) ────────────────────

interface CodexWindow {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
}

function codexWindows(bucketId: string, bucket: Json, planWide: boolean): UsageLimitWindow[] {
  const label = planWide
    ? null
    : (str(bucket.limitName) ?? str(bucket.normalModelSlug) ?? bucketId);
  const reached = str(bucket.rateLimitReachedType) !== null;
  const out: UsageLimitWindow[] = [];
  for (const slot of ['primary', 'secondary'] as const) {
    const raw = obj(bucket[slot]) as CodexWindow | null;
    if (!raw) continue;
    const minutes = num(raw.windowDurationMins);
    const byLength = windowKindOf(minutes);
    const used = num(raw.usedPercent);
    out.push(
      window({
        id: planWide
          ? (PLAN_WIDE[byLength] ?? `${slot}`)
          : `${slug(bucketId)}:${byLength === 'other' ? slot : byLength}`,
        kind: planWide ? byLength : 'model',
        label,
        usedPercent: used,
        windowMinutes: minutes,
        resetsAt: epochIso(num(raw.resetsAt)),
        limited: reached && used !== null && used >= 100 ? true : null,
      }),
    );
  }
  return out;
}

function codexCredits(value: unknown): UsageLimitExtra | null {
  const credits = obj(value);
  if (!credits) return null;
  return {
    kind: 'credits',
    enabled: credits.hasCredits === true || credits.has_credits === true,
    unlimited: credits.unlimited === true,
    balance: money(credits.balance),
    used: null,
    limit: null,
    currency: null,
  };
}

export function fromCodexRateLimits(
  response: unknown,
  meta: { source: string; login: string; fallbackAccount: string; observedAt?: string },
): UsageLimitSnapshot | null {
  const answer = obj(response);
  const main = obj(answer?.rateLimits);
  if (!answer || !main) return null;
  const buckets = obj(answer.rateLimitsByLimitId) ?? { [str(main.limitId) ?? 'codex']: main };
  const mainId = str(main.limitId) ?? 'codex';
  const windows: UsageLimitWindow[] = [];
  // The plan-wide bucket first, then the model buckets in the provider's order.
  for (const [id, value] of [
    [mainId, buckets[mainId] ?? main] as const,
    ...Object.entries(buckets).filter(([id]) => id !== mainId),
  ]) {
    const bucket = obj(value);
    if (bucket) windows.push(...codexWindows(id, bucket, id === mainId));
  }
  const accountId = str(answer.accountId);
  const ordinary =
    typeof answer.ordinaryUsageAllowed === 'boolean' ? answer.ordinaryUsageAllowed : null;
  const reached = str(main.rateLimitReachedType) !== null;
  return {
    provider: 'openai-codex',
    account: accountId ? accountHash('openai-codex', accountId) : meta.fallbackAccount,
    source: meta.source,
    login: meta.login,
    plan: str(main.planType),
    windows: uniqueIds(windows),
    extra: codexCredits(main.credits),
    resetCredits: num(obj(answer.rateLimitResetCredits)?.availableCount),
    allowed: ordinary === false || reached ? false : ordinary,
    via: 'probe',
    observedAt: meta.observedAt ?? new Date().toISOString(),
    unavailable: null,
  };
}

// ── Hermes' `usage_snapshot_document`, with the bridge's extras ─────────────────────────

// Hermes' labels for the windows it names itself (agent/account_usage.py).
const HERMES_LABELS: Record<
  string,
  { id: string; kind: UsageLimitWindowKind; minutes: number | null; label: string | null }
> = {
  session: { id: 'session', kind: 'session', minutes: 300, label: null },
  weekly: { id: 'weekly', kind: 'weekly', minutes: 10080, label: null },
  'current session': { id: 'session', kind: 'session', minutes: 300, label: null },
  'current week': { id: 'weekly', kind: 'weekly', minutes: 10080, label: null },
  'opus week': { id: 'weekly:opus', kind: 'model', minutes: 10080, label: 'Opus' },
  'sonnet week': { id: 'weekly:sonnet', kind: 'model', minutes: 10080, label: 'Sonnet' },
};

interface BridgeWindow {
  slot?: unknown;
  used_percent?: unknown;
  limit_window_seconds?: unknown;
  reset_at?: unknown;
  reset_after_seconds?: unknown;
}

function bridgeWindow(
  raw: BridgeWindow,
  fetchedAt: number,
  model: { id: string; label: string } | null,
): UsageLimitWindow {
  const seconds = num(raw.limit_window_seconds);
  const minutes = seconds === null ? null : Math.round(seconds / 60);
  const byLength = windowKindOf(minutes);
  const slot = str(raw.slot) ?? 'primary';
  const resetAt = num(raw.reset_at);
  const after = num(raw.reset_after_seconds);
  return window({
    id: model
      ? `${slug(model.id)}:${byLength === 'other' ? slot : byLength}`
      : (PLAN_WIDE[byLength] ?? slot),
    kind: model ? 'model' : byLength,
    label: model?.label ?? null,
    usedPercent: num(raw.used_percent),
    windowMinutes: minutes,
    resetsAt:
      resetAt !== null
        ? epochIso(resetAt)
        : after !== null
          ? new Date(fetchedAt + after * 1000).toISOString()
          : null,
  });
}

export function fromHermesDocument(
  document: unknown,
  meta: { source: string; login: string; fallbackAccount: string },
): UsageLimitSnapshot | null {
  const doc = obj(document);
  const provider = str(doc?.provider);
  if (!doc || !provider) return null;
  const extra = obj(doc.helena) ?? {};
  const observedAt = isoOrNull(doc.fetched_at) ?? new Date().toISOString();
  const fetchedAt = Date.parse(observedAt);
  let windows: UsageLimitWindow[] = [];
  const measured = Array.isArray(extra.windows) ? (extra.windows as BridgeWindow[]) : [];
  if (measured.length > 0) {
    // The bridge's copy of the windows carries their length, which Hermes' document drops.
    windows = measured.map((raw) => bridgeWindow(raw, fetchedAt, null));
  } else {
    for (const raw of Array.isArray(doc.windows) ? doc.windows : []) {
      const entry = obj(raw);
      const label = str(entry?.label);
      if (!entry || !label) continue;
      const known = HERMES_LABELS[label.toLowerCase()];
      windows.push(
        window({
          id: known?.id ?? slug(label),
          kind: known?.kind ?? 'other',
          label: known ? known.label : label,
          usedPercent: num(entry.used_percent),
          windowMinutes: known?.minutes ?? null,
          resetsAt: isoOrNull(entry.resets_at),
        }),
      );
    }
  }
  for (const raw of Array.isArray(extra.additional) ? extra.additional : []) {
    const bucket = obj(raw);
    const name = str(bucket?.name) ?? str(bucket?.feature);
    if (!bucket || !name) continue;
    const model = { id: str(bucket.feature) ?? name, label: name };
    for (const entry of Array.isArray(bucket.windows) ? bucket.windows : []) {
      windows.push(bridgeWindow(entry as BridgeWindow, fetchedAt, model));
    }
  }
  const credits = obj(extra.credits);
  const limitReached = extra.limit_reached === true || str(extra.reached) !== null;
  const allowed =
    extra.allowed === false || limitReached ? false : extra.allowed === true ? true : null;
  const unavailable = str(doc.unavailable_reason);
  return {
    provider,
    account: str(extra.account) ?? meta.fallbackAccount,
    source: meta.source,
    login: meta.login,
    plan: str(doc.plan)?.toLowerCase() ?? null,
    windows: uniqueIds(windows),
    extra: credits
      ? {
          kind: 'credits',
          enabled: credits.has_credits === true,
          unlimited: credits.unlimited === true,
          balance: money(credits.balance),
          used: null,
          limit: null,
          currency: null,
        }
      : null,
    resetCredits: num(extra.reset_credits),
    allowed,
    via: 'probe',
    observedAt,
    // Hermes explains in words; Helena only needs to know there are no numbers. Its one
    // documented case is an Anthropic API key, which has no plan windows.
    unavailable: unavailable ? (/oauth/i.test(unavailable) ? 'api_key' : 'unsupported') : null,
  };
}

// ── Claude plan: Claude Code's `/usage` twin and its `rate_limit_event` ─────────────────

const SEVERITIES = new Set(['normal', 'warning', 'critical']);

// `usage_report.rate_limits` of `claude -p "/usage" --output-format stream-json`: the usage
// endpoint's `limits[]` rows as sent (kind, group, percent, resets_at, scope, severity).
export function fromClaudeUsageReport(
  report: unknown,
  meta: {
    source: string;
    login: string;
    account: string;
    plan: string | null;
    observedAt?: string;
  },
): UsageLimitSnapshot | null {
  const rateLimits = obj(obj(report)?.rate_limits);
  if (!rateLimits) return null;
  const windows: UsageLimitWindow[] = [];
  for (const raw of Array.isArray(rateLimits.limits) ? rateLimits.limits : []) {
    const row = obj(raw);
    const kind = str(row?.kind);
    if (!row || !kind) continue;
    const scope = obj(row.scope);
    const scoped = str(obj(scope?.model)?.display_name) ?? str(obj(scope?.surface)?.display_name);
    const severity = str(row.severity);
    const common = {
      usedPercent: num(row.percent),
      resetsAt: isoOrNull(row.resets_at),
      severity:
        severity && SEVERITIES.has(severity) ? (severity as UsageLimitWindow['severity']) : null,
    };
    if (kind === 'session') {
      windows.push(window({ id: 'session', kind: 'session', windowMinutes: 300, ...common }));
    } else if (kind === 'weekly_all') {
      windows.push(window({ id: 'weekly', kind: 'weekly', windowMinutes: 10080, ...common }));
    } else if (kind === 'weekly_scoped' && scoped) {
      windows.push(
        window({
          id: `weekly:${slug(scoped)}`,
          kind: 'model',
          label: scoped,
          windowMinutes: 10080,
          ...common,
        }),
      );
    } else {
      const group = str(row.group);
      windows.push(
        window({
          id: slug(scoped ? `${kind}-${scoped}` : kind),
          kind: group === 'session' ? 'session' : group === 'weekly' ? 'weekly' : 'other',
          label: scoped ?? kind,
          ...common,
        }),
      );
    }
  }
  const extra = obj(rateLimits.extra_usage);
  // Amounts arrive in minor units of the currency (cents).
  const minor = (value: unknown) => {
    const amount = num(value);
    return amount === null ? null : amount / 100;
  };
  return {
    provider: 'anthropic',
    account: meta.account,
    source: meta.source,
    login: meta.login,
    plan: meta.plan,
    windows: uniqueIds(windows),
    extra: extra
      ? {
          kind: 'extra_usage',
          enabled: extra.is_enabled === true,
          unlimited: false,
          balance: null,
          used: minor(extra.used_credits),
          limit: minor(extra.monthly_limit),
          currency: str(extra.currency),
        }
      : null,
    resetCredits: null,
    allowed: null,
    via: 'probe',
    observedAt: meta.observedAt ?? new Date().toISOString(),
    unavailable: null,
  };
}

const RATE_LIMIT_TYPES: Record<
  string,
  { id: string; kind: UsageLimitWindowKind; label: string | null }
> = {
  five_hour: { id: 'session', kind: 'session', label: null },
  seven_day: { id: 'weekly', kind: 'weekly', label: null },
  seven_day_opus: { id: 'weekly:opus', kind: 'model', label: 'Opus' },
  seven_day_sonnet: { id: 'weekly:sonnet', kind: 'model', label: 'Sonnet' },
  seven_day_overage_included: { id: 'weekly:overage-included', kind: 'model', label: null },
};

const MINUTES: Record<UsageLimitWindowKind, number | null> = {
  session: 300,
  weekly: 10080,
  model: 10080,
  monthly: null,
  other: null,
};

// `rate_limit_info` of a `rate_limit_event` line: the unified rate-limit headers of the
// responses a Claude Code session got (utilization is a fraction, resetsAt epoch seconds).
export function fromClaudeRateLimitInfo(
  info: unknown,
  meta: { source: string; login: string; account: string; observedAt?: string },
): UsageLimitSnapshot | null {
  const value = obj(info);
  if (!value) return null;
  const windows = new Map<string, UsageLimitWindow>();
  const put = (type: string, utilization: number | null, resetsAt: number | null) => {
    const known = RATE_LIMIT_TYPES[type];
    if (!known || utilization === null) return;
    windows.set(
      known.id,
      window({
        id: known.id,
        kind: known.kind,
        label: known.label,
        usedPercent: Math.round(utilization * 1000) / 10,
        windowMinutes: MINUTES[known.kind],
        resetsAt: epochIso(resetsAt),
      }),
    );
  };
  for (const [type, raw] of Object.entries(obj(value.unifiedWindows) ?? {})) {
    const entry = obj(raw);
    if (entry) put(type, num(entry.utilization), num(entry.resetsAt));
  }
  const status = str(value.status);
  const type = str(value.rateLimitType);
  // The top-level fields describe the window that limits right now.
  if (type && !windows.has(RATE_LIMIT_TYPES[type]?.id ?? '')) {
    put(type, num(value.utilization), num(value.resetsAt));
  }
  const current = type ? windows.get(RATE_LIMIT_TYPES[type]?.id ?? '') : undefined;
  if (current && status === 'allowed_warning') current.severity = 'warning';
  if (current && status === 'rejected') current.limited = true;
  if (windows.size === 0 && !status) return null;
  return {
    provider: 'anthropic',
    account: meta.account,
    source: meta.source,
    login: meta.login,
    plan: null,
    windows: [...windows.values()],
    extra: null,
    resetCredits: null,
    allowed: status === 'rejected' ? false : status ? true : null,
    via: 'passive',
    observedAt: meta.observedAt ?? new Date().toISOString(),
    unavailable: null,
  };
}
