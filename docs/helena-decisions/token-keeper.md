# Token keeper: the shared model logins never die because of the agent sandbox

## 2026-09-26: detect revoked, unexpired logins

Each normal timer tick also checks unexpired Anthropic and OpenAI Codex OAuth
access tokens against the read-only usage endpoint used by Hermes. No model call,
response body or redirect is used. Only HTTP 401 invalidates a login; rate limits,
403, server errors and network failures remain retryable status errors. The pool
row is re-read under Hermes' store lock before invalidation, so a late response for
an old token cannot invalidate a newly renewed pair. A new pair clears the old
rejection. The Codex CLI access token is copied from a valid Hermes pool row on each run;
the CLI receives no refresh token from that row.

Provider diagnostics are suppressed during refresh/probe requests and replaced with
fixed messages; token fragments and response bodies cannot reach the status or journal.
`views` remains offline. A dead login is excluded from new agent views and reported
as `invalid` with the existing owner-only re-login command.

Validation: 48 tests passed on Kingston with the installed Hermes interpreter and
credential-pool implementation, fake credentials, private network and temporary stores.
This includes persisted rejection, renewed-token races and recovery, transient errors,
view/catalog behavior and no provider-message leakage. No owner login was read by the
operator or changed for the test. Deployment and a normal timer/status/UI check are
still required; do not revoke a real login merely to demonstrate the failure state.

Status: decided 2026-09-24 (hub/token-keeper). Inputs: the live E2E test of 2026-09-24 19:09
(every Claude model in Hermes failed), the agent isolation design
(`docs/volition-design-agent-isolation.md` §3 "Modell-Zugang", Phase 1), Hermes at
`80cb510bfe` (`agent/credential_pool.py`, `hermes_cli/auth.py`, `hermes_cli/auth_codex.py`,
`agent/anthropic_credentials.py`, `hermes_cli/auth_oauth_grants.py`), read as code only; no
credential file was opened.

## 1. What happened

Hermes keeps its logins in the root store `/var/lib/volition/hermes/auth.json`. A profile
(`profiles/<slug>`) has no rows of its own and *borrows* the root's: Hermes reads them through
its global-root fallback and, after a refresh, writes the rotated pair back into the root under
the root's lock (`auth.lock`, Hermes #100339/#48415). The refresh tokens of Anthropic (Claude),
OpenAI Codex (ChatGPT) and xAI are **single-use**: a refresh returns a new refresh token and
retires the old one.

With isolation on, the launcher bound the root `auth.json` read-only into every Hermes unit. An
agent whose Claude access token (8 h) had expired refreshed it (`_refresh_entry` takes only the
profile's lock, then POSTs), Anthropic rotated the refresh token, and the write-back failed:

    anthropic pool: write-through of borrowed root grant failed ([Errno 30] Read-only file
    system: '/var/lib/volition/hermes/auth.lock'); not materializing a profile-local copy

The new pair lived only in that process. The root kept the spent token; the next unit replayed
it and got `invalid_grant` ("Refresh token not found or invalid"). The same was waiting for
Hermes' ChatGPT login (`providers.openai-codex` in the same store; the Codex access token is a
JWT of about ten days) and for the Codex CLI's login next to it (`.codex/auth.json`, bound into
every unit as well). The keeper now copies its access token from Hermes' credential pool.

Control test (`test_token_keeper_hermes.py`,
`test_the_binding_before_the_keeper_let_an_isolated_agent_spend_the_refresh_token`): Hermes in a
profile with the old binding and an expired token POSTs the stored refresh token.

## 2. Decision

| Block | Decision | Rejected |
|---|---|---|
| Who refreshes | **`helena-token-keeper`**, a oneshot program run as the runner user (`volition-hermes`) under Hermes' own interpreter with `HERMES_HOME` = the Hermes root. It refreshes every single-use OAuth row of the root store (`anthropic`, `openai-codex`, `xai-oauth`) through **Hermes' own credential pool** (`CredentialPool._refresh_entry(entry, force=False)`, falling back to the public `try_refresh_matching`) | a refresh of our own with an OAuth library (authlib, BSD; oauthlib, BSD): Hermes owns the store format, the lock, the in-lock re-read that adopts a peer's rotation instead of spending the token twice, the spent-rotation sidecar, the singleton sync (`providers.openai-codex` ↔ pool rows) and the dead-grant handling. A second implementation would race Hermes and drift from it with every update |
| Where it runs | a **systemd timer** next to the runner (`helena-token-keeper.timer`, every 10 min, 2 min after boot) and **before the runner starts** (runner drop-in `Wants=`/`After=`) | a loop in the runner (paused exactly when the runner cannot start or crash-loops, and a long-lived process holding tokens in memory); a daemon of its own (nothing to serve). For Docker (package G) the same program runs as a loop or cron in the runner's container: `helena_token_keeper.py tick` every 10 minutes |
| When | a login is **due** when its access token expires within `prefer_before` (6 h); it is renewed at a moment **no agent unit runs** (the run waits up to 4 min for one), and **regardless** once it expires within `force_before` = the launcher's longest unit (`runtimeMaxSecLimit`, 4 h) + two ticks + 5 min ≈ 4 h 25 min. At most every 30 min per login (`min_gap`), failures back off (10 min × 2ⁿ, at most 2 h) | refreshing only just before expiry (Hermes' 120 s skew): a unit keeps the view it started with (below) and would run out mid-run |
| What agents see | a **view** the keeper writes after every run: the root `auth.json` and the Codex CLI's `auth.json` **without any `refresh_token`** (`/var/lib/helena-token-keeper/view/…`, group `volition-agents`, 0640). The launcher binds the Hermes view as a file onto `/var/lib/volition/hermes/auth.json` and the Codex view as a folder onto `{home}/.codex`, both `"required": true` for the `hermes` runtime (a run without them is refused, never started without a login or with the old binding), optional for the `profile-helper` | a Hermes patch ("defer refreshes of borrowed grants to someone else"): Helena treats Hermes as an external dependency (OSS goal, §6 for the upstream idea), every local patch is carried through each update, and a flag is fail-open when it is lost; Hermes' `key_cmd` (the `apiKeyHelper` idiom): only for API-key providers, not for the Claude subscription or the ChatGPT backend; the egress proxy inserting the credentials (design Phase 2): the end state, but TLS interception or per-provider proxying, a branch of its own; HashiCorp Vault Agent (BSL, not AGPL-compatible) or OpenBao Agent (MPL-2.0): an extra service that knows nothing of these providers' rotation; access-token-only copies in each profile folder (they would follow a refresh live, but Hermes then treats them as the profile's own grants, and its forked-grant heal outside isolation could put a row without refresh token over the root's) |
| An agent that still tries | nothing to spend: Hermes' `_refresh_entry` returns early for a row without refresh token; on a 401 the row is benched for its own process only (the write to the root fails as before). Proven with Hermes itself (`test_an_isolated_agent_uses_the_access_token_and_can_never_spend_a_refresh_token`: 0 POSTs, forced refresh included; an expired view fails closed) | — |
| The Codex CLI's login next to Hermes | on each run, the keeper selects a valid `openai-codex` OAuth pool row and writes its access token and JWT account ID to `.codex/auth.json`. It removes any refresh token from that file. Hermes alone renews the pool row. If no valid pool row exists, a separate CLI login is only reported | copying a refresh token into the CLI file would give two processes the same single-use chain |
| Health | a new extension point **`RuntimeLoginSource`** (`@helena/sdk` `runtime-logins.ts`, registry `runtimeLoginSources`, manifest `provides.runtimeLoginSources`); the built-in plugin `helena.logins` registers the source `token-keeper`, which reads the keeper's status files from `HELENA_LOGIN_STATUS_DIR` (the installer's API drop-in). `GET /god/system-health` answers `logins` (reports, per login state/expiry/error/command, `stale` after three missed intervals, `problems`); Home → Dienste shows "Anmeldungen" with the owner's command to copy | the runner reporting it to the API (when a login is dead the runner may be the part that cannot start); a table of its own (the status file is the truth, read on request); `hermes doctor` as the source (it reads one profile's view, not the root, and has no Anthropic row) |
| Catalog | `volition-hermes-catalog.py` `logged_in()` counts a provider only while one of its rows is **not dead**, so the models of a rejected login leave the chat and agent pickers until the owner signs in again | `has_credentials()` (a dead row still counted) |
| `hermes doctor` ("Prüfen") | the `profile-helper` runtime gets the same two views, so the doctor's "OpenAI Codex auth" row reads what a run reads (logged in) instead of "not logged in"; every profile also gets `.local/bin/hermes` (profile links may now have three levels), which the doctor looks for | annotating or hiding the doctor's lines in Helena (a second truth next to Hermes' own check) |

## 3. The pieces

- `deployment/volition-stack/native/token-keeper/helena_token_keeper.py` — `tick` (renew what
  is due, update the Codex CLI access token, write the views, the status and the private state),
  `views` (no network), `status` (prints the status; no secret), `--renew <provider>` (renew
  now, still at a quiet moment: a proof, or finding out early whether a login is alive).
- `helena-token-keeper.service` / `.timer`, `runner-dropin.conf`
  (`volition-hermes-runner.service.d/`), `api-dropin.conf` (`volition-plan-api.service.d/`).
- `install.sh install|sync|status|remove [--dry-run]`: folders
  (`/var/lib/helena-token-keeper` 0750 `volition-hermes:volition`; `status/` 2750 group
  `volition` for the API; `state/` 0700; `view/{hermes,codex}` 2750 group `volition-agents`),
  program in `/usr/local/lib/helena-token-keeper/`, units, drop-ins, timer on, one run. Once
  the installed launcher binds the views, the agents' group loses its ACL read on the real
  `auth.json` and `.codex`. `deploy.sh` runs `sync` before `isolation.sh sync`; `sync` installs
  the keeper where isolation is installed (its launcher refuses runs without the views).
- `isolation/launcher.json`: the views instead of the stores, `"required": true` for `hermes`,
  `/var/lib/helena-token-keeper` hidden in every unit; `isolation.sh` grants the agents' group
  read on `config.yaml` and `.env` only.
- Status file (`status/hermes.json`, 0640): `{version, reporter, checkedAt, intervalSeconds,
  preferBeforeSeconds, forceBeforeSeconds, logins: [{store, provider, id, label, managed,
  state, expiresAt, refreshedAt, error, command, note?}], views, errors}`. States: `ok`,
  `expiring` (due, waiting for a quiet moment), `expired`, `error` (renewal failing for now,
  retried), `invalid` (rejected: sign in again). Labels are Hermes' own (can be an e-mail);
  reasons are redacted (anything token-like is cut).
- A failed **early** refresh does not take a working login out of use: Hermes benches a row
  whose refresh failed; while its access token is still valid the keeper lifts that bench again
  (`CredentialPool.reset_status`).

## 4. Security

- Agents no longer reach any refresh token: not in the views, and the real stores lose the
  agents' group ACL. What stays (Phase 1 residual risk, unchanged): an agent can read the
  access tokens of the logins it uses (Claude ≤ 8 h, ChatGPT ≤ ~10 days). Phase 2 (egress
  proxy inserts them) removes that.
- The keeper runs as the runner user with `ProtectSystem=strict`, writes only the Hermes home
  and its own folder, holds tokens only in memory during a run, and prints/logs none; the
  fingerprints in `state/state.json` (0600) are 16 hex of SHA-256, only compared.
- The owner's command is composed by the keeper from its own paths and Hermes' own wording
  (`oauth_relogin_command`), checked to be printable one-line text by the SDK and the API, and
  only shown; Helena never runs it.

## 5. Owner action (after the keeper is live)

The Claude login is dead since 2026-09-24 ~17:40. In the owner terminal (Home → Terminal →
Shell, as `wilhelmpa`):

```
sudo -u volition-hermes env HOME=/var/lib/volition/hermes HERMES_HOME=/var/lib/volition/hermes \
  /var/lib/volition/hermes/venv/bin/hermes auth add anthropic --type oauth \
  && sudo systemctl start helena-token-keeper.service
```

Hermes prints a claude.ai link; open it in the browser, approve, paste the code back. The new
row is added to the root store, the keeper renews it from then on and writes it into the
agents' view at once (the `systemctl start`). The dead row stays out of rotation (Hermes prunes
a dead manual row after a day) and is no longer reported once a new row of the same provider
works. The runner picks the Claude models up again in its catalog at its next start
(`sudo systemctl restart volition-hermes-runner` when no run is in flight). The same command is
shown under the login in Home → Dienste → Anmeldungen.

## 6. Upstream ideas for Hermes (not built)

1. `HERMES_ROOT_AUTH_FILE`: an override of the global-root store path, so a sandbox could bind a
   live-updating folder instead of a file (today a unit keeps the view it started with).
2. An access-token-only OAuth row adopts the token its store holds now on a refresh attempt,
   instead of being benched (with 1 this lets long runs outlive a rotation).
3. A read-only borrower mode: a profile that cannot write its root never refreshes a borrowed
   single-use grant and says so, instead of spending it.

## 7. Live proof (orchestrator, after the merge)

1. `sudo deployment/volition-stack/native/deploy.sh` (no migration; no runner rebuild). It
   installs the keeper (isolation is installed), runs it once, installs the new launcher code
   and configuration, then revokes the agents' direct read access; API, worker, web and runner
   restart as usual (check that no run is in flight first).
2. `sudo deployment/volition-stack/native/token-keeper/install.sh status`: timer active; the
   status names `anthropic` `invalid` with the command, `openai-codex` `ok` with its expiry,
   and the Codex CLI login `linked` or `separate`.
3. No refresh token in the views, counted without printing anything:
   `sudo grep -c refresh_token /var/lib/helena-token-keeper/view/hermes/auth.json /var/lib/helena-token-keeper/view/codex/auth.json`
   → `0` and `0`; `sudo stat -c '%U:%G %a %n' /var/lib/helena-token-keeper/view/hermes/auth.json`
   → `volition-hermes:volition-agents 640`.
4. A chat with a Codex model answers (the view works in a real unit); while it runs,
   `systemctl show -p BindReadOnlyPaths 'volition-agent-*'` lists
   `/var/lib/helena-token-keeper/view/hermes/auth.json:/var/lib/volition/hermes/auth.json`.
5. Home → Dienste → Anmeldungen: Claude `ungültig` with the command, ChatGPT `gültig, noch …`.
   Agent → Laufzeit → Prüfen: "OpenAI Codex auth (logged in)", no `~/.local/bin/hermes` warning.
6. Optional, at a quiet moment: prove the ChatGPT chain is alive now, a week before it matters:
   `sudo -u volition-hermes env HOME=/var/lib/volition/hermes HERMES_HOME=/var/lib/volition/hermes PYTHONPATH=/srv/volition/source/hermes /var/lib/volition/hermes/venv/bin/python /usr/local/lib/helena-token-keeper/helena_token_keeper.py tick --renew openai-codex`
   → the status shows `refreshedAt` now and an expiry about ten days out; a Codex chat still
   answers.
7. The owner signs Claude in again (§5); after the next runner restart the Claude models are
   back in the catalog and a Claude chat answers.

Rollback: `git revert -m 1 <merge>` and deploy (the old binding comes back, and with it the
problem), then `sudo deployment/volition-stack/native/token-keeper/install.sh remove`.

## 8. Open

- 2026-09-26: after the owner's new Claude login (2026-09-25 23:47) the keeper's view was right,
  yet every Claude agent still failed with "credentials or agent init failed": not a login
  problem, a file of the anthropic SDK in Hermes' venv the isolated agents could not read. See
  `agent-runtime-code.md`; a failed start now says why in Helena.

- Per-agent issue: Hermes agents whose model runs on a dead login could show "Laufzeit nicht
  angemeldet" on the agent page (the runner can read the keeper's status). The Home line and
  the catalog cover it for now.
- Claude Code and Codex agents with their own logins in their homes (`hub/cli-runtimes`) keep
  their own refresh; they are not shared and not bound read-only, so not affected.
- The Docker packaging (package G) runs the same program in a loop in the runner container.
- The keeper uses a few private Hermes functions (`_refresh_entry`, `_auth_store_lock`,
  `_load_auth_store`). `test_token_keeper_hermes.py` runs the keeper
  against the installed Hermes; it belongs in the Hermes update's checks (hermes-update).
- The account's model list (hub/model-availability's `codex_listed_models`, the catalog's
  `provider_model_ids`) reads the Codex CLI's access token next to Hermes; the keeper keeps that
  one fresh from a valid Hermes credential pool row. Hermes' own ChatGPT login, read
  read-only (`resolve_codex_runtime_credentials(read_only=True)`), is always kept fresh.
