<!-- Draft (package G). Describes the target architecture after Mastra is replaced by the
     Helena worker (hub/native-engine). Moves to the repository root at the public cut. -->

# Helena architecture

Helena is a project tracker with AI agents as team members. This document explains where
each responsibility lives. A change that gives a second component the same responsibility
is wrong.

## Components

```text
 Browser · phone · kiosk
          │ HTTPS
   ┌──────┴──────┐
   │ Helena web  │  Next.js: pages, live views, the tool panel (chat, terminal, browser, code)
   └──────┬──────┘
          │ /backend proxy
   ┌──────┴──────┐        ┌──────────┐
   │ Helena API  │◄──────►│ Postgres │  projects, tasks, agents, runs, approvals, settings
   │ (Elysia)    │        └──────────┘
   │  REST · MCP · auth · webhooks · run queue
   └──┬───────┬──┘
      │       │ claim / heartbeat / events / MCP
      │  ┌────┴─────────┐     ┌──────────────────────────────────────┐
      │  │ Runner       │────►│ Hermes Agent · Claude Code · Codex   │
      │  │ (per machine)│     │ one profile per agent, from Helena   │
      │  └──────────────┘     └──────────────────────────────────────┘
      │
   ┌──┴──────────┐   queue, schedules, workflows, agent teams, janitors, resume,
   │ Helena      │   mail import, webhooks and notifications
   │ worker      │
   └─────────────┘
   Browser router + gateway: one Chromium per project, live view, takeover, agent browsing
   Terminal router: project terminals (tmux) and the owner terminal
   Vault: Markdown and files on disk, git history, Syncthing to devices
```

| Component | Does | Does not |
|---|---|---|
| **Web** | Every screen, the one header row, live views, the tool panel | Talk to the database; hold secrets |
| **API** | Data and rules. REST and OpenAPI for people and scripts, MCP for agents, auth (passwords, passkeys, TOTP, API keys), approvals, the run queue, webhooks | Call a model; run agents |
| **Worker** | Everything that happens later or on time: workflow runs and agent teams (a state machine over `pipeline_run` and its steps, with leases and resume), routines and schedules, janitors, mail import, deliveries | Hold user interface state |
| **Runner** | Claims queued runs and chat messages for the agents it serves. Writes each agent's complete runtime profile from Helena (instructions, SOUL, skills, tools, MCP grants, model, reasoning, approval guard), starts the runtime, streams AG-UI events back, reports tokens and results | Decide what runs. It only executes what Helena queued |
| **Hermes Agent** | The AI work: the tool loop, memory, skills, sessions, sub-agents | Schedule business work; hold its own configuration |
| **Browser router + gateway** | A persistent browser profile per project, the live view (CDP screencast) with takeover, and agent browsing through the gateway. Logins are filled from Helena's access centre, so the model never sees a password | Store passwords itself |
| **Vault** | The knowledge: Markdown and files on disk, the source of truth. Helena keeps an index; Obsidian edits the same files through Syncthing | |

## Principles

1. **Helena is the single source of truth.** What is set in Helena applies everywhere. The
   runner puts back a managed file a runtime changed, and Helena shows the drift.
2. **Hermes does the AI work.** Helena never calls a model.
3. **No second orchestrator.** Workflows, routines, schedules and agent teams are created,
   paused, resumed, run now, retried and inspected in Helena's UI.
4. **Everything at an extension point** (below). Built-in features use the same interfaces a
   plugin uses.
5. **Standards before our own code:** MCP, AG-UI, OpenAPI, CloudEvents / Standard Webhooks,
   OpenTelemetry GenAI conventions and SPDX. Each choice is recorded in `docs/helena-decisions/`.

## Two paths of work

- **Interactive:** chat, @-mentions, decisions on approvals. You are present. Helena queues
  the message, a runner answers it, and you watch it stream.
- **Automated:** assignment, the "ready for agents" column, triggers, schedules, inbound mail,
  webhooks. The worker starts the matching workflow or agent team. Each agent step is a
  queued run that a runner claims, and each result is written back to the task.

## Agents and their organisation

- The **Home agent** is the master. It works across projects and gets work done in a project
  by creating a task for that project's coordinator.
- Each project has a **coordinator** that reports to the Home agent. **Specialists** of a
  project report to its coordinator.
- A **template** runs nowhere. A project adds a copy; learning accepted on the template
  applies to every copy, and a copy keeps its own overrides.
- **Autopilot:** a policy decides per agent and project what an action category (read,
  write, send, delete, pay, publish) may do. The options are allowed, allowed with approval,
  or refused, within budgets. Every agent tool declares its category (MCP tool annotations).

## Extension points

| Extension point | An extension provides |
|---|---|
| Runtimes (runner) | Profile writing, start and resume, chat stream, sessions, memory, usage, capabilities |
| Connectors (access centre) | Sign-in flow, credential schema, services, grants, agent tools, health |
| Agent tools (MCP) | Tools with a description, input schema and action category |
| Workflow steps and triggers | Step types (agent task, approval, wait, condition, webhook, notification) and triggers (schedule, task event, webhook, mail) |
| Policies | One central decision: may this agent do this category of action here |
| Events | A domain event bus for webhooks, workflows and plugins |
| UI slots | Tool panel tools, project settings sections, agent page tabs, dashboard widgets, header actions |
| Templates and packages | Agent templates, skill packs, project and workflow templates, as files |
| Languages and themes | Translation files, colour tokens |

A plugin is a package with a `helena.plugin.json` manifest, loaded at start and built on the
versioned `@helena/sdk`. See [plugins.md](plugins.md).

## Security boundaries

- Internal services listen on loopback or Unix sockets; only the web entry is published.
- Embedded tools (terminal, code editor, browser) require a Helena session. The proxy strips
  cookies and authorisation headers before a tool sees the request.
- Credentials are stored encrypted (AES-256-GCM, `APP_ENCRYPTION_KEY`), granted per project
  and agent, and delivered to a runtime only when a run needs them. Each delivery is audited.
- An agent of consequence (send, publish, pay, delete) stops at an approval. A command the
  runtime flags as dangerous is blocked by Helena's approval guard until you approve it for
  that run.
- **Agent isolation** (native installs): one Unix user per project, a launcher, an egress
  proxy and a Helena socket per agent. In Docker the boundary is the agents container.

## Deployment shapes

- **Docker Compose** (default): images `helena` (web, API, worker, router; one image, a role
  per container) and `helena-agents` (Hermes plus the runner), with Postgres and volumes for
  the vault, workspaces, Hermes state, storage and browser profiles.
- **Native Debian** (advanced): the same components as systemd services, with agent isolation
  through systemd.

## Repository layout

```text
apps/api        Elysia API, MCP server, auth
apps/web        Next.js web app
apps/worker     background work: workflows, schedules, janitors, mail, deliveries
apps/bot        optional Telegram notifications
packages/db     Drizzle schema and migrations
packages/runner the agent runner (Apache-2.0)
packages/*      auth, crypto, vault, mail, storage, agent tools, net, SDK
deployment/     native install (systemd), Docker, the browser router, integration services
docs/           development, decisions, guides
```
