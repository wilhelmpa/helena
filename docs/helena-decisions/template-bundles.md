# Template bundles: agent templates and skills as files

Decision, 2026-09-24. Extension point "Vorlagen und Pakete" (docs `volition-helena-oss.md` §3a): agent templates and skill packs are imported into and exported from Helena as files. The bundle format is new. The skill format and the agent-file keys follow what agent tools already share.

## What a bundle has to carry

- **Agent templates:** instructions, model and reasoning effort, run limits, and the Hermes toolsets a template denies. Two things only Helena has: the role title and capabilities used for routing, and the run triggers.
- **Skills:** pinned GitHub folders (Helena imports SKILL.md and Markdown only), or files carried in the bundle.
- **MCP servers** the templates need.
- **Metadata:** name, version, license, and the attribution each borrowed skill requires.
- **No secrets, ids, projects or people**, so a bundle can be shared as it is.

## Options compared

| Option | What it is | Maturity, license | Fit |
|---|---|---|---|
| **Agent Skills** (SKILL.md folder, agentskills.io) | Open skill format from Anthropic, read by Claude Code, Codex, Copilot and Hermes | Widely adopted, open spec | **Adopted for skills.** Helena's skill library already stores exactly this. |
| **Claude Code subagent file** (`agents/<name>.md`: YAML frontmatter + Markdown body as the system prompt; keys `name`, `description`, `model`, `effort`, `maxTurns`, `tools`/`disallowedTools`, `skills`, `mcpServers`) | De facto agent file | Very widely used; the same shape as GitHub Copilot custom agents (`*.agent.md`: `name`, `description`, `tools`, `model`, `mcp-servers`) and OpenCode agents | **Adopted for agent templates.** Same keys where the meaning matches. Helena-only fields sit under one `helena` key. |
| **Claude Code plugin layout** (`plugin.json` manifest, `agents/`, `skills/`, `.mcp.json`) | Package of agents, skills and MCP config | Widely used | **Adopted as the directory layout.** The manifest is `helena.bundle.json`, with the plugin manifest's keys: `name`, `displayName`, `version`, `description`, `license`, `author`. |
| **`.mcp.json`** (`{ "mcpServers": { … } }`) | MCP client configuration | The common config shape of MCP clients | **Adopted for MCP servers.** Without `env`/`headers` in version 1, because that is where credentials live. |
| **Open Agent Specification** (Oracle, YAML/JSON agents and flows) | Framework-agnostic declarative agents and workflows | Apache-2.0/UPL, young, one main backer | Rejected for templates: it models LLM configs, tools and flows at runtime level. Helena's template is a *team member* (role, routing, triggers, approvals) run by Hermes. Worth another look for workflow templates. |
| **AGNTCY OASF** (agent records, skill taxonomy) | Directory records for discovering agents | Apache-2.0, early | Rejected: it describes deployed agents for a directory, not templates to instantiate. |
| **A2A Agent Card** | JSON card of a remote agent's endpoint and skills | Apache-2.0, Linux Foundation | Rejected: it is for calling running agents over the network, not for templates. |
| **CrewAI `agents.yaml`** (role, goal, backstory) | Framework config | MIT, CrewAI only | Rejected: tied to one framework. Nothing to gain over the agent file. |

## Decision

A bundle is a directory laid out like a Claude Code plugin:

```text
helena.bundle.json      format, formatVersion, name, displayName, version, description,
                        license, author, and the skills that come from GitHub (pinned
                        URL, license, attribution)
agents/<name>.md        one template: frontmatter + instructions as the body
skills/<name>/SKILL.md  a skill carried as files (Agent Skills), with refs/<file>.md
.mcp.json               { "mcpServers": { "<name>": { "type", "command", "args" | "url",
                        "description" } } }
```

It also has a one-document JSON form, the `TemplateBundle`, with the same content. That form is for upload, download and the browser.

Agent frontmatter: `name` (the handle), `description`, `model`, `effort`, `maxTurns`, `disallowedTools` (Hermes toolset names), `skills` and `mcpServers` follow the agent-file keys. Under `helena:` sit `displayName`, `roleTitle`, `capabilities`, `runBudgetSeconds` and `triggers`. A tool that only knows agent files can still read the name, description, model, skills and prompt.

The code is a thin layer:
- `scripts/helena-bundle.ts`: types, validation, no I/O. This is the draft for `@helena/sdk`.
- `scripts/helena-bundle-files.ts`: directory form ↔ bundle.
- `scripts/helena-bundle-sync.ts`: import and export over Helena's HTTP API.

Import is idempotent. Differences are reported as drift and written only on request. Skills and MCP servers are added to agents, never removed. The first bundle is `bundles/agent-pool`, Helena's agent pool.

## Rules a bundle keeps

- Skill licenses fit AGPL-3.0 (MIT, Apache-2.0, BSD, ISC, MPL-2.0, CC-BY-4.0, CC0). Each borrowed skill names its attribution.
- GitHub skills are pinned to a commit. Helena never imports a skill's scripts.
- Capabilities are unique across a bundle's agents, because a workflow role matched by capability needs exactly one agent per project.
- No `env`/`headers` in MCP servers. No ids, keys, projects or people.

## Handover to hub/framework

- Move the types into `@helena/sdk` and generate a JSON Schema from them with the SDK's schema library (TypeBox, as used by the API, or Standard Schema).
- Give the importer and exporter an API endpoint and a place in the UI: Agentenpool → "Vorlagen importieren/exportieren", and Skills → "Paket importieren". Until then `deployment/volition-stack/scripts/setup-agent-pool.ts` runs them with an API key or a signed-in browser tab.
- A later version may allow MCP `env`/`headers` that point to a secret *by name*, which the importer maps to a team secret.

## Sources

- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [GitHub Copilot custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [Open Agent Specification](https://github.com/oracle/agent-spec)
- [Agent Skills](https://agentskills.io)
