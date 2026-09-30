import { lstat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { UsageLimitAgentContext, UsageLimitProbe, UsageLimitSource } from '@helena/sdk';
import { runCommand } from '../readers/process';
import { fromHermesDocument, locationHash } from './normalize';

// The plan limits of the logins Hermes holds (its ChatGPT login for `openai-codex`, an
// Anthropic OAuth login, an OpenRouter key), read by Hermes itself: its public
// `agent.account_usage.fetch_account_usage` — what `hermes usage` and `/usage` call — under
// Hermes' own interpreter, with Hermes' own credential resolution and refresh. The bridge
// prints Hermes' stable `usage_snapshot_document` plus the few numbers of the documented
// `snapshot.raw` that the document leaves out (window lengths, model buckets, reached type,
// credits) and a hash of the account id. Nothing else of `raw` (e-mail, user id) leaves it.

export const HERMES_LIMITS_BRIDGE = `
import hashlib, json, sys
from agent.account_usage import fetch_account_usage
from hermes_cli.subcommands.usage import usage_snapshot_document

def num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None

def windows(rate_limit):
    found = []
    if not isinstance(rate_limit, dict):
        return found
    for slot in ("primary", "secondary"):
        window = rate_limit.get(slot + "_window")
        if isinstance(window, dict):
            found.append({
                "slot": slot,
                "used_percent": num(window.get("used_percent")),
                "limit_window_seconds": num(window.get("limit_window_seconds")),
                "reset_at": num(window.get("reset_at")),
                "reset_after_seconds": num(window.get("reset_after_seconds")),
            })
    return found

def text(value):
    return value[:128] if isinstance(value, str) and value.strip() else None

request = json.load(sys.stdin)
answers = []
for provider in request.get("providers", []):
    try:
        snapshot = fetch_account_usage(provider)
    except Exception:
        snapshot = None
    if snapshot is None:
        answers.append({"provider": provider, "missing": True})
        continue
    document = usage_snapshot_document(snapshot)
    document.pop("details", None)
    raw = snapshot.raw if isinstance(getattr(snapshot, "raw", None), dict) else {}
    extra = {}
    account = raw.get("account_id")
    if provider == "anthropic":
        organization = raw.get("organization")
        organization = organization if isinstance(organization, dict) else {}
        account = raw.get("organization_id") or raw.get("org_id") or organization.get("uuid") or organization.get("id") or account
    if isinstance(account, str) and account:
        extra["account"] = hashlib.sha256((provider + ":" + account).encode()).hexdigest()[:16]
    rate_limit = raw.get("rate_limit")
    extra["windows"] = windows(rate_limit)
    if isinstance(rate_limit, dict):
        if isinstance(rate_limit.get("allowed"), bool):
            extra["allowed"] = rate_limit["allowed"]
        if isinstance(rate_limit.get("limit_reached"), bool):
            extra["limit_reached"] = rate_limit["limit_reached"]
    extra["reached"] = text(raw.get("rate_limit_reached_type"))
    extra["additional"] = [
        {"name": text(item.get("limit_name")), "feature": text(item.get("metered_feature")),
         "windows": windows(item.get("rate_limit"))}
        for item in (raw.get("additional_rate_limits") or []) if isinstance(item, dict)
    ]
    credits = raw.get("credits")
    if isinstance(credits, dict):
        balance = credits.get("balance")
        extra["credits"] = {"has_credits": credits.get("has_credits") is True,
                            "unlimited": credits.get("unlimited") is True,
                            "balance": balance if isinstance(balance, (int, float, str)) else None}
    resets = raw.get("rate_limit_reset_credits")
    if isinstance(resets, dict):
        extra["reset_credits"] = num(resets.get("available_count"))
    document["helena"] = extra
    answers.append(document)
json.dump(answers, sys.stdout)
`;

const PROBE_TIMEOUT_MS = 45_000;
// Hermes' account-usage fetchers exist for these; a plugin provider profile may add more.
const DEFAULT_PROVIDERS = ['openai-codex'];

function hermesPython(env: Record<string, string>): string {
  return env.HERMES_PYTHON ?? process.env.HERMES_PYTHON ?? 'python3';
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

// The store a profile's login lives in: its own auth.json when it has one, otherwise the
// Hermes root it falls back to (profiles live in <root>/profiles/<name>). Profiles sharing
// a store share one probe. Only whether the file exists is looked at, never what is in it.
export async function hermesLoginStore(home: string): Promise<string> {
  if (await exists(join(home, 'auth.json'))) return home;
  const parent = dirname(home);
  if (basename(parent) === 'profiles') return dirname(parent);
  return home;
}

async function runBridge(
  context: UsageLimitAgentContext,
  providers: string[],
  signal?: AbortSignal,
): Promise<unknown[]> {
  if (signal?.aborted) return [];
  const result = await runCommand(hermesPython(context.env), ['-c', HERMES_LIMITS_BRIDGE], {
    env: {
      ...(process.env as Record<string, string>),
      ...context.env,
      HERMES_HOME: context.home,
      NO_COLOR: '1',
    },
    cwd: context.home,
    stdin: JSON.stringify({ providers }),
    timeoutMs: PROBE_TIMEOUT_MS,
    maxBytes: 1024 * 1024,
  });
  if (result.code !== 0) {
    // Hermes' errors can name a login; only that it failed is passed on.
    throw new Error(
      result.code === null ? 'Hermes did not answer in time' : `Hermes exited with ${result.code}`,
    );
  }
  const answer = JSON.parse(result.stdout) as unknown;
  return Array.isArray(answer) ? answer : [];
}

export const hermesLimitSource: UsageLimitSource = {
  id: 'hermes',
  label: 'Hermes',
  providers: ['openai-codex', 'anthropic', 'openrouter'],
  runtimes: ['hermes'],
  async probes(context): Promise<UsageLimitProbe[]> {
    const store = await hermesLoginStore(context.home);
    const providers = [...new Set(context.providers.length ? context.providers : DEFAULT_PROVIDERS)]
      .filter((provider) => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider))
      .slice(0, 6);
    if (providers.length === 0) return [];
    // One run of Hermes' interpreter answers for every provider of the store.
    return [
      {
        key: `hermes:${store}:${[...providers].sort().join(',')}`,
        provider: providers[0]!,
        async run(signal) {
          // Run in the agent's own profile, so Hermes resolves the logins exactly as for the
          // agent's runs; the store only keys the cache.
          const documents = await runBridge(context, providers, signal);
          return documents.flatMap((document) => {
            const provider = (document as { provider?: unknown }).provider;
            if ((document as { missing?: boolean }).missing || typeof provider !== 'string') {
              return [];
            }
            const snapshot = fromHermesDocument(document, {
              source: 'hermes',
              login: 'hermes',
              fallbackAccount: locationHash(`hermes:${provider}`, store),
            });
            return snapshot ? [snapshot] : [];
          });
        },
      },
    ];
  },
};
