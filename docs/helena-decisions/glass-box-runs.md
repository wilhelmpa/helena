# Decision: glass-box runs (sessions, transcripts, run timeline, usage)

Status: accepted, 2026-09-24 · Branch: `hub/hermes-in-helena` (package C)

Helena shows every run of an agent as a timeline (live while it runs, as a replay after),
every session of an agent with its full transcript, and the tokens and cost per agent,
model, project and day. This file records which standards and existing parts carry that,
and which alternatives were rejected.

## 1. Data model: OpenTelemetry GenAI semantic conventions

**Chosen:** the OpenTelemetry GenAI semantic conventions
(<https://github.com/open-telemetry/semantic-conventions-genai>, Apache-2.0, status
"Development", last change 2026-09-22) are the shape in which Helena stores and shows runs,
messages, tool calls and tokens.

- A transcript is a list of messages in the `gen_ai.input.messages` /
  `gen_ai.output.messages` shape: `{ role, parts[] }` with the part types `text`,
  `reasoning`, `tool_call` (`id`, `name`, `arguments`), `tool_call_response` (`id`,
  `response`) and `compaction`. Helena adds `timestamp`, `model` and `finish_reason` as
  extra fields, which the convention allows (`extra="allow"`).
- Token counts use the attribute names `gen_ai.usage.input_tokens` (without cache),
  `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`,
  `gen_ai.usage.cache_write.input_tokens` and `gen_ai.usage.reasoning.output_tokens`. The
  usage ledger (`agent_usage`) has one column per attribute.
- A run is an `invoke_agent` span (`gen_ai.agent.id`, `gen_ai.agent.name`,
  `gen_ai.conversation.id` = the runtime session id, `gen_ai.request.model`,
  `gen_ai.response.model`); each tool call inside it is an `execute_tool` span
  (`gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments`,
  `gen_ai.tool.call.result`). The timeline view reads these.

An OTLP exporter is not part of this package. Because the stored shape already uses the
convention's names, an exporter later only has to wrap rows into spans.

**Rejected:**
- OpenInference (Arize, Apache-2.0): a second, vendor-led attribute set (`llm.*`); the
  OpenTelemetry convention is vendor-neutral and is what AgentPrism, Langfuse and the
  OpenTelemetry collector all read.
- Langfuse's observation model: tied to one product.
- A Helena-specific shape: nothing a standard does not already name.

## 2. Where the data comes from: Hermes' own interfaces

Helena never opens Hermes' files. The runner, which runs next to Hermes (as the project's
user when agents are isolated, see `docs/volition-design-agent-isolation.md`), answers read
requests through Hermes' own interfaces:

| Need | Interface | Why |
|---|---|---|
| One transcript | `hermes sessions export --session-id <id> --format jsonl --redact -` | Hermes' CLI; complete (messages, tool calls with arguments and results, reasoning, timestamps, per-session tokens, cost, timings); applies Hermes' own secret redaction (`agent.redact.redact_sensitive_text`); 0.4 s on Kingston |
| Session list, search, stats | `hermes_state.SessionDB(read_only=True)`: `list_sessions_rich`, `session_count`, `search_messages`, `search_sessions_by_id` | Hermes' public state module, the same calls its dashboard routes make (`hermes_cli/web_routers/sessions.py`); the CLI has no machine-readable list or search |
| Logs of a run | `hermes logs agent --session <id> -n <lines>` | Hermes' CLI filters its own log files by session |
| Health | `hermes doctor`, `hermes status` | Hermes' own checks |
| Curator | `hermes curator status/run/pause/resume/pin/unpin`, `hermes curator usage --json` | Hermes' CLI |
| Emergency stop | `hermes pause --reason …` / `hermes resume` (ESTOP sentinel in the profile) | Hermes' own stop for cron, kanban and gateway work |
| Version | `hermes --version` and the git log of the Hermes checkout | Hermes' CLI |

The Python calls run in a short bridge script under Hermes' own interpreter, the pattern the
runner already uses for the web-login vault (`packages/runner/src/logins.ts`).

**Rejected:**
- Reading `state.db` with SQLite from Node: the schema is internal to Hermes (version 25+,
  migrations on open, FTS tables); a Hermes update would break Helena silently.
- The dashboard REST API (`hermes dashboard`, :9119): it is the service this package
  retires; one process serving every profile contradicts agent isolation (one Unix user
  per project); it needs its own auth.
- The ACP adapter (`hermes acp`, `session/list`, `session/load`): `session/load` builds a
  full agent (MCP servers included) to replay a session, `session/list` returns only id,
  cwd, title and time, and there is no search or usage. ACP is the candidate for *driving*
  runs (runtime adapter, hub/framework), not for reading history.
- `hermes sessions export --format trace` (Claude Code JSONL): loses Hermes' per-session
  tokens, cost and timings.

Claude Code and Codex keep their sessions as JSONL files in the agent's home
(`~/.claude/projects/<cwd>/<session>.jsonl`, `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`).
The runner parses those two documented formats into the same message shape. Hermes'
importer for them (`hermes_cli/foreign_sessions.py`) flattens turns to text and drops tool
calls, so it is not used.

## 3. Live timeline: AG-UI events, as the chat already does

A run's command output is turned into AG-UI events by the runner's existing translator
(`packages/runner/src/agui.ts`, used by the chat today) and sent to
`POST /agent-runs/:id/events`. Helena stores them per run (`agent_run_event`), bounded, and the
run view reads them while the run runs and afterwards. This works for every runtime the
runner knows (Hermes, Claude Code, Codex), keeps a replay after Hermes prunes a session, and
needs no second protocol. The full transcript (section 2) adds what the event stream does
not carry, such as per-message timestamps and the session's token and cost totals.

## 4. Rendering: AI SDK UI message parts and the chat's components

The chat already converts AG-UI events into Vercel AI SDK `UIMessage` parts
(`apps/web/src/features/ai-chat/utils/agUiChunks.ts`) and renders them with components built
on `ai` / `@ai-sdk/react` and `streamdown` (reasoning disclosure, tool-call disclosure,
Markdown). The run timeline and the transcript view convert their data into the same
`UIMessage` parts and reuse those components, so a run looks like a chat answer.

**Considered:**
- Vercel AI Elements (Apache-2.0, shadcn-style copies: Conversation, Message, Reasoning,
  Tool, Task, ChainOfThought): the chat's components follow the same pattern over the same
  `UIMessage` parts. Copying AI Elements next to them would give two looks for one thing. A
  piece the chat lacks (for example `Task` or `ChainOfThought`) is copied from AI Elements
  with its notice when it is needed.
- AgentPrism (Evil Martians, MIT, React trace viewer over OpenTelemetry GenAI spans):
  alpha, Tailwind 3 (Helena uses Tailwind 4), its own look. Kept as the candidate for a span
  waterfall view once it supports Tailwind 4; the stored shape (section 1) already matches
  its input.
- Langfuse (MIT core), Opik (Apache-2.0), Laminar (Apache-2.0), Jaeger (Apache-2.0):
  separate services with their own storage and UI; rule §3b.3 keeps extra services out.
  Arize Phoenix: Elastic License 2.0, excluded.

## 5. Model prices: models.dev

Cost in euro uses the model price table owned by hub/autopilot. That table is seeded from
models.dev (<https://models.dev/api.json>, MIT; `cost.input/output/cache_read/cache_write`
in USD per million tokens; Hermes caches the same data as `models_dev_cache.json`) instead
of a hand-kept list. Helena multiplies the ledger's token columns (section 1) by the price
of the model that ran. Until the table exists, the views show tokens and leave the cost
empty.

## 6. Redaction

- Hermes transcripts and logs: Hermes' own redaction (`--redact`,
  `redact_sensitive_text`), applied before the data leaves the runner.
- Run events of every runtime: the runner masks the exact values it handed to the agent
  (MCP secrets, web-login passwords) and the patterns of secretlint's recommended preset
  (`@secretlint/core` + `@secretlint/secretlint-rule-preset-recommend`, MIT, 13.x, maintained)
  before sending. Rejected: porting Hermes' 36 regular expressions by hand.
