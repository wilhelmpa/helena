<!-- Draft of the public README (package G). Moves to the repository root at the public cut.
     Screenshots and the video are placeholders until the UI settles. -->

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/brand/lockup-dark.svg" />
  <img src="apps/web/public/brand/lockup-light.svg" alt="Helena" height="64" />
</picture>

# Helena

**Mission control for AI agents.**

Plan the work on a real project board, hand tasks to agents like to teammates,
watch every step live, and stay in charge. Powered by Hermes; works with Claude Code and Codex.

[Quickstart](#quickstart) · [Architecture](ARCHITECTURE.md) · [Security](SECURITY.md) ·
[Contributing](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Deutsch](README.de.md)

<!-- badges: license, CI, release, image -->

<!-- screenshot: the board with the crew working on tasks (light and dark) -->

</div>

## Why Helena

Most agent tools put a chatbot next to your work. Helena puts the agents **on the board**.

- An agent is a **teammate**: it has a role, a place in the org chart and permissions, and
  it takes tickets.
- It **delegates**: the Home agent hands work to project coordinators, and they hand it to
  specialists.
- It **asks** when it is stuck and **learns** from what it did.
- Everything it does is **traceable**: every run, tool call, file change and cost.

You run it on your own server, with your own database and your own model keys. There are
no seat fees and no lock-in.

## Features

| | |
|---|---|
| **Crew** | Agents in an org chart: Home agent → coordinators → specialists. Assign tickets to them like to people; see who delegated what to whom. Start from a pool of agent templates with researched skill sets. |
| **Glass-box runs** | Every run is a timeline: reasoning, tool calls, browser frames, file changes, model and cost. Watch it live, replay it later, resume it from any point. |
| **Autopilot dial** | One setting per project and agent: *propose* · *act with approval* · *act and report* · *autonomous within budget*. Budgets in tokens, money and time. |
| **Take over anywhere** | Browser, terminal, chat: you take control, hand it back, and the agent carries on. |
| **Supervised learning** | Skills and memory an agent learns arrive as proposals with a diff. Accepted learning applies to every copy of a template. |
| **Your knowledge stays yours** | A folder of Markdown files, versioned with git, edited in the notes (SilverBullet) and mirrored to your devices with Syncthing. |
| **Bring your runtime** | Hermes Agent does the AI work (memory, skills, tools). Claude Code and Codex run with the same instructions, tools and rules. |
| **No secrets in prompts** | Logins and keys never enter a prompt. The browser gateway fills them, TOTP runs through Helena, and one access centre holds every connection. |
| **Routines in plain words** | "Every Monday at 9" becomes a schedule. A visual workflow builder covers the rest: agent steps, approvals, conditions, waits, actions. |
| **A real project tracker** | Boards, cycles, custom fields, dashboards, docs. You can use Helena without a single agent. |

<!-- short video: a task goes from the board to the crew and back with a result -->

## Quickstart

> **Status:** Helena is in its battle test before 1.0. The Docker packaging below is the last
> step before the release; until then Helena runs as a native Debian install.

```bash
mkdir helena && cd helena
curl -fsSLO https://raw.githubusercontent.com/<org>/helena/main/compose.yml
curl -fsSLO https://raw.githubusercontent.com/<org>/helena/main/helena-init
sh helena-init            # writes .env with generated secrets and asks for your URL
docker compose up -d      # Postgres, Helena, Hermes; migrations run on start
docker compose logs helena | grep setup   # the one-time setup link
```

Open the setup link, create the admin account and choose **Load the demo**. You get two
sample projects with a small crew, tasks, a routine and a workflow. Without a model key the
demo agents answer from recordings; add a key under *Access* to let them really work.

Target: a working Helena with the demo crew in **under 15 minutes** on an empty machine.

## How it fits together

```text
 Browser · phone · kiosk
          │
   Helena web ───► Helena API ◄──► Postgres
                       │
                 Helena worker     queue, schedules, workflows, agent teams, janitors
                       │
                 Runner ─────────► Hermes · Claude Code · Codex
                       │           (profiles written from Helena)
                 Browser router + gateway (one Chromium per project)
                 Terminal · Vault (git) · Syncthing
```

**Helena is the single source of truth.** Whatever is set in Helena applies everywhere, with
drift detected and shown. **Hermes does the AI work.** Helena itself calls no model. Details
in [ARCHITECTURE.md](ARCHITECTURE.md).

## Extend it

Every capability is built at an extension point: runtimes, connectors, agent tools (MCP),
workflow steps and triggers, policies, events, UI slots, templates, languages and themes.
Helena's own features use the same interfaces a plugin does. See [plugins.md](plugins.md).

## Security in short

Secure by default:
- registration is closed, and the first admin comes from a one-time setup link;
- no LAN auto-login, and the owner terminal only with TOTP;
- agent actions of consequence (send, publish, pay, delete) wait for your approval;
- credentials are encrypted at rest and never shown to a model;
- **Helena sends no telemetry.**

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## License

Helena is licensed under the **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)).
`packages/runner` is licensed under the Apache License 2.0.

Helena is a fork of It's a Plan (AGPL-3.0) by Andrii Poluosmak
([upstream](https://github.com/croffasia/itsaplan)). Hermes Agent is © Nous Research, MIT
License. Third-party components: [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
