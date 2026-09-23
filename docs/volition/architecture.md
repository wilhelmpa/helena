# Volition architecture

Volition runs Plan (this repository, a fork of It's a Plan), Mastra and Hermes natively on
Kingston (Debian, systemd, no Docker). Each component has one responsibility. This document is
the reference for where a feature belongs; a change that gives a second component the same
responsibility is wrong.

## Responsibilities

| | Hermes | Mastra | Plan |
|---|---|---|---|
| Role | Executes agent work | Decides what runs, when, by whom and in which order | Stores all configuration and results; the only user interface |
| Owns | Every LLM call: chat, task execution, inbox classification, coordinator planning, review. Tool execution (terminal, files, code, browser over CDP, MCP clients). Sessions, memory, skills Hermes creates itself. | Workflows, event ingress, schedules, deterministic routing, budgets, retries, idempotency, approval suspension, run history. | Projects, issues, organization (agents, roles, departments, routing rules, policies), agent configuration, trigger rules, secrets, connections, mail accounts, browser logins, approvals, activity. |
| Does not | Schedule business work (Hermes cron is limited to Hermes maintenance). Delegate inside automated runs, apart from a coordinator's sub-agents (see Agent structure). Hold its own configuration: profiles are generated from Plan. | Call an LLM provider directly. Serve a user interface (Studio is a debugging tool). Store project or agent data of its own. | Run agents itself. Schedule work. Contain workflow logic beyond simple issue rules. |
| Stores | Sessions, memory, learned skills | Run state: runs and checkpoints for 90 days, schedules | Configuration and results |

The Kingston integration service (`deployment/volition-stack/integration/server.mjs`) is the
only component that changes operating-system resources: project workspaces, browser units,
terminal sessions, Hermes profiles, the Gmail API and inbound mail. It has no user interface
and makes no decisions.

## Two paths

- **Interactive** — chat, @-mentions and decisions on approval requests. The owner is
  present. Plan queues the message, or the run that carries the decision, and the Hermes
  runner answers it. Mastra is not involved.
- **Automated** — assignment, the "Ready for agents" column, field triggers, trigger rules,
  schedules, inbound mail, webhooks. Plan or the integration service sends an event to
  Mastra; a Mastra workflow queues Hermes stages in Plan; results are written back to Plan.
  A schedule is a routine: a Mastra schedule of the `agent-routine` workflow, which has
  Plan create or reopen a task and delegate it to an agent. The delegation queues the
  Hermes run, or starts `agent-team` for a coordinator.

## Interfaces

1. **Plan → Mastra**: events (`event-ingress`) and the control API (start, cancel, retry,
   schedules, runs).
2. **Mastra → Plan**: Mastra queues Hermes stages in Plan's run queue, synchronizes results
   to the issue, and creates or reopens the tasks of routines. Mastra never calls Hermes
   directly, so every run is visible in Plan. A canceled workflow run cancels the queued run
   of the stage it waits for.
3. **Plan ↔ Hermes**: the runner claims queued work and chat messages, sends heartbeats and
   AG-UI events. A heartbeat answers `canceled` for a canceled run or chat answer, and the
   runner then stops Hermes. Hermes reads and writes Plan data through Plan's MCP server
   (issues, mail drafts, secret names). Before an agent sends, publishes, pays or deletes
   anything outside Plan it calls `request_approval` and ends its run; the owner decides
   on the Approvals page, next to the Mastra runs held at an approval gate. A command
   Hermes flags as dangerous goes the same way in a run: Hermes' `plan-approval-guard`
   plugin blocks it until Plan lists it as approved for that run.
4. **Plan and Mastra → integration service**: provisioning, sending mail after the owner
   confirms it, browser control. The integration service reports inbound mail to Mastra as
   an event.

```
          owner
            │
            ▼
  ┌──────────────────── Plan ─────────────────────┐
  │ UI · data · run queue (agent_run, agent_chat) │
  └──┬─────────▲──────────────┬──────────▲────────┘
     │ events, │ queue stages,│ claim,   │ MCP
     │ control │ sync results │ events   │
     ▼         │              ▼          │
  ┌── Mastra ──┴──┐        ┌──── Hermes ─┴─┐
  │ workflows     │        │ one profile   │
  │ schedules     │        │ per agent     │
  └───────────────┘        └───────────────┘
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

## Rules that keep the boundaries

- Plan has one agent kind: an external agent driven by the Hermes runner.
- Every external agent of a project runs in a Hermes profile of its own, with the
  project's workspace and browser. The integration service provisions it with the
  project. An agent that works in several projects has no runtime, because the runner
  claims an agent's runs from all of its projects with one working directory.
- Plan does not queue automated agent runs itself. Assignment, field triggers and trigger
  rules send an event to Mastra.
- Business schedules exist only in Mastra; Plan has no scheduler of its own. The Schedules
  page of a project and the Home overview manage routines through the control API. Every
  fire of a schedule gets its own event id from its Mastra run id and is listed with the
  runs of its project. A fire that starts more than ten minutes late is skipped, and so is
  one whose routine task is still open. Agents get no Hermes cron: the runner never passes
  the `cronjob` toolset, and the approval guard plugin blocks the tool.
- Each area of a project has a folder at the same relative path in the project's workspace
  and in its vault folder. Plan stores the folder name; the integration service creates,
  moves and trashes the folders with the project's provisioning. A run for a task of an area
  starts in the area's workspace folder.
- A local process is not trusted for being local. Mastra answers only its proxy, which
  holds a token created on every start. The proxy accepts control requests with a token
  only Plan's API and worker hold, and Studio requests only with a token Nginx adds after
  Plan confirmed the instance owner. No process of the Unix user Hermes runs as can read
  either token. The complete trust model is in
  `deployment/volition-stack/optional/mastra-studio/ORCHESTRATION_CONTRACT.md`.
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
  and an agent-team stage for it is refused, which fails the Mastra run with the reason.
  Token ceilings (per agent per UTC day and month, per project per month) count the tokens
  the runs report; reaching one pauses the agent. Mastra's own budgets are the limits of
  one workflow run.
- An agent that needs a person's answer calls Plan's `mark_issue_blocked` tool: the issue
  gets the Blocked label and the question as a comment to the person the agent reports to,
  and the run ends as a success marked blocked.
