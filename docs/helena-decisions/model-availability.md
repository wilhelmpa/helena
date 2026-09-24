# Decision: model availability (which models the accounts really serve)

Status: accepted, 2026-09-24 · Branch: `hub/model-availability`

The live E2E test of 2026-09-24 19:07 ran a copy of the agent-pool template "QA & Tests"
(agent 31) on `gpt-6-terra`. Codex with the owner's ChatGPT account answered
`HTTP 400: The 'gpt-6-terra' model is not supported when using Codex with a ChatGPT account.`
(the Codex CLI itself says the same). Hermes called it final ("retrying won't help"), yet the
agent-team stage ran it three times, twice (runs 16–21), and the run's error read
`session_id: 20260924_…`. The catalog Helena offered listed 29 models; the account's own
`/models` endpoint lists five (`gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`,
`gpt-5.6-luna`, `gpt-5.5`); Hermes adds `gpt-6-sol/-terra/-luna` and `gpt-5.3-codex-spark` as
"forward compat" models and a `-900k` large-context variant of each. `gpt-6-sol` and
`gpt-6-luna` work; `gpt-6-terra` does not.

## 1. What exists (research)

| Candidate                                                                                                                                                            | What it gives                                                                  | Fit                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The account's own model list (Codex `chatgpt.com/backend-api/codex/models`, OpenAI/Anthropic `GET /v1/models`)                                                       | what the account lists                                                         | Necessary but not sufficient: the Codex list omits models that work (`gpt-6-sol`) and the list can lag. Used: the catalog marks each model `listed` or not.                                                                                                    |
| Hermes' forward-compat catalog (`hermes_cli/codex_models._finalize_codex_models`)                                                                                    | newer slugs expected to work, plus `-900k` variants                            | Kept (it is right for `gpt-6-sol/-luna`), but marked `listed: false`, and `-900k` names its base (`variantOf`).                                                                                                                                                |
| models.dev (already the price table's source)                                                                                                                        | a public catalog of models per provider                                        | Says nothing about one account's entitlement. Not used here.                                                                                                                                                                                                   |
| LiteLLM proxy "model health checks" (`/health` pings every model)                                                                                                    | availability by probing                                                        | An extra Python service with its own config; probing spends quota on every check and on every start. Rejected (Hermes + Postgres stay the only runtime dependencies).                                                                                          |
| Probing in the catalog script (one token per synthesized model)                                                                                                      | a verdict before first use                                                     | The catalog script runs at every runner start and is kept credential-read-only by design; probes cost quota and rate-limit headroom, and a probe's answer can differ from a real run's (tools, reasoning). Rejected: learning from real use is free and exact. |
| Vercel AI SDK `APICallError.isRetryable`, Temporal `ApplicationFailure.nonRetryable`, HTTP semantics (RFC 9110: a 4xx about the request does not change when resent) | the standard split between retryable and final failures                        | Adopted as the model: `RuntimeFailure.retryable`.                                                                                                                                                                                                              |
| Hermes' own classifier (`agent/error_classifier.FailoverReason`, `failure_reason`/`failure_retryable` on the turn result)                                            | a verdict per failure: `model_not_found`, `format_error`, `auth`, `billing`, … | The best source, but `hermes chat --format stream-json` does not put it on the `result` line yet. The runner reads it when present (forward compatible) and reads the provider's words otherwise. Suggested Hermes patch in §6.                                |
| OTel GenAI semantic conventions (`error.type`)                                                                                                                       | a name for the failure class on a span                                         | The failure code is the value hub/hermes-in-helena can put there; nothing else needed now.                                                                                                                                                                     |

## 2. Decision

1. **The runtime says why it failed (extension point).** `@helena/sdk` gets
   `RuntimeFailure {code, retryable, model?, detail?}` and `RuntimeType.classifyFailure(input)`
   (`packages/sdk/src/runtime-failures.ts`). Every built-in runtime (Hermes, Claude Code,
   Codex, …) registers `classifyProviderFailure`, which reads a provider refusal from the
   runtime's words: Codex/ChatGPT ("The 'x' model is not supported …"), Hermes' own copy of
   a `model_not_found` ("Model 'x' isn't available on …"), the OpenAI API ("The model `x`
   does not exist …"), the Anthropic API (`not_found_error … model: x`), plain gateway forms,
   and Hermes' "retrying won't help". Codes: `model-unavailable` (final, names the model),
   `provider-rejected` (final, no model). A refused login, a used-up plan, a rate limit, a
   timeout or a crash is **not** classified here: a login signed in again or a limit that
   resets lets the same request pass (hub/token-keeper and the provider limits own those).
   A plugin runtime brings its own classifier.
2. **The runner reports it** (`packages/runner`): `Outcome.failure`, sent with the run
   result and the chat result, and as the `code` of the AG-UI `RUN_ERROR` event. The run's
   error is the provider's words (Hermes' `error` on the result line, else the "Provider
   said" line of its text), never Hermes' trailing `session_id: …` stderr line. The runner
   also reports the provider it routed the model to (`RunModelReport.requested.provider`).
3. **Helena records what it learns** (`helena_model_availability`, one row per runtime,
   provider and model):
   - `unavailable` when a run or chat answer failed with `model-unavailable` (with the
     provider's words, the agent, the run or answer, since/last seen);
   - `works` when a run or answer on the model succeeded and its session really ran that
     model (a fallback model that answered says nothing about the one asked for). A
     success clears a refusal. At most one write per model and hour.
   - The owner clears a finding ("Erneut prüfen"): the next use tries the model again.
     Findings are per **runtime** (Claude Code and Codex sign in with logins of their own) and
     per provider; a `-900k` variant shares its base model's finding.
     Instance-wide, not per team: the logins are the instance's.
4. **The pickers leave a refused model out.** The chat catalog
   (`/…/chat/catalog`) returns `models` without it and names it under `unavailable` (with
   the provider's words and the finding's id); a chat cannot be sent on it (400); the
   workflow builder does not offer it as a step's model. Every other model carries
   `verified`: `true` (listed by the account or seen working), `false` (only Hermes expects
   it to work: shown as "ungeprüft"), unset (unknown, e.g. Anthropic, whose list is not
   account-scoped here).
5. **Fail fast.** The run queue never retried a reported failure; the engine did. An
   agent-team stage whose run failed with `retryable: false` fails after that one attempt,
   whatever attempts the policy has left, and the engine does not even queue a stage (or a
   workflow agent step) on a model that is already recorded as refused
   (`ModelRefusedFailure`). Ordinary runs (a mention, a delegation) still start, so a model
   that came back clears itself on the next success.
6. **Clear words, in the reader's language.** The failure code and model ride on the run
   (`agent_run.failure`), the chat answer (`agent_chat_message.failure`), the step (its run's
   failure, or `state.runtimeFailure` for a stage the engine refused), the task's activity
   (`agent_finished` with subject `model-unavailable`), the team run, the workflow run and
   the health overview's engine failures. The web words them from `modelAvailability.*` in
   all ten languages, e.g. "Modell gpt-6-terra ist für dein ChatGPT-Konto nicht verfügbar –
   wähle für den Agenten ein anderes Modell. Ein erneuter Versuch hilft nicht."; the
   provider's own words stay the tooltip. The engine's stored English message now carries
   the provider's words too.
7. **Where the owner sees it.** The agent editor (a refused model: "… nicht verfügbar – wähle
   ein anderes Modell", the provider's words, "Agenten-Standard verwenden", "Erneut
   prüfen"; a template copy that fell back: why), the chat composer's model picker (the
   thread's model turns red; "ungeprüft" marks), Home → health overview (each refused model
   with the agents still set to it), Administrator → Agenten-Laufzeit → **Modelle** (every
   finding, "Erneut prüfen", "Alle umstellen auf …"), the task and the run views.
8. **Templates.** Copying a template whose model is refused gives the copy the agent default
   (`model: null`, its reasoning level with it) and answers `modelFallback {model, detail}`
   (the copy dialog shows it; the MCP tool `copy_ai_agent_template` returns it); a template
   sync never pushes a refused model to a copy. "Alle umstellen" (`POST
/teams/:teamId/model-availability/replace {from, to, dryRun}`) moves every agent and
   template of a team off a model through the editor's own update, templates carrying the
   copies that follow them, keeping a reasoning level the new model offers. Idempotent.
9. **The agent-pool bundle** runs on models the owner's accounts serve: QA & Tests and
   Datenanalyse move from `gpt-6-terra` to `gpt-5.6-terra` (listed by the account, same
   tier); `gpt-6-sol` (DevOps, Shopify) stays — it works, the catalog shows it as
   "ungeprüft" until its first success is recorded. The `claude-*` models stay; they depend
   on the Anthropic login (hub/token-keeper).
10. **What happened before the switch** is learned once by
    `apps/api/src/scripts/learn-model-availability.ts` (dry run by default; `--apply`),
    which classifies the failed runs and answers of the last days the same way.

## 3. Data model

`helena_model_availability (id, runtime, provider default '', model, state
'unavailable'|'works', reason, detail, agent_id → ai_agent, run_id → agent_run,
chat_message_id → agent_chat_message, since, observed_at)`, unique `(runtime, provider,
model)`. `agent_run.failure jsonb`, `agent_chat_message.failure jsonb`
(`RuntimeFailure`). No credential and no model answer is ever stored; `detail` is the
provider's words, at most 500 characters.

## 4. API

| Route                                                                         | Who            | What                                                                  |
| ----------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `GET /teams/:teamId/model-availability` (MCP `list_model_availability`, read) | ai_agents read | findings, each refusal with the team's agents on it                   |
| `DELETE /teams/:teamId/model-availability/:entryId`                           | ai_agents edit | "Erneut prüfen"                                                       |
| `POST /teams/:teamId/model-availability/replace`                              | ai_agents edit | "Alle umstellen" (people only, no MCP tool)                           |
| `GET/DELETE /god/model-availability[/:entryId]`                               | Administrator  | the instance-wide list                                                |
| `GET …/chat/catalog`                                                          | as before      | `models` (with `listed`, `variantOf`, `verified`) and `unavailable[]` |
| `POST /agent-runs/:id/result`, `/agent-chats/:id/result`                      | runner         | optional `failure`                                                    |
| `GET /god/system-health`                                                      | Administrator  | `models.unavailable[]`; `engine.lastErrors[].failure`                 |

## 5. Rejected

- **Hiding every model the account does not list.** It would hide `gpt-6-sol` and
  `gpt-6-luna`, which work. They are marked "ungeprüft" instead.
- **A hard-coded list of bad models.** Entitlement differs per account and changes with the
  plan; the finding comes from the account's own answers and clears itself on success.
- **Refusing an agent update on a refused model.** The setup scripts and the pool import
  set models before any runner published a catalog; the editor and the health overview say
  it instead, and the engine refuses to start a stage on it.
- **German text in the database.** The engine's stored message stays English like every
  other; the views word the code in the reader's language.

## 6. Open, and a Hermes patch worth sending upstream

- Hermes' `stream_json.emit_result` drops the turn's `failure_reason`/`failure_retryable`.
  Adding them (two lines) makes the runner's reading exact instead of text-based:

  ```python
  # hermes_cli/stream_json.py, emit_result, after payload["error"]
  if data.get("failure_reason"):
      payload["failure_reason"] = str(data["failure_reason"])
  if "failure_retryable" in data:
      payload["failure_retryable"] = bool(data["failure_retryable"])
  ```

  The runner already reads both (`HermesResultReader`).

- A refused login is hub/token-keeper's: it can add `login-rejected` through the same
  `classifyFailure` hook (retryable after a new sign-in) without touching this module.
- The Claude Code and Codex runtimes publish their catalogs without a provider; their
  findings are keyed `(claude|codex, '', model)`.
