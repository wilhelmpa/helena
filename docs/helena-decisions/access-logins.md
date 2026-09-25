# Logins in Zugänge ("Anmeldungen")

Status: decided 2026-09-25 (hub/access-logins). Owner, 2026-09-25: "Codex erscheint nicht in den
Zugängen, obwohl es angelegt ist — der Vollständigkeit halber." Zugänge is the one place that
shows every login Helena's agents use.

## 1. The three kinds of login

| Login | Where it lives | Who renews it | In Zugänge |
|---|---|---|---|
| Stored runtime login (`runtime_login`: a `claude setup-token` token, an API key) | Helena, encrypted | nobody (a year) | the credential list, as before |
| A Claude Code or Codex agent's **own** login (a Codex ChatGPT device login in `<profile>/.codex`) | the agent's home, owned by the project user | the runtime itself | **new**: "Anmeldungen", one row per agent |
| The model logins every Hermes agent shares (Claude, ChatGPT, the Codex CLI's next to them) | Hermes' root store | the token keeper | **new**: "Anmeldungen", owner only |

An agent's own login is never copied into Helena: Codex rotates its refresh token on every use,
so a second holder signs the agent out (token-keeper.md §1). Helena shows what the runtime says
about it, never the login.

## 2. Decision

| Block | Decision | Rejected |
|---|---|---|
| Reading an agent's own login | the runtime's own interfaces: Codex' app-server `account/read` (JSON-RPC, the protocol its IDE extensions use; `refreshToken: false`, so nothing is renewed), `claude auth status` (JSON). They give the kind of login, the account's e-mail and plan. A Codex without `account/read` falls back to `codex login status` (whether only) | decoding the id token's claims ourselves: that opens the login file, and the claims format is OpenAI's internal one; `account/read` is Codex' public answer to the same question |
| Last renewal | the login file's modification time (`auth.json`, `.credentials.json`): metadata, never its content | the `last_refresh` field inside `auth.json` (needs reading the file) |
| Where it runs | the runner's Claude Code / Codex adapter, at its regular look (every 10 min) and on request. For an isolated agent in its profile helper, as the project user in the agent's unit (runtime request `login.read`); only the account's facts leave the unit | the runner opening the agent's home (it cannot, and must not, under isolation) |
| Contract | `@helena/sdk` `RuntimeAccount` + `normalizeRuntimeAccount` (known fields only, token-like words dropped); `RuntimeAdapter.account?()` / `signOut?()`; runtime requests `login.read`, `login.logout` (capabilities `login`, `logout`). A plugin runtime with a login of its own implements the two methods | a Codex-only special path in the API |
| Transport | the account rides in the runtime status the runner already reports (`runtimeState.account`), checked again by the API when stored and when read | a table of its own (the runner's report is the truth, like the issues next to it) |
| Signing out | the runtime's own command (`codex logout`, `claude auth logout`) started by the runner through the launcher in the agent's unit, as the user the agent runs as, through the login's start gate; then a new look. Owner's signed-in interface only (god + interactive session), confirm dialog, access-log entry `signed-out` (credential null, label "Codex · <agent>") | deleting `auth.json` (the file is the runtime's); a sign-out from an agent's own MCP tools |
| Shared logins | the existing runtime login sources (token keeper's status files), the plan from the plan limits read through Hermes' login | a second reader of the keeper's files |

## 3. Routes

- `GET /teams/:teamId/access/logins` — `integrations:read`. Every Claude Code and Codex agent of
  the team (as far as the viewer sees agents): `source` own / stored / none, `state` signedIn /
  expired / signedOut / unknown, the account (method, e-mail, plan, organization), last renewal,
  the stored credential granted to it (id, label), the sign-in command, `canCheck`,
  `canSignOut`; `shared` for the owner only.
- `POST …/agents/:agentId/check` — team owner/manager: the runner asks the runtime now.
- `POST …/agents/:agentId/sign-out` — the owner in the signed-in interface.

None is an MCP tool. A test walks every response for token-like keys and values.

## 4. Deployment

No migration, no launcher change: the launcher already runs `codex` with the caller's arguments
as a helper unit, and the profile helper is the runner bundle. The runner bundle has to be
rebuilt and the runner restarted (deploy.sh). A profile helper from before this change refuses
`login.read`; the adapter then falls back to `codex login status` / `claude auth status`
through the launcher, as before.
