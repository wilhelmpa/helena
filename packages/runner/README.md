# @itsaplan/runner

[It's a Plan](https://itsaplan.dev) is a self-hosted, open-source issue tracker. An AI
agent in it is a project member: it has a role, permissions, and its own issues.

This package runs such agents on your own machine — one, or several at once.

- Polls your instance for the agent's queued runs. Runs each one with a coding agent CLI.
  Reports the result.
- Has presets for Claude Code, Codex, opencode, Antigravity CLI, GitHub Copilot CLI and
  Hermes Agent.
  Each preset sets the unattended flags and the session resume.
- Runs your own `command` instead, if you prefer. The command takes the task on stdin.
- Answers the agent's chat. Sends the text and the tool calls while the CLI prints them.

## Quick start

**1. Get the agent's key.** In your project, go to Settings, AI agents. Create an agent
of kind External. The key appears one time only, at creation.

**2. Enable MCP** for the project, in Settings, MCP Server. MCP is off by default. The
agent reads the issue and writes its result through it.

**3. Give the coding agent the address of that server.** Claude Code reads `.mcp.json`
from the folder it runs in. For the other CLIs, see
[Coding agent setup](https://github.com/croffasia/itsaplan/blob/main/docs/runner.md).

```json
{
  "mcpServers": {
    "itsaplan": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer ${ITSAPLAN_API_KEY}" }
    }
  }
}
```

The runner sets `ITSAPLAN_API_KEY` for the command that it starts. The key thus stays in
one file.

**4. Write `itsaplan-runner.json`** in the same folder:

```json
{
  "url": "http://localhost:3000",
  "apiKey": "the key you just copied",
  "agent": "claude"
}
```

**5. Start it:**

```bash
npx -y @itsaplan/runner
```

The project shows the agent as online in a few seconds. Delegate an issue to the agent,
or mention it in a comment. The task then starts in your terminal.

## Which coding agent

`agent` names a CLI that the runner knows. The runner then builds the command itself: the
flags for an unattended run, and the session resume. Every preset keeps a chat session.

| Agent         | Runs               |
| ------------- | ------------------ |
| `claude`      | Claude Code        |
| `codex`       | Codex CLI          |
| `opencode`    | opencode           |
| `antigravity` | Antigravity CLI    |
| `copilot`     | GitHub Copilot CLI |
| `hermes`      | Hermes Agent       |

Each preset needs the CLI's own MCP config.
[Coding agent setup](https://github.com/croffasia/itsaplan/blob/main/docs/runner.md) holds
that file, and the notes for each CLI.

`--agent` on the command line has priority over the file, except over an `agents` entry
that names its own. The runner appends the arguments after `--` to the ones from the
preset:

```bash
npx -y @itsaplan/runner --agent claude -- --model opus
```

Write the same arguments in the file if a service manager starts the runner:

```json
{
  "url": "http://localhost:3000",
  "apiKey": "the key you copied on creation",
  "agent": "claude",
  "cwd": "/Users/me/work/my-repo",
  "args": ["--model", "opus"]
}
```

Your arguments come after the preset's own. A repeated flag thus replaces its value.

`command` replaces the preset with your own shell command. The command receives the task
on stdin. The runner keeps no session for it, because it does not know how to resume one.

## Several agents on one runner

One key is one agent. A runner set up the way you want it can serve several of them at
once: it polls for each key on its own, and every agent uses the coding agent, the working
directory and the arguments the file already gives.

```json
{
  "url": "http://localhost:3000",
  "agent": "claude",
  "cwd": "/Users/me/work/my-repo",
  "apiKeys": ["the first agent's key", "the second agent's key"]
}
```

Nothing else changes: the runner gives each command its own `ITSAPLAN_API_KEY`, so the one
MCP config in that folder works for all of them.

Use `agents` instead of `apiKeys` where an agent needs something of its own. A field an
entry sets replaces the shared one, and it inherits every field it leaves out, except its
`apiKey`, which every entry sets itself. `name` is what the runner's log lines call that
agent; without it they number the agents `#1`, `#2` in the order of the file.

```json
{
  "url": "http://localhost:3000",
  "agent": "claude",
  "cwd": "/Users/me/work/my-repo",
  "agents": [
    { "apiKey": "the first agent's key", "name": "planner" },
    {
      "apiKey": "the second agent's key",
      "cwd": "/Users/me/work/other-repo",
      "args": ["--model", "opus"]
    }
  ]
}
```

`concurrency` counts per agent and per feed, so a runner with three agents at
`concurrency: 2` can have six queued runs in flight and six chat answers alongside them,
each one a coding agent CLI of its own. The environment variables and the command-line
options describe every agent at once; an entry has priority over them.

An agent whose key the instance refuses stops on its own, and the others keep working.

## Settings

The runner reads `./itsaplan-runner.json`. For a different file, give the path as an
argument or in `ITSAPLAN_RUNNER_CONFIG`:

```bash
npx -y @itsaplan/runner /path/to/config.json
```

The environment variables have priority over the file. The command-line options have
priority over both. An `agents` entry has priority over all three, for the fields it sets.

| Field            | Environment variable        | Default            | What it does                                                           |
| ---------------- | --------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `url`            | `ITSAPLAN_URL`              | required           | Your Itsaplan instance                                                 |
| `apiKey`         | `ITSAPLAN_API_KEY`          | required           | The external agent's key. Replaced by `apiKeys` or `agents`            |
| `apiKeys`        |                             | —                  | Several keys, all with these settings. Not with `agents`               |
| `agents`         |                             | —                  | Several agents, each with its own key and settings. Not with `apiKeys` |
| `agent`          | `ITSAPLAN_AGENT`            | —                  | The coding agent to run                                                |
| `provider`       | `ITSAPLAN_PROVIDER`         | —                  | Inference provider passed to a preset that supports one                |
| `args`           |                             | `[]`               | Arguments added after the preset's                                     |
| `command`        | `ITSAPLAN_COMMAND`          | —                  | Your own command, instead of `agent`                                   |
| `cwd`            | `ITSAPLAN_CWD`              | where you start it | Working directory for the command                                      |
| `env`            |                             | `{}`               | Extra variables for the command                                        |
| `concurrency`    | `ITSAPLAN_CONCURRENCY`      | `1`                | Tasks at once, per agent. Queued runs and chat answers count apart     |
| `pollIntervalMs` | `ITSAPLAN_POLL_INTERVAL_MS` | `3000`             | Wait after an empty queue. Minimum 1000                                |
| `timeoutMs`      | `ITSAPLAN_TIMEOUT_MS`       | `1800000`          | Time before the runner stops a task                                    |
| `outputFormat`   | `ITSAPLAN_OUTPUT_FORMAT`    | the preset's       | How the runner reads a chat answer                                     |
| `models`         |                             | `[]`               | Models and reasoning levels available in the chat selector             |

A queued run of an issue in an area can name the area's folder (`workdir` in the claim). The
runner starts that run in the folder of that name below `cwd` when it exists, and in `cwd`
itself when it does not. A folder that resolves outside `cwd`, also through a symbolic link,
fails the run. Chat answers always start in `cwd`.

Set `agent` or `command`. With the environment you need no file at all:

```bash
export ITSAPLAN_API_KEY=…
npx -y @itsaplan/runner --agent claude
```

## Hermes runtime policy

For the `hermes` preset, configure a dedicated absolute `cwd` and expose an absolute
`HERMES_HOME` through `env` or the runner process environment. Before starting work and while
waiting for new work, the runner fetches the agent's revisioned policy from Plan. It materializes
`SOUL.md` under `HERMES_HOME` and linked skills under `HERMES_HOME/skills/plan-managed`. Memory
belongs to Hermes.

The runner records only paths and content hashes in a private manifest. It updates or removes only
files that still match that manifest. A byte-identical existing file can be adopted; a differing
unmanaged file, path traversal, or symlink makes the sync fail closed. Content and provider secrets
are not included in runtime status. Do not pass `--ignore-rules`: the runner rejects it because it
would stop Hermes from loading the Plan-managed policy.

With its status the runner reports what the agent can do: the toolsets and MCP servers of the
profile, its skills and its memory. Plan shows them read-only. The runner reads the skills under
`HERMES_HOME/skills` and `MEMORY.md` and `USER.md` under `HERMES_HOME/memories` again every
minute and after every run and chat answer, and reports them when they changed. It does not
parse `config.yaml`, so the toolsets and MCP servers come from the `hermes` field of the config,
filled in from the profile by whatever sets the runner up:

```json
"hermes": { "toolsets": ["browser", "file", "terminal", "web"], "mcpServers": ["itsaplan"] }
```

A toolset or an MCP server of the profile turned off for the agent in Plan is left out of
`--toolsets`, which then names everything else the profile enables and the agent's own MCP
servers. While nothing is turned off, Hermes uses the profile's own selection. Without the
`hermes` field no toolsets are reported and none can be turned off.

### MCP servers

The MCP servers enabled on the agent from the team's library, and the servers of `config.yaml`
turned off for it, are written to `HERMES_HOME/run/itsaplan-managed/config.yaml`. Every run and
chat answer starts Hermes with `HERMES_MANAGED_DIR` pointing at that directory, and Hermes merges
its `mcp_servers` over those of `config.yaml`; a server turned off gets `enabled: false`. The
agent's homes share one `config.yaml`, which the runner never writes, and a value Hermes read
from the managed directory cannot be changed from inside Hermes.

A value that names one of the team's secrets is written as `${ITSAPLAN_MCP_SECRET_<id>}`. Before
each run and chat answer the runner reads the values from `GET /agent-runtime/mcp-secrets` and
passes them to Hermes in those variables, so they are never written to disk. They are part of
the environment of the Hermes process for that run, which its tools inherit. A server named like
a toolset or a server of the profile fails the sync.
Every run and chat answer gets `--toolsets` with these toolsets and every MCP server. A toolset
turned off for the agent in Plan is left out, and so is `cronjob`, Hermes' own scheduler: Plan
schedules work through its routines, and a Hermes job would run it a second time. Without the
`hermes` field no toolsets are reported, none can be turned off, and Hermes uses the profile's
own selection.

## What the coding agent receives

### The task text

The server writes the task text. The text states what occurred, what to do, and to post
the result as a comment on the issue. Your own `command` receives the text on **stdin**. A
preset gives it to its CLI in the way that CLI accepts it: on stdin for `claude` and
`codex`, as an argument for `antigravity`, `copilot` and `opencode`.

The agent reads all other data through the MCP server at `$ITSAPLAN_URL/mcp`. The agent
sends `$ITSAPLAN_API_KEY` as a bearer token, and acts as its own user with its role.

### The environment

Every run holds these variables:

| Variable                 | What it holds                                                     |
| ------------------------ | ----------------------------------------------------------------- |
| `ITSAPLAN_URL`           | the instance that sent the task                                   |
| `ITSAPLAN_API_KEY`       | the agent's key, for the API and the MCP server                   |
| `ITSAPLAN_TRIGGER`       | `mention`, `delegation`, `field`, `schedule`, `manual`, or `chat` |
| `ITSAPLAN_SYSTEM_PROMPT` | the context of the run, for a command that takes a system prompt  |

A queued run adds three more:

| Variable            | What it holds                                                   |
| ------------------- | --------------------------------------------------------------- |
| `ITSAPLAN_RUN_ID`   | the run's id                                                    |
| `ITSAPLAN_ISSUE`    | the issue key, for example `MKT-42`. Empty if there is no issue |
| `ITSAPLAN_ISSUE_ID` | the numeric id of the issue. Empty if there is no issue         |

A chat message adds three others in their place, and `ITSAPLAN_TRIGGER` is `chat`:

| Variable              | What it holds                                                     |
| --------------------- | ----------------------------------------------------------------- |
| `ITSAPLAN_THREAD_ID`  | the conversation's id                                             |
| `ITSAPLAN_MESSAGE_ID` | the id of the message to answer                                   |
| `ITSAPLAN_SESSION_ID` | the coding agent's session to resume. Empty for the first message |

The task text of a chat message includes the conversation, unless a session holds it. See
Sessions below.

### The result

Exit code `0` is a success. Any other code is a failure. The end of stderr then becomes
the error. Stdout becomes the run's output in both cases.

## Chat

The runner streams the answer to the chat while the command runs. It reports the tool
calls with the answer. `outputFormat` tells the runner how to read the output:

- `text` — all the output is the answer.
- `claude-stream-json`, `codex-jsonl`, `opencode-json`, `antigravity-stream-json`,
  `copilot-json`, `hermes-stream-json` — the event stream of that CLI.

A preset sets `outputFormat` for you. Set it yourself only with your own `command`. If the
output does not agree with the format, the runner sends the output as plain text.

### Sessions

Each conversation resumes one session of the coding agent, which keeps its full context.
Without a session the server sends the last 20 messages of the conversation as plain text.

- The chat header shows the session id. Use the CLI's resume option in the runner's working
  directory to open the same session in your terminal.
- Your own `command` keeps no session. Each chat message then includes the conversation.
- A session stays on the machine that started it. If you delete its files or move the
  runner, the answers fail. Start a new chat then.

## Requirements

- **Node 20 or later.**
- **An It's a Plan instance 0.10.0 or later.** The chat needs 0.11.0. An older instance
  gives the runner only the queued runs.
- **An external agent in your project.** The runner authenticates with its API key.
- **The coding agent, installed and signed in on the same machine.** The runner starts the
  CLI as you, but it cannot sign in for you.

macOS and Linux need nothing else. The runner starts a preset directly, so its arguments
need no quotes. Your own `command` goes to `sh -c`, so write it as POSIX shell.

Windows needs WSL2, because `cmd.exe` and PowerShell have no `sh`:

```powershell
wsl --install     # installs Ubuntu, then reboot
```

Do everything else in WSL: Node, the coding agent, the config file, and the runner.

- Keep the working directory in the WSL file system (`~/work/repo`), not under
  `/mnt/c/...`. Access between the two file systems is slow.
- An instance on the Windows host is available at `http://localhost:3000`.

## License

Copyright © 2026 Andrii Poluosmak.

[Apache-2.0](LICENSE).
