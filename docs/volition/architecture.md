# Volition architecture

Volition runs Plan — the app is called **Helena** since 2026-09-23 (a fork of It's a Plan,
AGPL-3.0); "Plan" below still means this app, as elsewhere in this repository's docs — and
Hermes natively on Kingston (Debian, systemd, no Docker). Plan's API runs the workflow
engine (the Helena engine, on DBOS Transact) in its own process. Each component has one
responsibility. This document is the reference for where a feature belongs; a change that gives
a second component the same responsibility is wrong.

## Responsibilities

| | Hermes | Engine (in Plan's API) | Plan |
|---|---|---|---|
| Role | Executes agent work | Decides what runs, when, by whom and in which order | Stores all configuration and results; the only user interface |
| Owns | Every LLM call: chat, task execution, inbox classification, coordinator planning, review. Tool execution (terminal, files, code, browser over CDP, MCP clients). Sessions, memory, skills Hermes creates itself. | Builder workflows, the agent team and routines as durable workflows: event triggers, schedules, deterministic routing, budgets, retries, idempotency, approval suspension, checkpoints. | Projects, issues, organization (agents, roles, departments, routing rules, policies), agent configuration, trigger rules, the definitions and run history of workflows, routines and schedules, secrets, connections, mail accounts, browser logins, approvals, activity. |
| Does not | Schedule business work (Hermes cron is limited to Hermes maintenance). Delegate inside automated runs, apart from a coordinator's sub-agents (see Agent structure). Hold its own configuration: profiles are generated from Plan. | Call an LLM provider. Serve a user interface of its own: Plan shows its runs, steps and schedules. Store project or agent data of its own. | Run agents itself. Contain workflow logic outside the engine beyond simple issue rules. |
| Stores | Sessions, memory, learned skills | Execution state in the schema `helena_engine`: checkpoints, queues, the records of finished workflows (events for 7 days, runs for 30, failed runs for 90) | Configuration and results; the run history in `pipeline_run`, schedules in `helena_schedule` |

The Kingston integration service (`deployment/volition-stack/integration/server.mjs`) is the
only component that changes operating-system resources: project workspaces, browser units,
terminal sessions and Hermes profiles. It has no user interface and makes no decisions.

Plan imports mail over IMAP in its worker and sends mail over SMTP after the owner confirms
it. For an account with triage switched on, the worker hands new inbox mail to the
integration service's triage route (`POST /api/inbox/triage`). That route has no classifier
since Mastra's `inbox-triage` workflow went; a classifier on Hermes is an open item. New
mail also reaches the engine as a `mail_received` event, which starts the builder workflows
with a mail trigger. Hermes reads and drafts mail through Plan's MCP tools
`search_mail`, `read_mail`, `draft_reply` and `request_mail_send`.

## Two paths

- **Interactive** — chat, @-mentions and decisions on approval requests. The owner is
  present. Plan queues the message, or the run that carries the decision, and the Hermes
  runner answers it. The engine is not involved.
- **Automated** — assignment, the "Ready for agents" column, field triggers, trigger rules,
  schedules, inbound mail, webhooks. Plan publishes a domain event to the engine's outbox
  (the worker does so for new mail); an engine workflow queues Hermes stages in Plan's run
  queue; results are written back to Plan. A schedule is a routine: a row of
  `helena_schedule` whose fire has the engine create or reopen a task and delegate it to an
  agent. The delegation queues the Hermes run, or starts the agent team for a coordinator.
  A workflow a member put together in Plan's workflow builder runs on the engine as well,
  started by hand, by a task event of its project, by its schedule, by a webhook or by
  incoming mail.

## Interfaces

1. **Plan → engine** (in the API process): domain events through the engine's outbox (the
   DBOS queue `helena-events`; the worker enqueues through a DBOS client), starts, cancels,
   retries from the failed step, and signals: a finished agent run or a decided approval
   wakes the workflow that waits for it.
2. **Engine → Plan**: the engine queues Hermes stages in Plan's run queue, synchronizes
   results to the issue, creates or reopens the tasks of routines, and records each step in
   `pipeline_run_step`. Step types and trigger types are registries
   (`apps/api/src/modules/engine/registry.ts`). The engine never calls Hermes directly, so
   every run is visible in Plan. A canceled workflow run cancels the queued run of the stage
   it waits for.
3. **Plan ↔ Hermes**: the runner claims queued work and chat messages, sends heartbeats and
   AG-UI events. A heartbeat answers `canceled` for a canceled run or chat answer, and the
   runner then stops Hermes. Hermes reads and writes Plan data through Plan's MCP server
   (issues, mail drafts, secret names). Before an agent sends, publishes, pays or deletes
   anything outside Plan it calls `request_approval` and ends its run; the owner decides
   on the Approvals page, next to the workflow runs held at an approval step. A command
   Hermes flags as dangerous goes the same way in a run: Hermes' `plan-approval-guard`
   plugin blocks it until Plan lists it as approved for that run.
4. **Plan → integration service**: provisioning, inbox triage, browser control.

```
          owner
            │
            ▼
  ┌──────────────────── Plan ─────────────────────┐
  │ UI · data · run queue (agent_run, agent_chat) │
  │ engine: workflows, schedules (API process)    │
  └──────────────────────┬──────────▲─────────────┘
                         │ claim,   │ MCP
                         │ events   │
                         ▼          │
                      ┌──── Hermes ─┴─┐
                      │ one profile   │
                      │ per agent     │
                      └───────────────┘
```

## Agent structure

- The Home agent (`master`) is the master of a team's agents and is used from Home only. It
  is a member of every project so it can read and create work there, and the project-scoped
  lists of the API leave it out. It gets work done in a project by creating a task there,
  delegated to the project's coordinator.
- Each project has a coordinator (`hermes-<slug>-coordinator`) that reports to the Home
  agent. An agent created in a project works in that project only, as a specialist that
  reports to the coordinator.
- A template is a pool agent that runs nowhere. A project adds a copy of it as a specialist
  of its own. Knowledge shared across projects goes through the skills library; each copy
  has its own memory.
- A coordinator may split one run across Hermes sub-agents (the `delegation` toolset). They
  are not Plan agents and Plan does not show them. Longer or specialist work goes to the
  project's specialists through the agent team.

## Knowledge vault

The knowledge is Markdown and other files in the vault (`/srv/volition/vault`); the files
are the source of truth. Plan's Docs page is an editor and a view on them, Obsidian edits
the same files through Syncthing, and agents read and write them through Plan's MCP tools.
Plan keeps only an index of them in Postgres (`vault_entry`, `vault_link`, `vault_move`).

- **Layout:** `Home/`, `Projects/<KEY>/` (Docs, Files, Assets, Inbox, the area folders),
  `Templates/`, `Private/` (the owner's, group `volition-private`, never an agent's),
  `.trash/` (a trashed path keeps its relative path below it), `.obsidian/`.
- **One index, built by Plan.** The worker watches the whole vault, indexes every file
  (notes with frontmatter and links, the extracted text of PDFs, scans, images and office
  files) and repairs drift with a periodic rescan. The API indexes its own writes at once.
  Nobody else builds an index; other writers just write files.
- **History:** the vault is a git repository of its text files, `Private/` a second one. A
  save in Plan commits at once as the person or agent who made it; changes made outside
  Plan are committed by the watcher as `extern` once the vault is quiet.
- **Links:** `[[Note]]` links a note, `[[VOL-12]]` a task (the task lists the notes that
  link it under "Wissen"). A reference to a file stores its path and sha256 and finds the
  file again after a move through `GET /knowledge/resolve`.
- **Addresses:** the Docs page opens a note by vault-relative path,
  `/project/<KEY>/docs?path=<path>` (Home: `/docs?path=<path>`); Obsidian opens it as
  `obsidian://open?vault=Volition&file=<encoded path>`.
- **Reach:** a person reaches `Projects/<KEY>/` by their Docs permission in the project;
  `Home/`, `Templates/` and `Private/` are the owner's. A project agent reads and writes its
  project and reads `Templates/`; the Home agent reads everything but `Private/` and writes
  `Home/`. The knowledge MCP tools (`search_knowledge`, `read_document`, `write_note`,
  `list_folder`, `backlinks`) enforce this. For Hermes' own file tools the runtime policy
  carries the same reach as `vaultAccess` (`{ root, read, write, deny }`, absolute paths),
  which the runner hands to Hermes as `VOLITION_VAULT_ACCESS` for the approval plugin to
  enforce.

## Rules that keep the boundaries

- Plan has one agent kind: an external agent driven by the Hermes runner.
- Every external agent of a project runs in a Hermes profile of its own, with the
  project's workspace and browser. The integration service provisions it with the
  project. An agent that works in several projects has no runtime, because the runner
  claims an agent's runs from all of its projects with one working directory.
- Automated agent work goes through the engine. Assignment, field triggers and trigger
  rules publish an event that the engine's triggers match.
- Business schedules exist only in the engine: `helena_schedule` holds them, and the engine
  fires each scheduled time once (croner computes the times in the schedule's time zone, the
  DBOS workflow ID `fire:<schedule>:<time>` keeps a second replica from firing it again).
  The Schedules page of a project and the Home overview manage routines. Every fire is
  listed with the runs of its routine. After downtime only the newest missed time counts:
  by default it is skipped when it starts more than ten minutes late; a schedule set to
  catch up runs it once. A fire whose routine task is still open is skipped. Agents get no Hermes cron: the runner never passes
  the `cronjob` toolset, and the approval guard plugin blocks the tool.
- Each area of a project has a folder at the same relative path in the project's workspace
  and in its vault folder. Plan stores the folder name; the integration service creates,
  moves and trashes the folders with the project's provisioning. A run for a task of an area
  starts in the area's workspace folder.
- A local process is not trusted for being local. The engine has no port and no token: it
  runs inside the API process and keeps its state in Plan's database, which only Plan's
  database role reaches. Its public webhook trigger (`POST /hooks/workflows/:hookId`)
  accepts only requests signed with the hook's secret (Standard Webhooks) or, for senders
  that cannot sign, carrying the secret as a bearer token.
- Documents are files in the vault (`PROJECT_VAULT_ROOT`): `Home/`, `Templates/`,
  `Private/` (the owner's; group `volition-private`, which the agents' user is not in),
  and `Projects/<KEY>/`. Plan's Files page reads and writes them directly; a file deleted
  there moves to `.trash/` at the same relative path (`Private/.trash/` for `Private/`).
  A project's workspace is shown read-only next to its vault folder. Task and comment
  attachments are stored once, in `Projects/<KEY>/Files/Tasks/<KEY>-<n>/`, and the
  attachment row keeps the vault path and the sha256; a row can also link a file that
  was in the vault before. Agents read the same files on disk.
- Credentials are stored in Plan, encrypted, on its Credentials page: website logins, API keys,
  SSH keys and secrets, each for the team or one project and granted to agents. Before each
  run and chat answer the runner makes the agent's Hermes vault hold exactly the website
  logins granted to it, which Hermes fills in the browser without the model seeing a
  password; the secrets and API keys an agent's MCP servers name reach Hermes as environment
  variables. Every delivery and every filled login is recorded in the credential's audit log.
  Chromium's own password manager is off in the project browsers.
- A login the vault cannot complete (a captcha, a passkey, a code sent by SMS) goes to the
  owner as an approval request: the owner signs in in the project's live browser, whose
  profile keeps the session, and the approval starts the agent's next run.
- Configuration files (`AGENTS.md`, `SOUL.md`, instruction files, managed skills, toolsets,
  MCP grants, model) are owned by Plan. The runner puts back a managed file Hermes changed or
  removed, every minute and after every run, and Plan shows the changed version so it can be
  taken over. The same holds for the plugin links Plan requires in every Hermes home, such as
  `plan-approval-guard`; a run whose link cannot be put back fails.
- Memory and the skills an agent creates are stored by Hermes in the agent's profile. Whether
  an agent learns is set per agent in Plan (on unless turned off), and so is Hermes' curator
  (off unless turned on). The owner reads what an agent learned in Plan, edits or clears its
  memory, and pins, discards or takes a learned skill into the team's library, where it
  becomes one of Plan's skills; the runner carries each action out on its next sync. An
  agent learns in its own turns, so what learning costs is in the tokens its runs report:
  the runner turns off Hermes' post-turn review and its model-written session titles, which a
  one-shot run would pay for without Plan counting them. Hermes' review and curator only
  change skills the review created, never Plan's.
- After a run finishes, Plan may ask the runner for a reflection: a short, counted follow-up
  turn in the run's own session, started right after it, in which the agent keeps only what
  that run taught it. Its only tools are memory and skills, so it cannot continue the task and
  has no path to SOUL.md, approvals, or any other setting of its own; a plan-managed skill it
  reaches through those tools is put back like any other managed file. It runs under the same
  approval guard as the run itself, never with `--yolo`, bounded to 8 turns and 120 seconds so
  it ends on its own or is stopped. Plan decides whether one is worth it from the agent's own
  setting — off, after a failure or rework, or also after a run of many tool calls, the default
  — and never for an agent that does not learn. The runner reports what the reflection saved
  and its tokens, which are added to the run's own and count toward the agent's ceilings; Plan
  shows the outcome, why it ran, and what was saved on the run in its history.
- An agent has the MCP servers of Hermes' `config.yaml` that the owner did not turn off for
  it, and the servers of the team's library enabled on it. Both are stored in Plan; the runner
  writes them to a managed configuration of the agent's profile, never to `config.yaml`.
- Automated runs use the toolsets of the agent's role. In chat, Hermes may delegate freely.
- Whether an agent takes work is stored and enforced in Plan, at its run queue: a paused
  agent's runs and chat answers are not claimed, a mention or a delegation queues nothing,
  and an agent-team stage for it is refused, which fails the engine run with the reason.
  Token ceilings (per agent per UTC day and month, per project per month) count the tokens
  the runs report; reaching one pauses the agent. The agent team's own budgets (attempts,
  time per stage) are the limits of one workflow run.
- An agent that needs a person's answer calls Plan's `mark_issue_blocked` tool: the issue
  gets the Blocked label and the question as a comment to the person the agent reports to,
  and the run ends as a success marked blocked.
