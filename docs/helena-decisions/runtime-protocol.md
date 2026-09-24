# Runtime protocol: how the runner drives Hermes, Claude Code and Codex

Status: decided 2026-09-24 (hub/hermes-sync). Binding inputs: `docs/volition-helena-oss.md` §3a/§3b, orchestrator decisions D-C3/D-C4, standards audit RUN-01/RUN-03/RUN-04/SEC-2.

## Decision

1. **Every runtime sits behind one extension point**: `RuntimeAdapter` in `packages/runner/src/runtime.ts`. An adapter does three things:
   - `ensure()`: it brings the runtime to the agent's settings in Helena and reads the result back (drift).
   - `runSettings()`: it says what a run or chat answer hands the runtime.
   - `sessionFacts()` / `defaults()`: they say which model and reasoning actually ran.

   What goes into a profile comes from `ProfileContribution`s (`contributions.ts`): Helena's MCP server, the project browser, the team library and the learning settings, today. Another package adds a server or a setting by registering a contribution. hub/framework should move `RuntimeAdapter`, `ProfileContribution` and `McpServerSpec` into `@helena/sdk` as they are.
2. **The Agent Client Protocol (ACP) becomes the transport for driving runs and chats, runtime by runtime.** `McpServerSpec` already has ACP's `McpServer` shape (name, command/args/env, or url/headers), so an ACP adapter hands the same list to `session/new`. The CLI presets stay as a fallback behind the same interface.
3. **Order:**
   1. Claude Code and Codex first, as soon as the owner approves the adapters, because their adapters cover everything the runner uses.
   2. Hermes after a small patch to its ACP adapter (below), chat first, then runs.
4. **What stays runtime-specific even with ACP** is the profile materialization, and it stays in the adapters:
   - Hermes: SOUL.md, the managed `config.yaml` overlay, `skills/plan-managed`, the plugin links, the curator state and the `config.yaml` link to the shared file.
   - Claude Code: the plugin directory for skills, and the system-prompt append.
   - Codex: its instructions and turning off the servers of its own `config.toml`.
   - The session-store readers for history (hermes-in-helena, D-C4).
   - The evidence of which model ran: Hermes' `state.db`, the model name on Claude's stream. ACP only names the configured model id.

## Does Hermes' ACP adapter reach the per-run settings?

Question from the orchestrator. The answer is **no, not today**. Checked against the source of Hermes 0.21.4 (`/srv/volition/source/hermes/acp_adapter`, started with `hermes acp`, protocol package `agent-client-protocol==0.9.0`, already in the Hermes venv).

| What the runner passes today | Hermes over ACP |
|---|---|
| `--toolsets` (Helena's per-agent restriction, `cronjob` withheld, gateway turns `browser` off) | **Not reachable.** The session always gets the fixed `hermes-acp` toolset plus the session's MCP servers. That loses the per-agent restriction (a security regression) and `clarify` (the chat's choice chips) |
| `--max-turns` | **Not passed.** Hermes' own iteration budget applies (`max_iterations` 500 in the session records on Kingston) |
| `--run-budget` | Only through `agent.run_budget_seconds` in the config, that is per profile and not per run. It could be set per agent in the managed overlay, but not per run |
| `--reasoning` | Only `agent.reasoning_effort` in the config. There is no ACP config option for it |
| `--provider --model` | Only the legacy `session/set_model` with `provider:model`. No `configOptions` are advertised |
| `--resume <id>` | Only sessions created over ACP (`source = 'acp'`) can be restored. An unknown id silently starts a new session, and the next prompt then fails |
| `--image` | Image content blocks. This is better than today: several images at once |
| `--source tool`, `--accept-hooks` | Sessions are stored as `acp`. Shell hooks from `config.yaml` are not registered on the ACP path |
| `state.db` reasoning evidence | After every turn the adapter **replaces** `model_config` with `{cwd, provider, base_url, api_mode}`, which drops `reasoning_config`, the evidence `sessionFacts()` reads |
| Approvals | Hermes' dangerous-command prompts become `session/request_permission`. That is the standard path SEC-2 wants, but it also means `approvals.single_query_mode` and the `plan-approval-guard` plugin must be replaced by the runner's answer to the permission request, not kept next to it |

**Consequence:** Hermes stays on the CLI preset until a patch to `acp_adapter` exists. We would offer it upstream (Hermes is MIT, and we already carry one patch, the stream-json reasoning events). The patch would:

- accept `_meta.helena = {toolsets, maxTurns, runBudgetSeconds, reasoning, source}` in `session/new`, `session/load` and `session/resume`, and apply each setting the way the CLI flags do;
- advertise `configOptions` of category `model` and `thought_level`;
- merge `model_config` instead of replacing it;
- refuse `session/resume` of an unknown id;
- also allow resuming a session the CLI created;
- send the cost in `usage_update`.

Estimate: S–M. After the patch, the Hermes chat moves first (long-lived process, queue, steer, cancel and live approvals), then runs.

## Claude Code and Codex over ACP

| | Claude Code | Codex |
|---|---|---|
| Adapter | `@agentclientprotocol/claude-agent-acp` 0.81.1, Apache-2.0. It depends on `@anthropic-ai/claude-agent-sdk`, which is under Anthropic's commercial terms. **Installed outside our tree like the CLI itself, never in a package.json (D-C3)**. `CLAUDE_CODE_EXECUTABLE` points it at the installed `claude` | `@agentclientprotocol/codex-acp` 1.13.1, Apache-2.0, on top of `codex app-server`. Install with `--omit=optional` and `CODEX_PATH` pointing at the installed codex, to avoid a second 387 MB binary |
| Resume | load/resume. The session id is Claude's, so today's ids stay valid | resume by thread id |
| MCP from `session/new` | stdio, http, sse. `_meta.claudeCode.options.strictMcpConfig` excludes the owner's own servers | stdio, http. A name that also exists in `config.toml` is skipped, so the owner's own servers cannot be turned off over ACP; a separate `CODEX_HOME` per agent or the `-c …enabled=false` of today is needed |
| Model / reasoning | config options `model`, `thought_level` | config options (the model id carries the effort) |
| Instructions | `_meta.systemPrompt.append` (= `--append-system-prompt`) | no ACP field; `CODEX_CONFIG` (`developer_instructions`, unverified) or the prompt, as today |
| Skills | `_meta.claudeCode.options.plugins` (= `--plugin-dir`) | skills are refreshed per workspace. The runner's index plus paths works only while Codex can read files (see below) |
| Unattended permissions | modes `auto` / `default` / … ; everything else arrives as `request_permission` | no mode equals today's `exec` (workspace-write, never ask), so the runner answers `request_permission` |

Both adapters are owner decisions: npm installs of external binaries' wrappers, system-level. Until then, the CLI presets carry everything, and this branch made them complete. They now pass SOUL, skills, MCP servers, model and effort, return the real answer and session, and name the run on Helena's MCP. It was proven live against a private API (Claude Code 7/7 checks).

**Found while proving Codex:** its `workspace-write` sandbox cannot start inside Kingston's systemd-nspawn container. bubblewrap fails with `setting up uid map: Permission denied` and, without network access, with `loopback: Failed RTM_NEWADDR`. So a Codex agent can call MCP tools but cannot run a single shell command or read a file. Options, each needing an owner decision:
- allow unprivileged user namespaces for the container (a host change);
- or run Codex with `sandbox_mode="danger-full-access"` inside Helena's own agent isolation (the systemd sandbox per project), the way Hermes' terminal already runs.

ACP does not change this.

## MCP configuration per runtime (and RUN-04)

- **One neutral list, rendered per runtime** (`McpServerSpec`):
  - Hermes: the managed `config.yaml` overlay. Every server of the shared config that Helena does not give the agent gets `enabled: false`.
  - Claude Code: `--mcp-config` JSON + `--strict-mcp-config`, with `${VAR}` expanded by Claude.
  - Codex: `-c mcp_servers.<name>.*`. A secret goes in as a variable of the run's environment through `env_vars` / `env_http_headers`, `Bearer ${VAR}` as `bearer_token_env_var`, and servers of its own `config.toml` get `enabled=false`.
  - Nothing is written into the project's working directory, and no secret is written on a command line.
- **ACP `session/new` adds servers but never removes them.** Removing stays runtime-specific: the overlay for Hermes, strict mode for Claude, `CODEX_HOME` or `-c` for Codex. ACP passes values literally over stdin (no `${VAR}`). That is acceptable, since it is not argv, but the runner must never log them.
- **RUN-04 (`smol-toml`):** no Codex `config.toml` file is written. The `-c` values are TOML fragments built as JSON strings, which are valid TOML basic strings. Every key the runner sets was checked against codex 0.156.1 with `codex mcp list --json`. If a file writer ever becomes necessary (for example a per-agent `CODEX_HOME`), it uses `smol-toml` (BSD-3) and not templates.
- **No cross-tool standard file yet.** MCP SEP-2633 (a client-side `mcp.json`) is a draft, and the registry's `server.json` describes installation, not client configuration. The Claude-style `mcpServers` object is the de facto shape, and `McpServerSpec` maps onto it and onto ACP.

## Rejected alternatives

- **Stay on six CLI dialects for good.** That means one parser per CLI (`agui.ts`, 755 lines), approvals per runtime, and resume per runtime. It is kept only as the fallback.
- **Write `.mcp.json` / `.codex/config.toml` / `CLAUDE.md` into the working directory.** The workspace belongs to the project and to every agent in it. The files would need trusting (Claude asks before it uses a project `.mcp.json`), and an agent could replace them.
- **Build our own agent harness** instead of Hermes, or a runtime abstraction like LangChain. This contradicts §3: Hermes is the harness.
- **ACP v2 now.** It is a draft (2.0.0-alpha); stay on v1, stable, schema 1.23.

## Migration path

1. **Done (this branch):**
   - the `RuntimeAdapter` / `ProfileContribution` / `McpServerSpec` extension point;
   - the Hermes adapter owns the whole profile and reports drift;
   - the CLI adapter for Claude Code/Codex;
   - model check per run;
   - the proof script.
2. **hub/framework:** move the three interfaces into `@helena/sdk` unchanged and re-export them from the runner.
3. **Owner OK:** `@agentclientprotocol/sdk` 1.5.0 as a runner dependency (Apache-2.0, no dependencies of its own). `codex-acp` and `claude-agent-acp` are installed outside the tree, `--omit=optional`, and pointed at the installed CLIs.
4. **Runner** (`packages/runner/src/acp/`):
   - a driver: spawn inside the existing isolation launcher; `initialize`; `session/new|resume` with `cwd`, `mcpServers` from `collectProfile()`, and the runtime's `_meta`; `set_config_option` for model and reasoning; `prompt`, `cancel`, `close`;
   - an event mapping from ACP `session/update` to the existing AG-UI events (with hub/chat-standards, RUN-02);
   - a permission bridge from `session/request_permission` to Helena approvals and Autopilot (SEC-2, with hub/autopilot). The default answer is `reject_once` with a message pointing to `request_approval`.

   Adapter `transport: 'cli' | 'acp'` per agent, default `cli`. Switch order: Claude Code, then Codex.
5. **Hermes:** the `acp_adapter` patch above (upstream PR). Then the Hermes chat, then runs. Once runs are on ACP, `plan-approval-guard` and `approvals.single_query_mode` are removed (SEC-2).
6. **Removed at the end:**
   - in `agui.ts`: the Claude, Codex and Hermes stream parsers and `UsageReader`'s cases for them;
   - in `execute.ts`: `HermesResultReader`;
   - in `presets.ts`: the entries for these three runtimes, with the local Hermes stream-json patch;
   - `FinalAnswerReader` from this branch.

   The opencode, antigravity and copilot presets stay until their ACP modes are proven.
7. **RUN-03 (later):** a runner protocol version header, and the runner routes in the OpenAPI spec (with F02).
