# Hermes runner

Hermes is the default execution harness behind the global Home chat. Plan owns projects, tasks,
review state, agent configuration and chat history. The runner leases queued work and chat messages,
keeps leases alive, streams Hermes AG-UI events back to Plan and resumes the Hermes session attached
to a chat thread.

## Automatic first run

A fresh installation installs `volition-hermes-bootstrap.service` and its retry timer. Before an
owner exists, the bootstrap exits without creating application data. Once the first owner registers,
it creates exactly one owner-scoped external agent named `Home` (`master`), writes its one-time key
to the private host secret, starts and enables `volition-hermes-runner.service`, and disables the
retry timer. No project is created. The Home chat is team-scoped and therefore works before the first
project exists.

The API bootstrap endpoint listens on loopback with the rest of Plan and requires the independent
`plan_mastra_control_token`. The bearer is supplied to curl over stdin, and the returned agent key is
written directly to a mode `0600` temporary file before an atomic rename. Neither value is printed.

## Prompt and model ownership

Plan supplies the system prompt, agent instructions, task context, selected model and selected
reasoning level. Before claiming work, the runner reads Plan's revisioned runtime policy and
materializes its managed Markdown and linked skills into the dedicated Hermes workspace. A private
hash manifest limits updates and removals to files written by the runner. Hermes loads those files
normally. Hermes owns execution, provider authentication, tools, plugins, MCP servers and resumable
sessions.

Model and reasoning are separate chat settings. On every runner start,
`volition-hermes-catalog.py` reads the provider configured in the Hermes profile, asks Hermes for
that provider's account-scoped model catalog, and publishes only those models to Plan. Reasoning
levels come from Hermes per model. An account-gated model such as Astra therefore appears only
when the active provider and account expose it. With no configured provider, the catalog stays
empty rather than advertising unusable models. No model or reasoning flag is forced for “Agent
default”; Hermes then uses the authenticated profile's default.

Provider authentication is intentionally not copied into Plan. Catalog discovery may inspect an
existing local Codex CLI login without persisting it. Actual runs use Hermes' own provider credential
store; credentials are never embedded in the image or repository. Restarting
`volition-hermes-runner.service` refreshes the catalog after a provider or account change.

## Run limits

A queued run carries two limits that the runner passes to `hermes chat`: `--max-turns`
(tool-calling iterations, 1–200) and `--run-budget` (wall-clock seconds, 60–7200). An
agent-team stage takes them from the project's `agent-team` configuration; any other run
takes them from the agent's runtime policy (`maxTurns`, `runBudgetSeconds`). A limit that
is not set is not passed, so Hermes applies its own default. Chat answers have no limits.
`timeoutMs` in `itsaplan-runner.json` is still the hard stop of the runner, so it has to be
larger than the largest run budget.

## Secret boundary

The external-agent API key exists only at
`/home/pw/services/volition-stack/.secrets/itsaplan_home_master_agent_api_key`, mode `0600`.
Systemd exposes it to the wrapper through `LoadCredential=itsaplan_api_key`. The runner uses it in
Plan's `x-api-key` header, and Hermes resolves `${ITSAPLAN_API_KEY}` in the MCP header at runtime.
The runner JSON and Hermes YAML contain no key.

`hermes-config.fragment.yaml` is merged into
`/home/pw/services/volition-stack/data/hermes/config.yaml`. The MCP URL is loopback-only and
`strict_redirect_headers` prevents its authorization header from following a cross-origin redirect.

## Acceptance checks

- Home appears in the projectless Home chat and the runner reports online.
- A reply streams in order, including tool calls and results.
- A second message resumes the same Hermes session.
- Model and reasoning selections change the Hermes invocation independently.
- A delegated task is claimed once, heartbeated and completed or failed explicitly.
- A run canceled while Hermes executes it is stopped on the next heartbeat (at most 60
  seconds later), and the runner reports nothing for it.
- Stopping the unit terminates the active process group; an expired lease can be claimed again.
- The API key does not appear in JSON, YAML, argv, journal output or AG-UI events.

## Current contract limits

- Chat attachments reach Hermes as durable `[file: ... (attachment id: ...)]` markers in
  the claimed prompt. Hermes reads their content through Plan's scoped
  `read_chat_attachment` MCP tool; raw file bytes are deliberately not copied into the
  runner claim.
- Voice input is browser speech-to-text. Plan stores and sends only the resulting text,
  never microphone audio. Typed and dictated messages share the 32,000-character API
  limit; one composer message accepts at most 10 uploaded files, and each file also
  remains subject to the instance upload-size, MIME-type, and project-quota limits.
- One external Plan agent has one API key. Project-specific agents require their own scoped key.


## Project browser ownership

Each project runner entry receives `BROWSER_CDP_URL` only from its matching private browser runtime state. The URL is always `http://127.0.0.1:<project-port>` and connects Hermes' built-in browser toolset to the same persistent Chromium profile shown in Plan through noVNC. `DISPLAY` and `XAUTHORITY` refer to that same private project display; no CDP listener is published by Docker, the LAN, or Cloudflare.

After provisioning, operators can run `volition-hermes-browser-smoke.py <project-slug>` in the Hermes runtime. It navigates a fixed local data page through Hermes' real `browser_navigate` tool and prints only a bounded pass/fail result. Persistent cookies improve continuity and ordinary bot challenges, but this design does not promise CAPTCHA or anti-bot bypass and must respect each site's terms.
