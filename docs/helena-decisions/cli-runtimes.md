# Claude Code and Codex as agent runtimes next to Hermes

Status: decided 2026-09-24 (hub/cli-runtimes). Binding inputs: owner decisions of 2026-09-24
("ja alles": Claude Code and Codex agents run as services and start by themselves; the ACP
adapters are installed outside our tree; Codex runs without its sandbox only inside agent
isolation), orchestrator decision D-C3 (ACP adapter names, the Claude adapter is external
only), `runtime-protocol.md` (the `RuntimeAdapter` extension point of hub/hermes-sync).

## 1. Summary

| Block | Decision | Rejected |
|---|---|---|
| Install Claude Code | Anthropic's native binary from the release bucket, pinned by version and SHA-256 per platform, checked again against the release manifest, whose GPG signature is checked with the pinned release key; `/opt/helena/runtimes/claude/<version>`, `current`/`previous` links, `/usr/local/bin/claude` | the per-user native installer (auto-updates itself, lives in one user's home); `sudo npm i -g` (Anthropic warns against it, postinstall scripts as root); the signed apt repository (good, but one version at a time, no side-by-side rollback, a new system apt source) |
| Install Codex | the npm package, pinned by a committed `package-lock.json` (sha512 of every tarball), `npm ci --ignore-scripts`, `/opt/helena/runtimes/codex/<version>` | the GitHub release tarball (no signed checksum list to pin against, no bundled ripgrep); `npm i -g` |
| Install the ACP adapters | the same npm path, `--omit=optional` (their bundled Claude/Codex binaries are left out; `CLAUDE_CODE_EXECUTABLE`/`CODEX_PATH` point at ours), outside the monorepo (D-C3) | a dependency in our `package.json` (D-C3); installing them unpinned |
| Updates | an owner-approved action with the pattern hub/hermes-in-helena builds for Hermes (check → proposal → approval → spool → root helper → status), with `install-cli-runtimes.sh` as the helper's engine; rollback by the `previous` link | self-updating runtimes (`DISABLE_UPDATES=1`, `DISABLE_AUTOUPDATER=1` on every command) |
| Claude Code login | a token of a year from `claude setup-token`, which the owner makes in his own terminal, or an Anthropic API key; stored in Zugänge as a **Laufzeit-Anmeldung** and handed to one command at a time as `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` | Helena running a claude.ai sign-in itself (Anthropic does not allow third-party products to offer claude.ai login); a shared `.credentials.json` bound into every unit (one refresh token for all, readable by every agent) |
| Codex login | an OpenAI API key in Zugänge (`CODEX_API_KEY`, stateless), or the ChatGPT plan through Codex' own device login **in the agent's own home** (`CODEX_HOME=<home>/.codex`), which Codex refreshes in place; starts of one agent's commands are serialized while they share that file | copying one `auth.json` around (OpenAI: one file per serialized stream; a refresh by one copy invalidates the others); refreshing ChatGPT tokens in Helena (a hand-written client of OpenAI's private OAuth client) |
| Where agents run | provisioned like Hermes agents: their profile directory is their home; the server's runner serves them with the `claude`/`codex` preset | a runner the operator starts by hand per agent (the state before this branch) |
| Codex sandbox | inside agent isolation `danger-full-access` (the unit is the sandbox); without isolation `read-only` and the health issue "Sandbox nicht verfügbar"; `execute()` refuses any Codex command without a sandbox outside isolation | allowing user namespaces in the nspawn container (a host change that widens every process's attack surface) |
| Transport | the CLI (`claude -p`, `codex exec`) for runs and chats; ACP evaluated, prepared (adapters installed), not switched on (§7) | ACP now |
| Tools | the Abilities toggles (`toolDeny`) switch Claude Code's and Codex' built-in tools; their schedulers, agent messaging, ChatGPT apps/plugins and own browser/computer use are withheld; the "Erlaubte Tools" field (`toolAllow`), which had no effect, is gone from the UI | making `toolAllow` an allow list per runtime (a second control for the same thing, with names that differ per runtime) |

## 2. Installation

`deployment/volition-stack/native/runtimes/install-cli-runtimes.sh`, run as root by the
orchestrator once the owner approved the downloads:

```
sudo deployment/volition-stack/native/runtimes/install-cli-runtimes.sh plan
sudo deployment/volition-stack/native/runtimes/install-cli-runtimes.sh install
sudo deployment/volition-stack/native/runtimes/install-cli-runtimes.sh status
```

- **Pins** (`runtimes.json`): Claude Code 2.1.281 (the owner's own version, the one
  hub/hermes-sync proved; `stable` is 2.1.273), Codex 0.156.1, claude-agent-acp 0.81.1,
  codex-acp 1.13.1.
- **Claude Code**: linux-x64 237 375 560 bytes, SHA-256 `56fe3da8…a6dce1`. The manifest must
  carry a `VALIDSIG` of `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE`, the key in
  `keys/claude-code.asc`, and agree with the pin.
- **npm**: every package is verified against the committed lockfile's sha512, no install
  script runs, and npm uses a throwaway cache.
  - Codex: 7 lock entries; the linux-x64 package is 387 MB unpacked, with ripgrep.
  - claude-agent-acp: 112 lock entries without the optional binaries. Its dependency
    `@anthropic-ai/claude-agent-sdk` is under Anthropic's commercial terms, which is why it
    stays out of our tree.
  - codex-acp: 25 lock entries.
- **Layout**:
  - `/opt/helena/runtimes/<runtime>/<version>`, root-owned, not writable by others. `/opt`
    is visible read-only in every agent unit.
  - `current` and `previous` links, and `/usr/local/bin/{claude,codex,claude-agent-acp,codex-acp}`,
    which is already the `exec` of `launcher.json`.
  - The owner's own CLIs in `~wilhelmpa/.local` stay his; his PATH finds them first.
- **Idempotent and reversible**:
  - An intact version is not downloaded again.
  - `rollback <runtime>` goes back to `previous`.
  - `verify` compares the installed files with the pins.
  - `--dry-run` changes nothing.
- **Tests** (`test_install_cli_runtimes.py`, run by the integration suite) use a release served
  from files, a throwaway signing key and a fake npm. They cover a wrong checksum, a bad
  signature, a manifest that disagrees with the pin, idempotence, rollback and verify.

## 3. Updates as an owner-approved action

This reuses hub/hermes-in-helena's pattern for Hermes (`runtime-admin/hermes-update.ts`,
`native/hermes-update/helena-hermes-update{,.path,.service}`):

1. "Nach Updates suchen" asks a runner.
   - Claude Code: the `latest`/`stable` channel files of the release bucket, and the new
     version's signed manifest.
   - npm: the dist-tags.
   It lists version, size and checksum.
2. "Aktualisieren" raises a proposal (kind `cli-runtime-update`) on the approvals page.
3. The approved proposal writes a spool request. A root path unit runs
   `install-cli-runtimes.sh install --only <runtime>`, with the new version's pin taken from
   the signed manifest (Claude Code) or a lockfile generated and shown in the proposal (npm).
4. It writes `status.json`. Any failure keeps `current`; "Zurück" runs `rollback`.

Built after hub/hermes-in-helena is merged (it owns the proposal kinds and the request channel).
Until then an update is a pin change in the repository plus the orchestrator running the script.

## 4. Authentication

### What the runtimes accept

**Claude Code** (docs: authentication), in order of precedence:

1. `ANTHROPIC_AUTH_TOKEN`
2. `ANTHROPIC_API_KEY` (always used in `-p` mode)
3. `apiKeyHelper`
4. `CLAUDE_CODE_OAUTH_TOKEN`
5. profiles
6. the `/login` credentials in `$CLAUDE_CONFIG_DIR/.credentials.json`

`claude setup-token` runs the browser sign-in and prints a token of one year for the Pro/Max/Team
plan, "for CI pipelines and scripts". It only makes model requests and saves nothing.

**Codex** (docs: auth, ci-cd-auth) accepts:

- the ChatGPT login in `$CODEX_HOME/auth.json`, refreshed in place when about 8 days old or
  on a 401;
- the device login (`codex login --device-auth`);
- an API key (`codex login --with-api-key`, or `CODEX_API_KEY` for `codex exec`);
- access tokens for enterprise workspaces.

OpenAI's rule: one `auth.json` per runner or serialized stream, never shared between
concurrent jobs.

**Terms.** Anthropic does not allow third-party developers to offer claude.ai login or its
limits for their products, including agents built on the Agent SDK. Helena therefore never
signs anyone in to Claude:

- The operator makes the token with Anthropic's own CLI and stores it like any other secret.
  That is Claude Code used by its owner in his own scripts, which the setup-token docs
  describe. The plan's terms stay the operator's.
- An Anthropic API key is the alternative for teams and for everything that runs through
  the Agent SDK (§7).

### How Helena does it

- **Zugänge → Laufzeit-Anmeldung** (credential kind `runtime_login`):
  - Fields: `runtime` (claude | codex), `method` (oauth_token | api_key), and the secret
    `value`, which is encrypted and write-only.
  - It is granted only to agents that run on that runtime.
  - The form tells the owner where to get the value.
- **Delivery.** Before each run or chat answer the runner asks
  `GET /agent-runtime/runtime-login?runId|messageId` for the newest login granted to the
  agent.
  - The value is only in the answer for work the agent holds, and each delivery is audited
    (`delivered`, purpose `runtime:claude`).
  - The runner hands the value to that one command as `CLAUDE_CODE_OAUTH_TOKEN`,
    `ANTHROPIC_API_KEY` or `CODEX_API_KEY`. It never puts it on a command line, in a file or
    in a log, and empties every other login variable.
  - With isolation the value travels in the launcher's stdin header, never as a unit
    property (D-Bus shows those to every local user).
- **Codex with ChatGPT.** The owner signs the agent's own home in with Codex' device login. The
  runner names the exact command on the agent page, with a copy button. The command runs as
  the agent's user: through the launcher client when the agent is isolated, as
  `volition-hermes` otherwise. Codex keeps and refreshes the login there, and Helena never
  sees it. The runner serializes the starts of one agent's Codex commands until the model
  has answered (`LoginStartGate`), so two commands never refresh the file at once. An API
  key login needs no such gate.
- **Health.** "Laufzeit nicht angemeldet" appears when no login is granted and the runtime has
  none of its own (`claude auth status` / `codex login status`, run in the agent's home), or
  when the service refused the login.
  - A refusal is read off the stream: Claude Code's `"error":"authentication_failed"`, or
    Codex' 401 without a later answer.
  - The issue clears with the next command that gets through.
  - The agent page names what to do: the token command, Zugänge, or the device-login
    command.

### What can read a login

| Where | Who can read it |
|---|---|
| Helena's store | encrypted with `APP_ENCRYPTION_KEY`; the API decrypts it only for a runner holding work of a granted agent |
| the runner process (`volition-hermes`) | in memory, for the one command |
| an unisolated command | the command and the runner user; unisolated agents all run as `volition-hermes` and are one trust domain, as today for Hermes |
| an isolated command | its own unit. Another project's units run as another user and see neither its environment nor its home. The agent's home (`.claude`, `.codex`) is bound only into that agent's units |
| another agent of the **same** project, running at the same time | its process runs as the same project user, so `/proc/<pid>/environ` is readable (`ProtectProc=invisible` hides only other users' processes). The design makes the project the trust boundary (`volition-design-agent-isolation.md` §7). To close it: `PrivatePIDs=yes` for agent units (systemd 257 on Kingston has it; needs a harness run, since the runtime becomes PID 1 of its namespace), or one Unix user per agent |

**Coordination with hub/access-center.** Access-center owns credentials and grants. It widens
grants to projects and services, and adds `recordAgentUses` and `grantReaches`.

- The `runtime_login` kind is added here, on today's tables, so the feature works now:
  `credentials/{kinds,model,service}.ts`, `runtime-login.ts`, and the Credentials form.
- On access-center's merge it should be:
  - a builtin credential connector (`packages/connectors/src/builtin.ts`) with fields
    runtime, method and value;
  - delivered through `grantReaches(subjectOf(agent, work))` and `recordAgentUses`;
  - with the "only agents of this runtime" check kept.

The runner side (`/agent-runtime/runtime-login`, the answer's shape) stays as it is.

## 5. Provisioning: Claude Code and Codex agents start by themselves

1. `bootstrapProjectAgent` answers every external agent of exactly one project (not Home, not a
   coordinator) with its `runtime`.
2. The worker sends Claude Code and Codex agents to provisioning too.
3. The descriptor names a runtime other than Hermes (`"runtime": "claude"`). A changed runtime
   rewrites it, which restarts the runner. Hermes descriptors are unchanged.
4. `volition-hermes-catalog.py` turns such a descriptor into a runner entry with
   `agent: claude|codex`, `args: []`, and this env:
   - `HELENA_AGENT_HOME=<profile>`
   - `CLAUDE_CONFIG_DIR=<profile>/.claude` or `CODEX_HOME=<profile>/.codex`
   - and, when isolated, the project and profile.
   Nothing of Hermes is linked into the profile.
5. The runner's `CliRuntimeAdapter` writes the agent's skills into `<home>/.helena` (through the
   profile helper in the agent's own unit when isolated) and creates the runtime's directory.
   It passes:
   - SOUL, MCP servers, model and effort (as before);
   - tools, login and sandbox (new);
   - `--ignore-user-config` and `--skip-git-repo-check` for Codex;
   - `DISABLE_UPDATES`, `DISABLE_AUTOUPDATER` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
     for Claude Code.
6. The model catalog comes with the runner entry:
   - Claude Code: its aliases fable, opus, sonnet and haiku, with efforts low…max. They
     follow the newest model of each family.
   - Codex: the models of the ChatGPT Codex backend that Hermes' `openai-codex` provider
     lists for the account.

## 6. Codex' sandbox

Codex' own sandbox (bubblewrap) needs user namespaces, which the nspawn container refuses
(`setting up uid map: Permission denied`).

- **Isolated agent** (`AGENT_ISOLATION=on` and an isolation entry): `sandbox_mode="danger-full-access"`.
  The unit is the sandbox: its own user, network namespace, egress proxy, read-only system,
  and only its workspace, home and vault folder.
- **Anything else**: `read-only`. Codex then reaches Helena's MCP tools but runs no shell
  command. Helena shows "Sandbox nicht verfügbar", and the proof reports it.
- **An operator's own runner** keeps `workspace-write`.
- **Enforced in `execute()`** for every Codex command (run, chat, reflection):
  - The refused forms are `-c sandbox_mode="danger-full-access"`, `--sandbox`/`-s
    danger-full-access`, `--dangerously-bypass-approvals-and-sandbox` and `--yolo`.
  - Any of them outside isolation stops the command before it starts, whoever put it
    there (operator arguments included).
  - Helena's sandbox comes last on the command line, so it wins over an operator's.
  - Tests in `cli-managed.test.ts`.

## 7. ACP: evaluated, kept on the CLI for now

Both adapters give per-session control:

- **claude-agent-acp** controls model (`model`), effort (`effort`), MCP servers with
  `strictMcpConfig`, tools (`_meta.claudeCode.options.allowedTools/disallowedTools`), system
  prompt append, plugins and modes, including `auto`.
- **codex-acp** controls model, reasoning, sandbox/approval modes (`agent-full-access` =
  danger-full-access + never) and MCP servers.

It stays on the CLI because ACP gains nothing the CLI lacks today and loses three things:

1. **codex-acp starts `codex app-server` with no flags** (`CodexJsonRpcConnection.ts`), so
   Codex loads `$CODEX_HOME/config.toml`. In an isolated agent's home the agent itself can
   write that file: extra MCP servers, `notify` commands, hooks. The CLI passes
   `--ignore-user-config`; over ACP there is no way to.
2. **The Claude adapter is built on the Agent SDK.** Anthropic's terms bar third-party
   products built on it from offering claude.ai login, so the owner's plan token (§4) is
   for the CLI. Over ACP, Claude Code should run on an API key.
3. **ACP's real gain is live permission requests** (`session/request_permission` → Helena
   approvals, SEC-2). That bridge belongs to hub/autopilot's policy engine, which already
   hooks Claude Code's CLI with a PreToolUse hook. Building a second approval path here
   would compete with it.

The adapters are installed now (§2), so the switch is small once all three change:

- codex-acp passes app-server flags (an upstream PR), or Helena owns a read-only
  `config.toml` layer;
- autopilot's policy engine is merged and answers permission requests;
- the Claude agent has an API-key login.

What the switch then needs is described in `runtime-protocol.md` "Migration path" step 4:

- a per-agent `transport` setting;
- the driver in `packages/runner/src/acp/`, over `@agentclientprotocol/sdk` 1.5.0
  (Apache-2.0);
- an `acp-jsonl` output format in `agui.ts`;
- a streaming-stdin option for the launcher client;
- launcher runtimes `claude-agent-acp` and `codex-acp`.

## 8. Tools

The Abilities section lists what the runner reports as the agent's toolsets. For Claude Code
and Codex these are now their built-in tools (`cli-tools.ts`), and a toggle lands in the
runtime policy's `toolDeny` as for Hermes.

- **Claude Code** (names from its 2.1.281 stream):
  - Switchable: Bash, Edit, NotebookEdit, Read, Skill, Task, WebFetch, WebSearch, Write.
  - Always `--disallowedTools`: CronCreate, CronDelete, CronList and ScheduleWakeup
    (Helena schedules as routines), SendMessage and ListAgents.
- **Codex** (0.156.1 features):
  - Switchable: shell_tool, view_image, web_search, multi_agent, image_generation.
  - Always off: apps, plugins and remote_plugin (they would hand the agent the ChatGPT
    account's connectors), browser_use, browser_use_external, browser_use_full_cdp_access,
    computer_use and in_app_browser (Helena's project browser is the browser).

`toolAllow` stays in the API for older clients and template sync, and has no effect for any
runtime. The UI field is gone.

## 9. The SOUL speaks of the agent's runtime

`runtime-policy/service.ts` composes one SOUL per agent. For Claude Code and Codex:

- no "Website logins" section (the Hermes vault fills them; the others get no logins);
- the coordinator section names Claude Code's subagents (Task tool), or nothing for Codex,
  instead of Hermes' delegation toolset;
- the knowledge section says "your Read tool" / "view_image" instead of the vision tool, and
  drops "your own memory".

## 10. Health

The runtime status carries two more fields:

- `version`: the program's `--version`.
- `issues`: `runtime-missing`, `not-signed-in` (detail `missing`/`rejected`, with the
  owner's `command`) and `sandbox-unavailable`.

The API stores them in `runtimeState`, and `runtime-sync` and the health summary pass them on.

- **The agent page** shows the version next to "Profil synchron" and each issue with what to
  do.
- **The health overview** names "Laufzeit nicht angemeldet", "Laufzeit fehlt" and "Sandbox
  nicht verfügbar".
- **Probing cost**: `--version` and the login status run at most every 10 minutes per agent,
  and at once after a refused login.

## 11. Proof

`prove-hermes-sync` proves Claude Code and Codex the way it proves Hermes: on the server's own
runner, from a signed-in browser, without an API key. For each runtime it runs:

1. create or reuse the test agent;
2. grant it the newest Laufzeit-Anmeldung of its runtime;
3. wait until it comes online by itself;
4. check the runtime is installed (version) and signed in;
5. report Codex' sandbox;
6. one run on an E2E-Test task: instruction, skill and MCP markers, and the model check.

```
bun deployment/volition-stack/scripts/prove-hermes-sync.browser-steps.ts --out=steps.json \
  --runtimes=claude,codex --model-claude=haiku --reasoning-claude=low \
  --model-codex=gpt-5.6-luna --reasoning-codex=low
HL_PROFILE=proof node ~/volition/tools/hl.mjs steps.json
```

## 12. Rejected along the way

- **A runtime login per agent only.** Grants already say which agents get one. A login per
  runtime and project or team is the common case, and one agent can get its own.
- **Writing `.claude/settings.json` or `.codex/config.toml` into the agent's home.** Everything
  Helena sets goes on the command line per run, so nothing in the home can drift. For Codex,
  `--ignore-user-config` also keeps the agent from configuring itself.
- **`claude -p --setting-sources ""`.** It works (checked with 2.1.281) but would also drop a
  repository's own `.claude` settings, which belong to the project and keep a coding agent
  working in it the way its people do. The agent's own user settings live in its own
  `CLAUDE_CONFIG_DIR`, bound only into its unit.
