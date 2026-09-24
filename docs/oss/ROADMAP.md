<!-- Draft (package G). Moves to the repository root at the public cut. -->

# Roadmap

Helena is heading for 1.0. These are the building blocks, in the order they land.

## Toward 1.0

| | What | State |
|---|---|---|
| Framework | `@helena/sdk`, registries for every extension point, domain event bus, plugin manifest and loader, an example plugin | in progress |
| Browser | Sharp, flicker-free live view with exact input; agents use the project browser through the gateway; lock and takeover; logins without passwords in prompts | in progress |
| Runtime parity | Everything set in Helena reaches every Hermes profile, Claude Code and Codex exactly; drift is detected and shown; new agents come online by themselves | in progress |
| Helena engine | The worker runs workflows, agent teams, routines and schedules itself, with pause, resume, run now, history and retry in the UI | in progress |
| Glass-box runs | Full session history with replay and "resume from here"; memory with diff and approval; cost per agent, model and day; logs per run | next |
| Autopilot dial | One dial per project and agent across approvals, token limits and money budgets, based on a price table per model | next |
| Security | Agent isolation on, access centre, HTTPS, secure defaults for new installs | in progress |
| Open-source ready | One-command Docker install, demo crew, docs in English and German, CI, fresh public history | in progress |
| Battle test | Weeks of real use, chaos tests, a security review | before 1.0 |

## After 1.0

- **Local models:** OpenAI-compatible local servers for Hermes, with a choice of which work
  runs locally and which in the cloud.
- **Plugin catalogue:** community runtimes, connectors, workflow steps and templates.
- **Demo without a key** built into the setup (recorded runs), and a hosted demo.
- **More runtimes** through the Agent Client Protocol.
- **Kiosk and wall displays** for the crew's live view.

Ideas and discussion: GitHub Discussions. Larger features start as an issue with a short
design.
