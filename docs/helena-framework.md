# Helena as a framework

Helena is built from extension points. Its own features and a stranger's plugin use the same contracts: a runtime, a connector, a tool, a workflow step, a UI slot. The contracts live in one versioned package, `@helena/sdk` (`packages/sdk`). Owner, 2026-09-24: "gut erweiterbar, keine isolierten Lösungen, Helena als Framework".

Why the SDK looks the way it does (MCP, ACP, CloudEvents, Standard Schema, and what was rejected): [helena-decisions/framework.md](helena-decisions/framework.md).

- [1. Survey: current state → target](#1-survey-current-state--target)
- [2. Architecture](#2-architecture)
- [3. The extension points](#3-the-extension-points)
- [4. Plugin schreiben (Deutsch)](#4-plugin-schreiben)
- [5. Writing a plugin (English)](#5-writing-a-plugin)
- [6. Stability and versioning](#6-stability-and-versioning)
- [7. Security model](#7-security-model)
- [8. Who adopts which registry](#8-who-adopts-which-registry)

## 1. Survey: current state → target

Survey of `volition/hub` at a5e1ee2e (2026-09-24). "Hard-wired" means a list in code plus `switch` or `if` chains elsewhere that have to be kept in sync by hand.

### Runtimes (runner)

- **Today.** Six presets: `claude`, `codex`, `opencode`, `antigravity`, `copilot`, `hermes`. They lived in `packages/runner/src/presets.ts` as `PRESETS`/`PresetName`.
  - The names were checked in `config.ts`.
  - Stream parsing is a `switch` over seven output formats in `agui.ts` (`AnswerStream`, `UsageReader`), plus a Hermes result reader in `execute.ts`.
  - The launcher only knows `hermes`, `claude` and `codex` (`ISOLATED_RUNTIMES`).
  - Profile materialization (`policy.ts`, `inventory.ts`, `learning.ts`, `reflect.ts`) is Hermes-only code. MCP injection is wired differently for each runtime.
- **Target.** A `RuntimeType` registry: `cli` types for today's presets and `acp` types for the Agent Client Protocol. Each type has a per-agent profile adapter (`RuntimeAdapter` from hub/hermes-sync: `ensure`, `runSettings`, `sessionFacts`, `defaults`) and `readers` (hub/hermes-in-helena).
- **Profile contributions** (hub/hermes-sync) are a registry too: MCP servers and Hermes settings every agent profile gets. The runtime policy wire types (`RuntimePolicySnapshot` …) live in `@helena/sdk`.
- **Done (this branch):** the presets are adapters in `packages/runner/src/runtimes.ts`. `config`, `execute` and `agui` look runtimes up in the registry. A plugin runtime brings its own stream parser. The runner loads plugin folders from its config.
- **Open:** the ACP client in the runner, and moving the Hermes profile/readers behind `profile`/`readers` (hub/hermes-sync, hub/hermes-in-helena).

### Agent tools

The API has four sources of tools:
1. **Route tools.** About 183 Elysia routes tagged `mcpTool('name')` (`apps/api/src/mcp/generate.ts`), served by `POST /mcp` and used by internal agents. Annotations come from the HTTP method.
2. **The internal-agent allowlist.** `AGENT_ACTIONS` / `ALWAYS_ON_ACTIONS` in `modules/agents/core/runtime/tools/catalog.ts`.
3. **Local tools.** `get_current_date`, `prepare_issue_import`, `read_skill`.
4. **Integration tools.** 72 tools in 7 integrations in `packages/agent-tools` (`INTEGRATIONS`: jina, firecrawl, telegram, threads, instagram, notion, gitea). Only internal (Mastra) agents could use them; Hermes and MCP clients never saw them.

The browser gateway (hub/agent-browser-mcp) adds 24 `browser_*` tools with no category.

- **Target.** One `AgentTool` registry of MCP tools with an action category. Helena's MCP endpoint serves it.
- **Done (this branch):**
  - Route tools are the internal plugin `helena.mcp`, with categories from the HTTP method plus overrides.
  - Integration tools are connector tools of `helena.integrations`, with explicit categories.
  - `/mcp` serves the registry and asks `decide()` first.

### Connectors, credentials, connections

- **Integrations catalog.** `INTEGRATION_CATALOG` (`modules/agents/integrations/catalog.ts`) combines two sources:
  - 153 LLM providers (`AI_PROVIDERS`, models from models.dev)
  - the tool integrations (above)
- **Credential kinds.** `CREDENTIAL_KINDS = web_login | api_key | ssh_key | secret`, copied into four places.
- **Git providers.** `github | gitlab | gitea | forgejo | bitbucket`.
  - Inbound handling is already registry-shaped: `GitProvider`, `PROVIDERS`.
  - The outbound API side is about 47 `if provider === …` chains.
- **Mail accounts.** Generic IMAP/SMTP.
- **Target.** A `Connector` registry: credential schema, auth flow (fields / OAuth2 / custom), services with action categories, health check, tools.
- **Done:** the tool integrations are connectors.
- **Open (hub/access-center):** credential kinds, git providers, Google, mail.

### Workflows: step types and triggers

- **Step kinds.** `STEP_KINDS = agent | approval | condition | action | wait` (`modules/pipelines/definition.ts`) are copied into four places: the DB CHECK, web, Mastra and the builder. Each kind has a `switch` in:
  - validation (`readStep`)
  - execution (`OPERATIONS` in `control.ts`, Mastra `runStep`)
  - the builder (`PipelineStepInspector`, `newStep`, `useStepSummary`, `STEP_FIELDS`, icons)
- **Action kinds.** `set_status, add_labels, remove_labels, set_assignee, comment, create_subtask`.
- **Triggers.** `manual, task_created, task_assigned, status_changed, label_added, schedule`. Before the engine, the issue service called them directly (`queuePipelineTriggers`); now they listen to `helena.issue.*`.
- **Other hard-wired trigger lists:** routines (Mastra schedules only), the older actions graph (`issue_state_changed`, `issue_comment_added`), and agent run triggers (a CHECK: `mention, delegation, field, schedule, manual, approval`).
- **Target.** `WorkflowStepType` and `TriggerType` registries. The worker engine runs steps; triggers subscribe to domain events.
- **Owner:** hub/native-engine (see §8).

### Policy and approvals

There are three approval mechanisms: `approval_request` (kinds `send | publish | pay | delete | other`), pipeline approval steps, and Mastra gates.
- The Hermes guard (`deployment/volition-stack/integration/hermes-plugins/plan-approval-guard`) has no categories of its own: it blocks `cronjob_manage`, hard-line commands, dangerous `terminal`, and `execute_code`.
- `governance.ts` enforces token ceilings and pause.
- Mastra `effects.ts` has the only rule of the form "category → needs approval".

**Target.** One `decide({agent, project, action, context})` over the registered `PolicyEvaluator`s. The strictest decision wins; when all abstain, the action is allowed (today's behaviour). **Owner:** hub/autopilot.

### Events and webhooks

There is no event bus. Instead there are polling outboxes (`webhook_delivery`, `notification_delivery`, `hub_inbox_event`, `agent_run`, …), and each mutation calls its side effects one by one: `createIssue` calls activity, webhook, pipeline triggers, delegate run and notifications.
- `emitWebhookEvent` runs after the transaction, not inside it.
- Webhook events: `issue.created/updated/deleted/assigned/state_changed/label_changed/link_changed`, `comment.created/updated/deleted`.
- Signature: `X-Itsaplan-Signature: t=…,v1=hex`.

**Target.** Every change publishes a CloudEvent on the event bus. Durable subscribers (webhooks, triggers, the knowledge indexer, plugins) are served by the workflow engine's event transport (D-C2). The SDK owns no table.

**Done:**
- The core events are emitted.
- Webhooks are a consumer (`helena.webhooks`), in process until the transport exists.
- Standard Webhooks headers are sent.

### UI

- **Panel tools.** `chat, terminal, code, browser, inbox, mail, connections`. They are spread over `utils/workspaceTools.ts`, `WorkspaceToolbar` (`ICONS`), `WorkspaceToolsProvider` (components), `useWorkspacePanel` (`PROJECT_SCOPED_TOOLS`), labels in `nav.json`, and about 10 id checks in `WorkspacePanel`.
- **Project settings.** `SETTINGS_SECTIONS` plus 11 static routes, with parallel lists in `workspaceNavigation`, `ShellHeaderTitle` and the command palette.
- **Agent sections.** Hard-wired `stack` arrays in `TeamAiAgentFields.tsx`.
- **Dashboard widgets.** `WidgetType` plus two `switch`es and three records.
- **Home nav.** Already data (`homeNavigation.ts`).
- **Project nav.** JSX.
- **Administrator.** `GOD_SECTIONS` plus 12 static routes.
- **Target.** A `UiSlot` registry with the slots `panel-tool`, `project-settings`, `agent-section`, `dashboard-widget`, `header-action`, `home-nav`, `admin-section`, `capture-action` and `workspace-layout`.
- **Done:** panel tools, workspace layouts (hub/layout, `docs/helena-decisions/layout.md`). **Open:** the other slots, one at a time, each by the agent working on that screen.

### Templates and packs

The agent pool is a file bundle (`bundles/agent-pool`, `docs/helena-decisions/template-bundles.md`). Its format is now `@helena/sdk` `TemplateBundle` with a JSON Schema. Plugins can offer bundles.

### Knowledge (second brain)

- **Today.** The vault index (`packages/vault`) and knowledge MCP tools.
- **Target.** `KnowledgeSource` (enumerate, get, events → items, resolve links, ACL scope, provenance) and `CaptureTarget` ("save to knowledge"), offered by surfaces through the `capture-action` slot. **Owner:** hub/second-brain.

## 2. Architecture

```text
                        @helena/sdk (packages/sdk)
   "."        contracts + Registry + categories + events + policy  (isomorphic, no deps at runtime)
   "/server"  PluginHost, manifest check, loader, outbox helper    (API, worker, runner)
   "/bundles" template bundle directory form                       (Bun only)
   "/web"     UI slot registry + slot types                        (web)

 API process                    worker process                runner (per machine)
 ─────────────                  ──────────────                ────────────────────
 shared/helena.ts               src/events.ts                 src/runtimes.ts, plugins.ts
  registries, host, event bus    host, event bus               runtime registry + host
  built-ins (internal plugins):  built-ins: helena.webhooks    built-ins: helena.runtimes
   helena.integrations           external plugins ("server")    (hermes, claude, codex,
   helena.mcp (route tools)                                      opencode, antigravity, copilot)
   helena.webhooks               durable subscribers, served    plugin runtimes from the
   helena.bundles                once the workflow engine       config's `plugins`
  external plugins ("server")    hands over its transport
  /mcp serves registries.tools ─► policy decide() ─► route or plugin handler
  /god/plugins, /plugins/ui-slots, /plugins/:id/ui/*, /teams/:id/template-bundles/*

 web: extensions/panelTools.tsx (panel tool registry: built-ins as helena.panel, plugins'
      frame slots from /plugins/ui-slots), Administrator → Plugins, Agentenpool import/export
```

One plugin package can reach every process. Its manifest has `main.server` for the API and the worker, and `main.runner` for the runner. UI comes from frame slots, which the API serves from the plugin's `ui/` folder.

Domain events are CloudEvents on a per-process event bus. A durable subscriber (webhooks, triggers, the knowledge indexer, a plugin) is served by an **event transport**, which the workflow engine provides (decision D-C2: the SDK owns no queue and no table). Until the engine is there, the API runs every subscriber in process right after the change, the way the side effects ran before.

## 3. The extension points

Every extension registers under a stable id. The id is checked against the manifest, and the registration is stamped with its plugin. The examples are taken from `examples/plugins/hello-helena`.

### 3.1 Agent tools (MCP)

An agent tool is an MCP tool plus an action category. Helena's MCP endpoint (`POST /mcp`) serves every registered tool that needs no connector credential. The policy is asked before each call.

```ts
ctx.tools.register({
  name: 'hello_time',                       // MCP name, unique in Helena
  description: 'The current date and time, in a time zone (default UTC).',
  inputSchema: ctx.z.object({ timeZone: ctx.z.string().optional() }),  // any Standard Schema or JSON Schema
  category: 'read',                         // or leave it out: the MCP annotations decide
  async handler({ timeZone }, call) {       // call: agent, project, caller, credential, log
    return { timeZone: timeZone ?? 'UTC', now: new Date().toISOString() };
  },
});
```

- **Categories** (D-C1, risk order): `read` < `report` < `write` < `send` < `publish` < `execute` < `delete` < `pay` < `credentials`.
  - Without a `category`, the MCP annotations decide: read-only → `read`, destructive → `delete`, closed world → `write`, and anything else → `send`.
  - A tool whose effect depends on its input (a browser click) adds `classify(input)`.
- **Return values:** a plain value becomes a JSON text block plus `structuredContent`. A `CallToolResult` passes through as it is.
- **A whole MCP server, no code:** declare it in the manifest (`provides.mcpServers`, stdio or http). Give `toolCategories` where its annotations say too little.

### 3.2 Connectors

A connector is an outside account. It declares the credential form, how to connect (fields, OAuth2 or custom), its services with action categories, a health check, and the tools that run with the credential.

```ts
ctx.connectors.register({
  id: 'hello-greeter',
  label: { en: 'Hello Greeter', de: 'Hallo-Grüßer' },
  credentialSchema: [{ key: 'greeting', label: 'Greeting', type: 'string', required: true }],
  auth: { kind: 'fields' },                 // or { kind: 'oauth2', authorizationUrl, tokenUrl, scopes }
  services: [{ id: 'greetings', label: 'Greetings', actions: ['send'] }],
  health: async (credential) => (credential.greeting ? { status: 'ok' } : { status: 'error' }),
  tools: [greetTool],                       // run with call.credential; bound per agent in Home → Tools
});
```

- A connector shows up in the integrations catalog. Its tools can be bound to a credential for an agent.
- The access center (hub/access-center) stores credentials and grants. The connector only describes them.

### 3.3 Workflow step types and triggers

```ts
ctx.stepTypes.register({
  id: 'hello-helena.greet',
  label: { en: 'Greet', de: 'Grüßen' },
  category: 'report',
  configSchema: ctx.z.object({ name: ctx.z.string().min(1), greeting: ctx.z.string().default('Hello') }),
  outputs: ['text'],                        // {{step.<id>.text}} for later steps
  validate: (config) => (config.name.trim() ? [] : [{ code: 'missing_name', field: 'name' }]),
  execute: async ({ config }) => ({ status: 'completed', output: { text: `${config.greeting}, ${config.name}!` } }),
});
```

- A step returns `completed`, `failed` (optionally `retryable`) or `waiting`. `waiting` can carry `until` or a signal (an approval, a run, an event). The engine stores the run and calls `resume` when the wait ends.
- A trigger type declares its `events` (CloudEvents types) and `match(config, event)`, or `next(config, after)` for schedules, and `describe(config, locale)`.
- The engine (hub/native-engine) runs both. The builder renders a form from `configSchema` unless `ui.form` names a built-in form.

### 3.4 Policy

```ts
ctx.policies.register({
  id: 'acme.no-payments-at-night',
  evaluate: ({ agent, project, action, context }) =>
    action === 'pay' && new Date().getHours() < 7
      ? { effect: 'needs-approval', reason: 'Payments at night need a person' }
      : null,                               // null = no opinion
});
```

- Every evaluator is asked, and the strictest answer wins (`deny` > `needs-approval` > `allow`).
- An evaluator that throws counts as `deny`.
- When all abstain, the action is allowed.
- The request has the shape of a Cedar or CASL request, so hub/autopilot can use either engine behind one evaluator.

### 3.5 Domain events

Events are CloudEvents 1.0 (`specversion`, `id`, `source`, `type`, `time`, `subject`, `data`) plus the extensions `helenateam`, `helenaproject` and `helenaactor`.

| Type | Emitted where |
|---|---|
| `helena.issue.created` / `updated` / `assigned` / `state_changed` / `label_changed` / `link_changed` / `deleted` | issue service (`modules/webhooks/emit.ts`), with the issue as `snapshot` |
| `helena.comment.created` / `updated` / `deleted` | comments |
| `helena.run.started` / `finished` / `failed` | `agents/core/run-activity.ts` (internal and runner runs) |
| `helena.approval.requested` / `decided` | `approvals/service.ts` |
| `helena.chat.message` | chat: a person's message, an agent's finished answer |
| `helena.routine.fired` | `hermes-team-control.ts` `dispatchRoutine` |

```ts
// Durable by default: served by the event transport (in the worker, with retries).
ctx.events.subscribe('helena.issue.created', async (event) => { … }, { id: 'greet-new-tasks' });
// A plugin publishes only under its own id, and only types its manifest declares.
await ctx.events.publish({ type: 'hello-helena.greeted', data: { … } });
```

In the API, `publishDomainEvent(init, tx?)` (in `shared/helena.ts`) publishes a core event. The engine plugs in with `useEventTransport(transport)` in the API and `eventDelivery.useTransport(transport)` in the worker. `EventTransport` is `{ append(events, tx), start(subscriptions) }`. `createOutboxTransport(store)` builds one over a claim-style `OutboxStore`.

### 3.6 UI slots

The slots are `panel-tool`, `project-settings`, `agent-section`, `dashboard-widget`, `header-action`, `home-nav`, `admin-section`, `capture-action` and `workspace-layout`.
- A built-in slot renders a React component from the web bundle.
- A plugin slot is a **frame**: a page from the plugin's `ui/` folder, served by the API at `/plugins/<id>/ui/…`. It runs in a sandboxed iframe (`allow-scripts allow-forms`, no same-origin) and carries a `sandbox` CSP of its own.

```ts
ctx.uiSlots.register({
  slot: 'panel-tool', id: 'hello', label: { en: 'Hello', de: 'Hallo' },
  icon: 'hand', inHeader: true, render: { kind: 'frame', src: 'panel.html' },
});
```

A `workspace-layout` slot is data only: areas that show the page, the panel's own tool or a tool of their own, side by side. It appears in the header's layout menu, and any panel tool, a plugin's included, can go into its areas:

```ts
ctx.uiSlots.register({
  slot: 'workspace-layout', id: 'review', label: { en: 'Review', de: 'Prüfen' },
  areas: [
    { id: 'page', shows: 'page', side: 'page' },
    { id: 'main', shows: 'main', side: 'panel' },
    { id: 'board', shows: 'tool', tool: 'hello', side: 'panel' },  // the plugin's own panel tool
  ],
});
```

The web app wires the panel (`extensions/panelTools.tsx`) and the layouts (`extensions/workspaceLayouts.ts`). The other slots are typed and served by `/plugins/ui-slots`. Each gets wired when its screen is next reworked (§8).

### 3.7 Runtimes

The runner looks runtimes up in its registry (`packages/runner/src/runtimes.ts`). The built-in presets are `cli` adapters. A plugin adds a runtime from its `runner` entry, which the runner's config file names under `plugins`.

```ts
ctx.runtimes.register({
  id: 'echo', label: 'Echo', protocol: 'cli',
  capabilities: { sessions: true, chat: true, systemPrompt: false, modelSelection: false, mcp: false, isolation: false },
  command: { bin: 'echo-agent', outputFormat: 'echo-jsonl', promptVia: 'stdin', head: () => [], tail: [] },
  parser: () => ({ line: (value) => /* → RuntimeStreamEvent[] */ [] }),
});
```

- **The target contract is ACP:** `protocol: 'acp'` with `launch(settings)`. The runner's ACP client is RUN-01 (hub/hermes-sync). Hermes stays on its CLI for now: its ACP adapter does not reach `--toolsets`, `--max-turns`, the run budget or the reasoning (docs/helena-decisions/runtime-protocol.md).
- `adapter(context)` builds the agent's profile adapter (`RuntimeAdapter`: `ensure`, `runSettings`, `sessionFacts`, `defaults`, with a `ProfileReport` of drift). The built-ins build theirs in `packages/runner/src/adapters.ts`.
- `ctx.profileContributions.register({ id, mcpServers?, suppress?, denyToolsets?, hermesConfig? })` adds MCP servers or Hermes settings to every agent's profile, in every runtime.
- `readers` answers the runtime requests of hub/hermes-in-helena: sessions, transcripts in the OTel GenAI shape, logs, health, version, curator and emergency stop.

### 3.8 Knowledge sources and capture targets

A `KnowledgeSource` provides:
- `list` (paged), `get`, and an optional `present` sweep;
- `events` → the item ids an event touched;
- `resolveLink`.

Every item carries its ACL `scope` (project/team/private + `permission`), its `provenance`, and an optional `group`.

A `CaptureTarget` stores "save to knowledge" input. Surfaces offer it through the `capture-action` slot. The owner is hub/second-brain (`@helena/knowledge`, internal plugin `helena.knowledge`).

### 3.9 Template bundles

The format is `@helena/sdk` `TemplateBundle` (JSON Schema `@helena/sdk/bundle.schema.json`; directory form in `@helena/sdk/bundles`). A plugin offers a bundle with `ctx.bundles.register({ id, label, bundle })`.
- Agentenpool → "Vorlagen importieren" lists every offer and accepts a file.
- Agentenpool → "Vorlagen exportieren" downloads the team's templates.
- The routes are `/teams/:teamId/template-bundles/{offers,import,export}`.

### 3.10 Usage-limit sources

A `UsageLimitSource` reads how much of a subscription's limits is used: the rolling session window, the week, model-specific weeks, pay-as-you-go credit. It reads where a login already lives, inside the process that holds it, and hands Helena numbers only (`UsageLimitSnapshot`: provider, a hash of the account, windows with share used and reset time, plan, state hints). Decision and sources: [helena-decisions/provider-limits.md](helena-decisions/provider-limits.md).

```ts
ctx.usageLimitSources.register({
  id: 'acme.credits',
  label: { en: 'Acme credits', de: 'Acme-Guthaben' },
  providers: ['acme'],
  // API/worker: numbers it can fetch without an agent (a key from the plugin's settings).
  poll: async ({ now }) => [{ provider: 'acme', account: 'main', source: 'acme.credits', login: null,
    plan: 'team', windows: [{ id: 'monthly', kind: 'monthly', label: null, usedPercent: 37,
    windowMinutes: 43200, resetsAt: '2026-10-01T00:00:00Z', severity: null, limited: null }],
    extra: null, resetCredits: null, allowed: true, via: 'probe', observedAt: now.toISOString(),
    unavailable: null }],
});
```

- **Runner sources** offer `probes(context)` (one per login, keyed, so a login several agents share is probed once per interval) and `observe(format, context)` (snapshots read off a runtime's own output as a run goes). The built-ins are `hermes` (Hermes' own `account_usage`), `codex` (Codex' app-server `account/rateLimits/read`) and `claude-code` (Claude Code's local `/usage` and its `rate_limit_event` lines), internal plugin `helena.limits` in `packages/runner/src/limits`.
- **API sources** offer `poll(context)`. The built-in is `spool` (files the owner reporter `itsaplan-runner limits-report` writes; internal plugin `helena.limits` in the API).
- Helena asks the runners with the runtime request `limits.read` once per interval and on "Aktualisieren"; runners also post to `POST /agent-runtime/limits`. Everything a source hands over is checked with `normalizeUsageLimitSnapshot`; `windowState`/`snapshotState` give ok, near, limited or unknown.
- The numbers are read with `GET /provider-limits` and the read-only MCP tool `get_provider_limits`.

## 4. Plugin schreiben

1. **Ordner anlegen.** Ein Plugin ist ein Ordner mit `helena.plugin.json`. Vorbild: `examples/plugins/hello-helena`.
2. **Manifest schreiben.** Die Felder stehen in `@helena/sdk/plugin.schema.json`; `$schema` darauf zeigen lassen, dann prüft der Editor.
   - `id`: kleingeschrieben, mit Punkten gegliedert, z. B. `acme.jira`. `helena.*` ist reserviert.
   - `version` (semver) und `sdk` (semver-Bereich, z. B. `^0.1.0`).
   - `main.server` wird von API und Worker geladen, `main.runner` vom Runner.
   - `provides` listet alles, was das Plugin registriert: Ids oder Präfixe mit `*`.
   - `permissions` nennt die Rechte: `actions` (die Kategorien seiner Werkzeuge, Schritte und Dienste), `events` (was es abonniert), `network` (wohin es spricht) und `credentials` (ob seine Werkzeuge Zugangsdaten bekommen).
3. **Einstieg schreiben.** Die Datei exportiert als Default `{ register(ctx) { … }, start?(ctx), stop?() }`.
   - Aus `@helena/sdk` kommen nur **Typen** (`import type`).
   - `zod`, der Event-Bus, der Logger und die Einstellungen kommen über `ctx`.
   - Alles, was `register` einträgt, prüft Helena gegen das Manifest. Ein Werkzeug der Kategorie `send` ohne `send` in `permissions.actions` bricht die Registrierung ab, und das Plugin gilt dann als fehlerhaft.
4. **Testen.** Mit `PluginHost` und `loadExternalPlugins` aus `@helena/sdk/server` lädt ein Test das Plugin ohne Helena. Vorbild: `packages/sdk/src/__tests__/example-plugin.test.ts`.
5. **Installieren.**
   - Den Ordner nach `HELENA_PLUGINS_DIR` legen.
   - Administrator → Plugins: externe Plugins einschalten und das Plugin freigeben. Die Freigabe gilt für genau diese Version und diese Dateien (sha256).
   - API und Worker neu starten.
   - Ein Laufzeit-Plugin trägt man zusätzlich in der Runner-Konfiguration unter `plugins` ein (oder in `HELENA_RUNNER_PLUGINS`).
6. **Benutzeroberfläche.** Seiten liegen in `ui/` und erscheinen als Frame-Slot, zum Beispiel als Werkzeug im Panel. Sie laufen in einer Sandbox ohne Zugriff auf Helenas Seite oder Sitzung.

## 5. Writing a plugin

1. **Create the folder.** A plugin is a folder with a `helena.plugin.json`. See `examples/plugins/hello-helena`.
2. **Write the manifest.** The fields are in `@helena/sdk/plugin.schema.json`; point `$schema` at it and your editor checks the file.
   - `id`: lowercase, dot-separated, e.g. `acme.jira`. `helena.*` is reserved.
   - `version` (semver) and `sdk` (a semver range such as `^0.1.0`).
   - `main.server` is loaded by the API and the worker, `main.runner` by the runner.
   - `provides` lists everything the plugin registers: ids, or prefixes with `*`.
   - `permissions` lists what it needs: `actions` (the categories of its tools, steps and services), `events` (what it subscribes to), `network` (where it connects) and `credentials` (whether its tools receive credentials).
3. **Write the entry.** It exports by default `{ register(ctx) { … }, start?(ctx), stop?() }`.
   - Import only **types** from `@helena/sdk` (`import type`).
   - `zod`, the event bus, the logger and the settings come through `ctx`.
   - Helena checks everything `register` adds against the manifest. For example, a `send` tool without `send` in `permissions.actions` aborts the registration, and the plugin is reported as failed.
4. **Test.** A test can load the plugin without Helena, using `PluginHost` and `loadExternalPlugins` from `@helena/sdk/server`. See `packages/sdk/src/__tests__/example-plugin.test.ts`.
5. **Install.**
   - Put the folder into `HELENA_PLUGINS_DIR`.
   - Administrator → Plugins: switch external plugins on and approve the plugin. The approval covers exactly this version and these files (sha256).
   - Restart the API and the worker.
   - A runtime plugin also goes into the runner config under `plugins` (or `HELENA_RUNNER_PLUGINS`).
6. **UI.** Pages go into `ui/` and appear as frame slots, for example a panel tool. They run sandboxed, with no access to Helena's page or session.

## 6. Stability and versioning

- **Versioning.** `@helena/sdk` follows semver.
  - `SDK_VERSION` is `0.1.0`. Until 1.0, a minor version may break plugins. From 1.0 on, only a major version may.
  - A plugin states the range it works with (`sdk`). Helena refuses to load it outside that range, with a clear message in the Administrator.
- **Breaking changes.** Each of these is a breaking change:
  - removing or renaming an exported name, a registry, a manifest field or a core event type;
  - narrowing a type a plugin passes in;
  - widening a type Helena passes to a plugin in a way the plugin cannot handle;
  - changing the meaning of an action category.
- **Not breaking:** new optional fields, new registries, new event types, and new categories at the end of a union a plugin only reads.
- **Formats with their own versions:**
  - the manifest (`urn:helena:schema:plugin-manifest:v1`);
  - the bundle (`formatVersion: 1`);
  - CloudEvents (`specversion: 1.0`).
  - A core event's `data` only gains fields. A new shape gets a new type name.
- **Reserved names.** `helena.*` plugin ids and event types are Helena's. `_meta["helena/action"]` is the category key on MCP tools.
- **Licence boundary** (owner decision, 2026-09-24):
  - `@helena/sdk` is Apache-2.0 inside the AGPL-3.0 monorepo. That covers the contracts (the types a plugin imports with `import type`) and the plugin API it is called through (`register(ctx)` and the context). A plugin may therefore carry any licence, including a proprietary one.
  - The host stays AGPL-3.0: API, worker, runner, web, and everything that loads and runs plugins. A change to the host is AGPL.
  - Contributions to Helena, including the SDK, go through a CLA (not DCO), because a commercial licence may come later.

## 7. Security model

- **An external plugin is code running in Helena's process with Helena's rights.** Node offers no in-process sandbox that deserves the name: `vm` is not a security boundary, and `isolated-vm` would be a native addon. So trust is decided before loading, not enforced afterwards.
  - External plugins are **off** until the owner switches them on (Administrator → Plugins). Each plugin is **approved** at its id, version and sha256 digest of manifest plus code. A changed file or a new version is not loaded until it is approved again, like Grafana's allowlist for unsigned plugins.
  - Nothing is loaded without `HELENA_PLUGINS_DIR`.
- **Enforced at registration:** the manifest's `provides`, the action categories in `permissions.actions`, event subscriptions within `permissions.events`, the plugin's own event namespace, and `permissions.credentials` for tools that receive credentials. A violation fails the whole plugin, and what it had already registered is removed.
- **Declared, not enforced:** `permissions.network`, and file-system or process access. They are shown to the owner as part of the approval decision.
- **Tool calls:** every MCP call goes through `decide()` (hub/autopilot provides the evaluators).
  - A tool acting on Helena's API as its caller gets the caller's own credential, never more.
  - A connector's tool receives the decrypted credential only when an agent's configured tool binds it.
- **UI:** a plugin's pages run in a sandboxed iframe with an opaque origin. The page response also carries `Content-Security-Policy: sandbox …`. The web app's own CSP stays `script-src 'self'`, and only the API origin is added to `frame-src`.
- **Runner plugins:** they are listed in the runner's own config file, which only the operator edits. They run with the runner's rights, and under agent isolation the launcher still starts the commands.

## 8. Who adopts which registry

| Branch | Registry / seam | What to do |
|---|---|---|
| hub/native-engine (done) | `WorkflowStepType`, `TriggerType`, `EventTransport` (D-C2), `PolicyEvaluator` host | The engine runs a plugin's step and trigger types from `registries.stepTypes` / `registries.triggerTypes` (`engine/plugins.ts`: config under `config` checked against `configSchema`, `{{variables}}` filled, `execute`/`resume` with waits on an approval, an agent run or an event, outputs as `{{step.<id>.<field>}}`, event triggers with patterns); the builder lists them and draws their form from the JSON Schema. Helena's own types stay on the engine's durable interface (`engine/sdk.ts`: `op`, `sleepUntil`, `waitForSignal`), which the SDK shape does not offer. The engine is the `EventTransport` (API and worker). Task triggers consume `helena.issue.*` (the issue service's `queuePipelineTriggers` is gone). Routines emit `helena.routine.fired`. Every step above `report` asks `host.decide` with its category. Open: time-driven plugin triggers (`next`). Decision: `docs/helena-decisions/workflow-engine.md`. |
| hub/autopilot | `PolicyEvaluator` | One evaluator (`helena.autopilot`) over autopilot levels and budgets. Import `ACTION_CATEGORIES`/`actionRank` from `@helena/sdk`. The MCP endpoint already asks `decide()`; the runtime permission path (ACP) and step execution follow. |
| hub/access-center | `Connector` | Register credential kinds and the Google/mail connectors as connectors (services with categories, `auth`, `health`); move the `@repo/agent-tools` HTTP clients to MCP servers (F23); categories from the SDK. |
| hub/hermes-in-helena | `RuntimeType.readers` | The contract is yours, moved into `@helena/sdk` (`runtime-readers.ts`); import the types from there and hang the Hermes/Claude/Codex readers on the built-in types in `packages/runner/src/runtimes.ts`. |
| hub/hermes-sync (merged) | `RuntimeType` (`acp`), `RuntimeAdapter`, `ProfileContribution` | Your runtime.ts and the contribution types are in `@helena/sdk` unchanged (runtime-profile.ts, runtime-policy.ts; `RuntimeId` widened for plugin runtimes); the runner files re-export them and the contributions list is an SDK registry (`ctx.profileContributions` for runner plugins). Next: RUN-01, the ACP client behind `protocol: 'acp'` for Claude and Codex (Hermes stays on its CLI). |
| hub/agent-browser-mcp | `AgentTool` | Register the 24 `browser_*` tools with `category` + `classify(input)` (click may send/pay/publish); import categories from the SDK; a real `handover` approval kind instead of the text prefix. |
| hub/second-brain | `KnowledgeSource`, `CaptureTarget`, `capture-action` slot | The API and worker hosts exist: `host` in `apps/api/src/shared/helena.ts`, `startEventDelivery().host` in `apps/worker/src/events.ts`. Load `knowledgePlugin` there with `host.load(knowledgePlugin, manifest)`; the host's `knowledgeSources`/`captureTargets` are the registries. |
| hub/provider-limits | `UsageLimitSource` | The registry and its built-ins (`hermes`, `codex`, `claude-code` in the runner, `spool` in the API). hub/autopilot: an evaluator may read `agentLimitState(agentId)` (`#modules/provider-limits/service`) to hold non-urgent runs back while the agent's account is at its limit (optional, proposed in provider-limits.md). |
| hub/oss-packaging | plugins dir, logger | `HELENA_PLUGINS_DIR` in the units/compose; OPS-01 pino logger behind `ctx.log`. |
| web owners | UI slots | Settings sections, agent sections, dashboard widgets, header actions, home nav and admin sections move onto the slot registry one at a time, the way the panel did. |
