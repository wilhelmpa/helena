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
- **Target.** `RuntimeAdapter` registry: `cli` adapters for today's presets, `acp` adapters for the Agent Client Protocol, optional `profile` and `readers`.
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
- **Done (this branch):** see §8 and the commits. Route tools and integration tools are registered with categories.

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
- **Triggers.** `manual, task_created, task_assigned, status_changed, label_added, schedule`. The issue service calls them directly (`queuePipelineTriggers`).
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

**Target.** CloudEvents in a transactional outbox (`helena_domain_event` and `helena_domain_event_delivery`). The worker dispatcher delivers to durable subscribers: webhooks, triggers, the knowledge indexer, plugins.

### UI

- **Panel tools.** `chat, terminal, code, browser, inbox, mail, connections`. They are spread over `utils/workspaceTools.ts`, `WorkspaceToolbar` (`ICONS`), `WorkspaceToolsProvider` (components), `useWorkspacePanel` (`PROJECT_SCOPED_TOOLS`), labels in `nav.json`, and about 10 id checks in `WorkspacePanel`.
- **Project settings.** `SETTINGS_SECTIONS` plus 11 static routes, with parallel lists in `workspaceNavigation`, `ShellHeaderTitle` and the command palette.
- **Agent sections.** Hard-wired `stack` arrays in `TeamAiAgentFields.tsx`.
- **Dashboard widgets.** `WidgetType` plus two `switch`es and three records.
- **Home nav.** Already data (`homeNavigation.ts`).
- **Project nav.** JSX.
- **Administrator.** `GOD_SECTIONS` plus 12 static routes.
- **Target.** A `UiSlot` registry with the slots `panel-tool`, `project-settings`, `agent-section`, `dashboard-widget`, `header-action`, `home-nav`, `admin-section` and `capture-action`.
- **Done:** panel tools. **Open:** the other slots, one at a time, each by the agent working on that screen.

### Templates and packs

The agent pool is a file bundle (`bundles/agent-pool`, `docs/helena-decisions/template-bundles.md`). Its format is now `@helena/sdk` `TemplateBundle` with a JSON Schema. Plugins can offer bundles.

### Knowledge (second brain)

- **Today.** The vault index (`packages/vault`) and knowledge MCP tools.
- **Target.** `KnowledgeSource` (enumerate, get, events → items, resolve links, ACL scope, provenance) and `CaptureTarget` ("save to knowledge"), offered by surfaces through the `capture-action` slot. **Owner:** hub/second-brain.

## 2. Architecture

_(filled in below as the pieces land)_

## 3. The extension points

## 4. Plugin schreiben

## 5. Writing a plugin

## 6. Stability and versioning

## 7. Security model

## 8. Who adopts which registry
