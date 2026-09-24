# Decision: provider usage limits (ChatGPT/Codex and Claude plans)

Status: accepted, 2026-09-24 · Branch: `hub/provider-limits`

Owner, 2026-09-24: "und zeige mir im Dashboard von Codex und Claude die Limits an". Helena
shows, per subscription account, how much of each limit window is used (the rolling
~5-hour window, the weekly window and the model-specific weekly windows the provider has),
the time until each resets, and a state (ok / near / limited). This file records where each
number comes from, verified against the installed tools, and what was rejected.

Verified on Kingston, 2026-09-24, against: Claude Code 2.1.281 (the pinned
`/opt/helena/runtimes/claude/2.1.281` binary and the owner's own `~/.local/bin/claude`, same
version), Codex CLI 0.156.1 (`/opt/helena/runtimes/codex/0.156.1`, and the owner's own, same
version), Hermes at `80cb510bfe` (`/srv/volition/source/hermes`, the runner's venv).

## 1. What the providers offer

### ChatGPT plan (Codex backend)

| Way | What it gives | Verified |
|---|---|---|
| `GET https://chatgpt.com/backend-api/wham/usage` with the ChatGPT OAuth bearer | `plan_type`, `rate_limit.{primary,secondary}_window.{used_percent, limit_window_seconds, reset_after_seconds, reset_at}`, `additional_rate_limits[] {limit_name, metered_feature, rate_limit}` (model-specific buckets), `credits`, `rate_limit_reached_type`, `rate_limit_reset_credits`, plus `account_id`, `user_id`, `email` | Codex binary: `RateLimitStatusPayload`, `/wham/usage` (and `/api/codex/usage` for non-ChatGPT bases). Hermes `agent/account_usage.py` mirrors it |
| Response headers on every Codex model call: `x-<limit>-primary-used-percent`, `-primary-window-minutes`, `-primary-reset-at`, the same for `secondary`, `x-codex-active-limit`, `x-codex-credits-*`, `x-codex-rate-limit-reached-type` | the same windows, passively | strings in the Codex binary. **Nobody downstream exposes them:** `codex exec --json` emits only `thread.started`, `turn.*`, `item.*`, `error` (usage = token counts, no rate limits), and Hermes' `openai-codex` provider does not read them (its `rate_limit_tracker` knows only `x-ratelimit-*`) |
| Codex app-server (JSON-RPC over stdio, the protocol the IDE extensions use): `account/rateLimits/read` → `GetAccountRateLimitsResponse {rateLimits, rateLimitsByLimitId, accountId, ordinaryUsageAllowed, rateLimitResetCredits}`; `RateLimitSnapshot {limitId, limitName, primary/secondary {usedPercent, windowDurationMins, resetsAt}, planType, credits, rateLimitReachedType}`; the notification `account/rateLimits/updated` | the documented client view, including the model buckets (`rateLimitsByLimitId`) | `codex app-server generate-json-schema` (0.156.1); a live read with the owner's own login: `pro`, one bucket `codex`, `primary` = 46 % of a **10 080-minute (weekly) window, no 5-hour window**, 2 reset credits banked. Without a login: error `-32600 "codex account authentication required to read rate limits"` |
| `codex exec --json` `token_count` events | not in the exec JSONL of 0.156.1 (`TokenCountEvent.rate_limits` exists only in the app-server/TUI protocol) | strings in the binary |
| Hermes `hermes usage --provider openai-codex --json` | Hermes' stable document `{provider, source, title, plan, fetched_at, windows[{label, used_percent, resets_at, detail}], details[], unavailable_reason}`, windows labelled by duration ("Session" = 18 000 s, "Weekly" = 604 800 s, Hermes #65387), from the same `/wham/usage`, with Hermes' own credential resolution (singleton store, then credential pool) and 401 refresh | `hermes_cli/subcommands/usage.py` ("keep the keys stable; extend only by adding keys"), present in the installed Hermes (`hermes usage --help`) |

The windows are classified **by duration, never by position**: the owner's Pro plan has only
a weekly window today, and it arrives as `primary`.

### Claude plan (claude.ai)

| Way | What it gives | Verified |
|---|---|---|
| `GET https://api.anthropic.com/api/oauth/usage` with the OAuth bearer and `anthropic-beta: oauth-2025-04-20` | `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, … `{utilization, resets_at}`, `extra_usage`, and the newer `limits[]` rows `{kind: session|weekly_all|weekly_scoped, group, percent, resets_at, scope.model.display_name, severity, is_active}` | Claude Code binary (`MV={plain:"/api/oauth/usage"…}`, `Uu="oauth-2025-04-20"`) |
| … with a `claude setup-token` token | **refused by design**: Claude Code only calls the endpoint when the token has the `user:profile` scope (`if(!pt()||!up())return{}`, `up()` = scopes include `user:profile`); its own text: "env-var and setup-token sessions default to user:inference only". A setup-token cannot read the usage endpoint | Claude Code binary |
| Response headers on every Messages call of an OAuth (subscription) session: `anthropic-ratelimit-unified-status`, `-5h-utilization`, `-5h-reset`, `-7d-utilization`, `-7d-reset`, `-representative-claim`, `-overage-*`, … | the 5-hour and weekly windows, passively, for **any** OAuth token including setup-token; absent for API keys | Claude Code binary (26 header names) |
| Claude Code `stream-json` event `{"type":"rate_limit_event","rate_limit_info":{status, resetsAt, rateLimitType, utilization, unifiedWindows:{five_hour,seven_day,seven_day_overage_included:{utilization (0–1), resetsAt (epoch s)}}, overageStatus, …}}` | exactly those headers, emitted "when a window's rounded percentage or reset time moves"; `status`/`resetsAt`/`rateLimitType`/`utilization` are public Agent SDK fields, `unifiedWindows` is marked `@internal` | Claude Code binary (`yRr` schema; `rate_limit_event:!0` in the stream-json output table) |
| `claude -p "/usage" --output-format stream-json --verbose` | `/usage` is a **local** command (`supportsNonInteractive`): no model call. The synthetic assistant message carries `usage_report.rate_limits = {limits[], extra_usage}` — the server's rows verbatim, "a new meter needs no client release". `null` for a token without `user:profile` | live run with the owner's login in `--safe-mode --no-session-persistence`: 0 turns, 0 tokens, 281 ms; rows `session` 80 % (severity `warning`), `weekly_all` 21 %, `weekly_scoped` "Fable" 0 %, `extra_usage` off (monthly limit 17 000 minor units EUR) |
| Hermes `hermes usage --provider anthropic --json` | the same endpoint, but only with an OAuth token Hermes itself holds, and only the classic fields (no `limits[]`) | `agent/account_usage.py` |

## 2. Decision

**One extension point, `UsageLimitSource`, in `@helena/sdk` (`usage-limits.ts`), and the
built-in sources as its first entries.** A source reads the numbers where a login already
lives, inside the process that already holds it, and hands Helena numbers only.

| Source (id) | Where it runs | How | When |
|---|---|---|---|
| `hermes` | runner (as `volition-hermes`, or the project user under isolation) | Hermes' own `agent.account_usage.fetch_account_usage(provider)` under Hermes' interpreter, rendered with Hermes' stable `usage_snapshot_document`, plus the documented `snapshot.raw` extras ("for integrations that need fields Hermes does not normalize yet"): window durations, `additional_rate_limits`, reached type, credits, and a **hash** of `account_id`. Nothing else of `raw` leaves the bridge (it holds the e-mail and user id) | probe, per distinct login store (the profile's own `auth.json` if it has one, else the Hermes root store all profiles fall back to), for the providers the served agents use |
| `codex` | runner (Codex CLI agents) and the owner reporter | `codex app-server` → `initialize` → `account/rateLimits/read {excludeResetCreditDetails: true}` in the agent's `CODEX_HOME`; only where that home holds a ChatGPT login (`auth.json` exists; an API-key login has no plan windows). Serialized with the agent's `LoginStartGate`, since the app-server may refresh that login | probe |
| `claude-code` | runner (Claude Code agents) and the owner reporter | **passive** for agents: the `rate_limit_event` lines of every run and chat answer (setup-token sessions carry the unified headers). **Probe** only where a full login is stored (`.credentials.json` in the config dir — the owner's own, or an agent's own `/login`): `claude --safe-mode -p "/usage" --output-format stream-json --verbose --no-session-persistence`, reading `usage_report.rate_limits.limits[]` | passive on every Claude run; probe for full logins |
| `spool` | API | reads snapshot files a host tool dropped into `HELENA_LIMITS_SPOOL_DIR` (numbers only, validated like everything else) | every minute, on change |

- **The owner's own logins** (Claude Code and Codex in the owner terminal, `~wilhelmpa`) are
  read by the **owner reporter**: `node packages/runner/dist/cli.js limits-report` run by a
  systemd timer **as the owner** (`deployment/volition-stack/native/limits/`), which runs the
  `claude-code` and `codex` probes with the owner's own CLIs and writes the snapshots to the
  spool (`/var/lib/helena-limits/reports/owner.json`, 0644, numbers only). The API has no
  channel into the owner's home, and nothing of the login leaves it. This is the private
  part of this install; Docker installs leave the spool unset.
- **Dedupe.** A snapshot names its account by a hash (sha256, 16 hex) of the provider's
  account id where the provider gives one (ChatGPT: `account_id` from `/wham/usage` and
  `accountId` from the app-server, the same id), else of the login's location. So Hermes'
  ChatGPT login and the owner's Codex login on the same ChatGPT account are one row.
- **Cadence.** The API's `provider-limits` loop asks every online agent's runner for
  `limits.read` (a runtime request, the channel hermes-in-helena built) once per interval
  (Administrator → Agenten-Laufzeit → Limits, default 10 min, 5–60). The runner caches a
  probe per login for the interval, so nine agents on one ChatGPT login make **one** request
  to OpenAI. "Aktualisieren" forces a probe (at most one per login per 60 s). Passive Claude
  snapshots are posted to `POST /agent-runtime/limits` when a window moves, at most once a
  minute per login, and once at the end of the run.
- **State.** Per window: `limited` at ≥ 100 % or when the provider says so (Codex
  `rate_limit_reached_type`, Claude `status: rejected`, severity `critical`); `near` at ≥ the
  owner's threshold (default 80 %) or severity `warning`; `ok` below; a window whose reset
  time passed counts as 0 % until the next probe. An account's state is its worst window's.
  A snapshot older than three intervals shows "veraltet".
- **Storage.** `helena_provider_limit` (one row per provider + account: plan, windows, credits,
  source, login, via, observed_at) and `helena_provider_limit_agent` (which agents use it,
  when last). Migration `helena_provider_limits`. Tokens, e-mails and raw provider bodies
  never reach the DB, a log, a prompt or the browser.
- **API.** `GET /provider-limits` (OpenAPI; Administrator or an agent; also the read-only MCP
  tool `get_provider_limits`, category `read`, so agents and the Autopilot can plan around
  limits), `POST /provider-limits/refresh`, `GET|PATCH /provider-limits/settings`
  (Administrator), `POST /agent-runtime/limits` (runner).
- **Hooks into what exists.**
  - hermes-in-helena's ledger `agent_usage`: each window shows how many tokens Helena's
    agents on that account spent since the window started (`resetsAt − duration`).
  - Autopilot (hub/autopilot, proposal, optional, not built here): an evaluator in its
    budget step reads `agentLimitState(agentId)` (exported by the API module) and defers
    non-urgent runs while the agent's account is `limited` — or, above an owner threshold
    (e.g. 90 %), until the window resets. Off by default; the numbers and the helper are
    ready.
  - Health overview: the Home "Systemstatus" section lists an account that is `limited`, or
    whose numbers are stale, as a problem line.
- **UI.** Home (Start), for the Administrator: a compact "Limits" card, one row per account
  (provider, plan, state) with one bar per window (5 h, Woche, model windows), used %, reset
  countdown, "Stand" and a refresh button. Details and settings: Administrator →
  Agenten-Laufzeit → Limits (every window with its reset time, the agents on the account,
  their tokens in the window, source and last update; interval and threshold).

## 3. Rejected

- **Helena calling `/wham/usage` or `/api/oauth/usage` itself** with a token from Hermes'
  store, `~/.codex/auth.json` or `~/.claude/.credentials.json`: Helena would read tokens,
  refresh rotating refresh tokens behind the owning tool's back (which logs the tool out),
  and Anthropic does not allow third-party products to use claude.ai logins (see
  `cli-runtimes.md` §4). The tools that own the logins do it instead.
- **A small model call as a probe** (to read the unified or `x-codex-*` headers): spends the
  very quota it measures and adds a turn per interval.
- **`codex exec --json`** for Codex: carries no rate limits in 0.156.1.
- **`claude -p "/usage"` text** or Claude Code's statusline JSON: the text is for people; the
  statusline only runs in interactive sessions of the person, and would need the owner's
  `settings.json` changed. The structured `usage_report` of the same local command is used.
- **The `get_usage` control request** of Claude Code's SDK protocol: the same data, marked
  experimental, and needs a stream-json input session; the `/usage` twin is the documented
  sibling for remote clients.
- **Parsing Codex windows by position** (`primary` = 5 h): wrong for today's Pro plan (weekly
  only). Classified by `windowDurationMins` / `limit_window_seconds`.
- **Passive capture inside Hermes** (reading `x-codex-*` / `anthropic-ratelimit-unified-*` in
  its providers and emitting them in its stream-json): the right long-term source for Hermes
  runs, but a Hermes change; proposed upstream as a follow-up. Until then the Hermes source
  probes.
- **A runner-side timer** per agent: N agents would probe N times; the API already knows who
  is online and holds the interval the owner sets. The runtime-request channel and a
  per-login cache give one probe per login.
- **A new UI slot for Home sections:** Home is not on the slot registry yet (framework §8:
  "each gets wired when its screen is next reworked"); the card is a built-in section.
- **Third-party libraries:** none needed. The Codex app-server client is 60 lines of
  JSON-RPC over stdio; parsing is by hand against the verified shapes. OpenRouter credits
  (Hermes also reads them) are a candidate plugin source, not built in.

## 4. What changes when the providers change

- A new Claude meter (`limits[]` row) shows up without a Helena change (rows are passed
  through with their kind, scope and severity).
- A new Codex model bucket shows up through `rateLimitsByLimitId` / `additional_rate_limits`.
- A new provider is a plugin: `ctx.usageLimitSources.register({ id, label, providers,
  probes?, observe?, poll? })`, declared in `provides.usageLimitSources`.
