# Volition architecture

Volition runs It's a Plan, Mastra and Hermes natively on Kingston (Debian, systemd, no
Docker). Each component has one responsibility. This document is the reference for where a
feature belongs; a change that gives a second component the same responsibility is wrong.

## Responsibilities

| | Hermes | Mastra | Plan |
|---|---|---|---|
| Role | Executes agent work | Decides what runs, when, by whom and in which order | Stores all configuration and results; the only user interface |
| Owns | Every LLM call: chat, task execution, inbox classification, coordinator planning, review. Tool execution (terminal, files, code, browser over CDP, MCP clients). Sessions, memory, skills Hermes creates itself. | Workflows, event ingress, schedules, deterministic routing, budgets, retries, idempotency, approval suspension, run history. | Projects, issues, organization (agents, roles, departments, routing rules, policies), agent configuration, trigger rules, secrets, connections, mail accounts, browser logins, approvals, activity. |
| Does not | Schedule business work (Hermes cron is limited to Hermes maintenance). Delegate inside automated runs. Hold its own configuration: profiles are generated from Plan. | Call an LLM provider directly. Serve a user interface (Studio is a debugging tool). Store project or agent data of its own. | Run agents itself. Schedule work. Contain workflow logic beyond simple issue rules. |
| Stores | Sessions, memory, learned skills | Run state: runs, checkpoints, schedules | Configuration and results |

The Kingston integration service (`deployment/volition-stack/integration/server.mjs`) is the
only component that changes operating-system resources: project workspaces, browser units,
terminal sessions, Hermes profiles, the Gmail API and inbound mail. It has no user interface
and makes no decisions.

## Two paths

- **Interactive** — chat and @-mentions. The owner is present. Plan queues the message and
  the Hermes runner answers it. Mastra is not involved.
- **Automated** — assignment, the "Ready for agents" column, field triggers, trigger rules,
  schedules, inbound mail, webhooks. Plan or the integration service sends an event to
  Mastra; a Mastra workflow queues Hermes stages in Plan; results are written back to Plan.

## Interfaces

1. **Plan → Mastra**: events (`event-ingress`) and the control API (start, cancel, retry,
   schedules, runs).
2. **Mastra → Plan**: Mastra queues Hermes stages in Plan's run queue and synchronizes results
   to the issue. Mastra never calls Hermes directly, so every run is visible in Plan. A
   canceled workflow run cancels the queued run of the stage it waits for.
3. **Plan ↔ Hermes**: the runner claims queued work and chat messages, sends heartbeats and
   AG-UI events. A heartbeat answers `canceled` for a canceled run or chat answer, and the
   runner then stops Hermes. Hermes reads and writes Plan data through Plan's MCP server
   (issues, mail drafts, secret names).
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

## Rules that keep the boundaries

- Plan has one agent kind: an external agent driven by the Hermes runner.
- Plan does not queue automated agent runs itself. Assignment, field triggers and trigger
  rules send an event to Mastra.
- Business schedules exist only in Mastra; Plan's schedule pages manage them through the
  control API.
- Secrets are stored in Plan, encrypted. The runner delivers the secrets granted to an agent
  for one run as environment variables, website logins as entries of the profile's Hermes
  vault, and SSH keys as files of the profile. The model sees secret names only.
- Configuration files (`AGENTS.md`, `SOUL.md`, instruction files, managed skills, toolsets,
  MCP grants, model) are owned by Plan. A change Hermes makes to one of them is imported
  into Plan as a new revision. Memory and skills Hermes creates are owned by Hermes and are
  shown read-only in Plan.
- Automated runs use the toolsets of the agent's role. In chat, Hermes may delegate freely.
