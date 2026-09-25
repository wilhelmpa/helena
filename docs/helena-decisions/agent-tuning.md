# Agent tuning: skills, memory, self-learning and instructions of the Hermes agents

Audit and decision, 2026-09-25. The owner asked for this check (German, verbatim): "checke nochmal, dass alle Hermes-Agenten alle Skills haben und wissen, wo was liegt und optimal alles eingestellt ist: Memory, Auto-Skills (Hermes eben) und Instructions."

**Inputs.** The snapshot `~/agent-work/agent-tuning/snapshot` of 2026-09-25 22:34 (all `ai_agent` rows, skills and links, MCP links, memory revision counts; the global Hermes config and per profile the SOUL.md, the Helena-managed config and the skills folder listing; secrets masked). The live checkout at `0d5fd596`. Hermes 0.21.5 source at `/srv/volition/source/hermes` (`ccd074ee`). The snapshot has no `runtime_state`, so Hermes' own inventory (the skills it really loads, memory sizes, learned skills) is not in it. The script's report reads it live (§6).

**Deliverable.** `apps/api/src/scripts/agent-tuning.ts` takes the agents to the target in §4 through Helena's own services. It is a dry run by default. `apps/api/src/scripts/agent-tuning/target.ts` holds the target and `plan.ts` the pure planning. How to run it is in §6.

## 1. How Helena and Hermes handle each area

### Instructions and context
- **SOUL.md** is written by Helena for every Hermes home (`apps/api/src/modules/agents/runtime-policy/service.ts` `soul()`). It holds these parts, in order:
  1. the agent's own SOUL.md from its runtime policy, or a default identity line;
  2. `## Instructions` (the `ai_agent.instructions` column);
  3. the projects;
  4. per project `## Project scope: KEY`, with the project-wide instructions and "your assignment in this project" (`core/prompt/framing.ts:330`);
  5. areas, knowledge/vault, the agent team (Home and coordinators only), chat, blocked, Autopilot, "Your Hermes", charts, attachments.
- **Where project instructions come from:** `organization_project_assignment.instructions`, at most 4000 characters. The assignment is `project_member.description`, at most 500 characters (`runner/service.ts:120-121`, `organization/model.ts:78,82`).
- **Where they appear:** the Organisation settings of the project and of each agent. The same instructions go into the workspace's `PROJECT.json` (`organizationInstructions`).
- **How Hermes loads SOUL.md:** only from `$HERMES_HOME` (`agent/prompt_builder.py:1529-1570`).
- **How Hermes loads project context files:**
  - It loads exactly one kind: `.hermes.md`, then the `AGENTS.md` chain from the git root down to the cwd, then `CLAUDE.md` in the cwd (`prompt_builder.py:1596-1760`).
  - A run starts in its area folder. The project workspace is a git repo, so the workspace's `AGENTS.md` and the area's `AGENTS.md` are in every run's system prompt.
  - A repo cloned below the area folder (`homepage/homepage`, `dev/v1-cart-suite`) is not. Its `AGENTS.md` is added to a tool result only once the agent touches a path in it (`agent/subdirectory_hints.py:1-29`). The agents therefore have to be told to read it.
- **A continued session keeps its system prompt:** Hermes reuses the stored prompt of a session it continues (`agent/conversation_loop.py:770`). Changed instructions reach new chats and runs. An open chat thread keeps the old prompt until it is started anew.

### Skills
- **How Helena delivers skills:** a skill linked in Helena is written to `skills/plan-managed/plan-<id>/SKILL.md` (`agents/skills/service.ts:386`). Hermes finds it with the category `plan-managed`.
- **The skills index:** Hermes lists every skill in the system prompt, each description cut to 60 characters (`agent/skill_utils.py:763-775`). `skills.disabled` hides skills by name (`skill_utils.py:300-312`; Helena writes it from the runtime policy's `skillsDisabled`, `packages/runner/src/hermes-settings.ts:12`).
- **Skills bundled with Hermes:** Hermes copies them into a profile on `profile create` (not with `--clone`), on a gateway or TUI start, or on a CLI start whose `skills/` has no SKILL.md yet (`tools/skills_sync.py`, `hermes_cli/profile_cmd.py:240-247`, `hermes_cli/main.py:1688-1703`). Helena starts Hermes as a one-shot CLI and never syncs them itself. Which profiles have them depends on how each was first created and started, and today that differs by profile (§3).
- **Two skills with one name:** when two different skills share a name in the same skills root, `skill_view(name)` refuses both with "Ambiguous skill name" (`tools/skills_tool.py` `_locate_skill`). The index shows only the first one it scanned.

### Memory
- **Built-in memory:**
  - `memories/MEMORY.md`: agent notes, limit 2200 characters.
  - `memories/USER.md`: user profile, limit 1375 characters.
  - Both are loaded as a frozen snapshot at session start (`hermes_cli/config_defaults.py:1289-1303`, `tools/memory_tool_store.py:86-164`).
  - Once a file is full, an `add` fails and the model is told to merge or remove entries.
  - No external memory provider is configured (`memory.provider` is empty = built-in).
- **What Helena changes** (`packages/runner/src/learning.ts:49-60`, `runtime-policy/service.ts:125-133`):
  - Memory is on while learning is on (default on).
  - The agent's memory writes wait for the owner as proposals by default (`memoryApproval`).
  - The runner keeps each file at its approved version until the owner decides.

### Self-learning ("Auto-Skills")
- **Hermes' own mechanism** is the background review. After a turn it forks an agent that may write memory and skills (`agent/background_review.py`). It is triggered by `memory.nudge_interval` (10) and `skills.creation_nudge_interval` (10).
- **Helena turns that review off** (`auxiliary.background_review.enabled: false`, `learning.ts:52`). Helena starts a one-shot Hermes process per run or chat answer, and that process ends before the review's thread does.
- **Helena's replacement is the reflection** (`agents/runner/reflection.ts`):
  - A follow-up turn in the run's session, with only the memory and skills toolsets.
  - It runs after a failed run, after rework, or ("complex", the default) after a run with at least 10 tool calls.
  - Skills written there land in the profile as the agent's own. Helena lists them under "learned skills" to take over, pin or discard.
  - `skills.write_approval` is `false` while learning is on, so skill writes are not staged.
- **The curator is off by default** (`runtime-policy/service.ts:127`; the runner pauses it through `skills/.curator_state`, `packages/runner/src/policy.ts:457`).
  - Hermes' curator only manages skills marked `created_by: agent`, and only the background fork marks skills that way (`tools/skill_manager_tool.py:753-766`, `tools/skill_usage.py:229-284`).
  - A skill created in a reflection is a normal turn's skill, which the curator never archives.
  - With the background review off, the curator has nothing to do. **Keep it off.**

## 2. Findings per agent (state of the snapshot)

All eight Hermes agents share these settings:
- **Model:** none of their own, so the global Hermes default applies: `openai-codex` / `gpt-5.6-luna`, reasoning `low`.
- **Learning:** the defaults: learning on, reflection `complex`, curator off, memory approval on.
- **MCP servers:** Helena's `itsaplan` server.
- **Toolsets denied:** none. Every agent can therefore reach `computer_use`, `image_gen` and `tts`, which have no desktop or provider on this server.

| Agent | Profile | Helena skills linked | Bundled Hermes skills in profile | Extra MCP | Instructions | Problems |
|---|---|---|---|---|---|---|
| Home `@master` #1 | home | **0** | yes | projekt-browser | German, 235 chars, still says "in Plan", umlauts written as ue/oe; its own SOUL.md is Hermes' stock "You are Hermes Agent, built by Nous Research …" | no skills; identity is Hermes, not Home; no pointer to where things are |
| `@hermes-priv-coordinator` #4 | priv | **0** | yes | projekt-browser | English generic text, 223 chars | no skills (the pool's `org` section, approved 2026-09-24, was never run); MEMORY.md 240 chars (11 %) |
| `@hermes-fam-coordinator` #5 | fam | **0** | **no** | projekt-browser | English generic text | no skills; no bundled skills either (no docx/pdf/xlsx) |
| `@hermes-vol-coordinator` #6 | vol | **0** | yes | projekt-browser | English generic text | no skills; its team list names the test agents `@claude-test` and `@codex-test` as specialists |
| `@hermes-verve-coordinator` #7 | verve | **0** | yes | projekt-browser | English generic text | no skills; marketing and support have no specialist |
| `@coder-vol` #10 | vol_10 | 20 (pool "coder" + approved additions) | yes | — | template "coder" text | **three name clashes** with bundled Hermes skills: `requesting-code-review`, `systematic-debugging`, `test-driven-development`. `skill_view` refuses all three by name. The superpowers `brainstorming` "HARD-GATE" (wait for the human partner's approval) contradicts autonomous runs. |
| `@coder-verve` #11 | verve_11 | 20 (with shopify-expert) | **no** | shopify-dev (`npx -y @shopify/dev-mcp@latest`, unpinned, env without the repo's `POLARIS_UNIFIED`/`LIQUID`) | template "coder" text | brainstorming conflict as above |
| `@content-vol` #12 | vol_12 | 10 (pool "content") | **no** | — | template "content" text | fine apart from the missing project context |
| `@claude-test` #32, `@codex-test` #33 | Claude Code / Codex | 0 | — | — | test text | not Hermes (out of scope). They sit in VOL as specialists with both triggers off, so a delegation to them would wait forever. |

Across all agents:
- **Nobody knows where things are.** The project-wide instructions of all four projects are empty (the workspace `PROJECT.json` has `"organizationInstructions": ""`). No SOUL.md has a `## Project scope` section.
  - What agents do see is the area list, the vault paths and the stale workspace `AGENTS.md` (§3).
  - Nothing names the repos, the deploy paths, the Google account of the project or what the Cloudflare credentials are for.
- **Specialists get no team context.** `structureSection` returns an empty string for anything but Home and coordinators (`runtime-policy/structure.ts:130`). The specialists never read who their coordinator is.
- **Templates and copies:**
  - 17 pool templates, with no copy of any of them.
  - `@coder-vol`, `@coder-verve` and `@content-vol` predate copies (`source_template_id` null). They follow no template; their instructions and skills equal the templates' except for the approved additions.
  - The pool's `copies` list (content→VERVE, qa→VOL/VERVE, assistant→FAM/PRIV, finance→PRIV/VOL, researcher→VOL; `deployment/volition-stack/scripts/setup-agent-pool.ops.ts:53`) was never run. Neither was `org` (coordinator skills and the family department, `:65`). The live-run log of 2026-09-24 shows only the sections skills, templates and report.
- **Learning has not happened yet:**
  - `runtime_learned_skills` is empty for all agents.
  - `USER.md` exists nowhere. Only PRIV has a `MEMORY.md`.
  - Reflections run only after runs, so a chat with the owner, where his preferences are said, never becomes memory or a skill (§5).
- **Unused library skill:** `helena-proof` (a test marker) is linked to no agent.

## 3. Broken or stale things outside the agent rows (not changed by the script)

These are code or unit changes for the orchestrator, not configuration:

1. **The workspace `AGENTS.md` is stale and is in every run's system prompt.**
   - It is `deployment/volition-stack/integration/project-context.mjs:8-9`: "Use linked Plan documents …", "For browser_exec on the configured project CDP browser, set session="project" …".
   - `browser_exec` no longer exists. The browser is the "Projekt-Browser" gateway.
   - The area `AGENTS.md` still says "in Plan" (`areas.mjs:62,65`).
   - Fix: new guidance text (Helena naming, no browser_exec, "the project instructions in your SOUL.md name repos and deploy paths"), plus a replacement step for files that carry the old text. The code only replaces `OLD_STORAGE_GUIDANCE`.
2. **`PROJECT.json` links point to `http://kingston-server.local/…`**, which no longer answers since go-live. The cause is `PLAN_PUBLIC_URL=http://kingston-server.local/` in `native/systemd/volition-provisioning.service:40`. It should be `https://helena.volition.one/`; the provisioning job then rewrites the file.
3. **Bundled Hermes skills differ by profile.** fam, verve_11 and vol_12 have none, the other five have all of them (§1). Two ways to fix it, each a runner step:
   - Have the materializer seed them the same way everywhere (Hermes' `tools/skills_sync.py`).
   - Mark every profile `.no-bundled-skills`.

   The recommendation is to seed them: the Hermes-adapted `docx`, `pdf`, `xlsx`, `powerpoint`, debugging and `hermes-agent-skill-authoring` skills are useful. After seeding, run the script again, because it removes the name clashes it then finds.
4. **Specialists have no team section.** A `specialistSection` in `runtime-policy/structure.ts` would name the coordinator and the project's other specialists. Until then, the script writes this into each specialist's assignment (§4).
5. **The shopify-dev MCP entry:**
   - `@latest` is unpinned: a download at every start, and a supply-chain risk.
   - The env lacks the `POLARIS_UNIFIED=true`/`LIQUID=true` of the repo's `.mcp.json` (a May 2026 copy).
   - Pin a version and add the env once the repo clone on hub/agent-env has landed and its `.mcp.json` is confirmed.
   - Also check once, in the agent's runtime status, that `npx` can fetch under agent isolation.
6. **Compression:**
   - Hermes compresses at 75 % of the model window for models under 512k (`agent/context_compressor.py` `_SMALL_CTX_THRESHOLD_PERCENT`). The trigger is capped by `compression.threshold_tokens` (256000, `config_defaults.py:553-674`) and by the summarising model's window once Hermes has probed it (`_apply_threshold_tokens_cap`). Here that model is the local Qwen3.6 with 131k, while local AI is on.
   - A long chat thread therefore resends 100k–250k tokens every turn; the PRIV answer of 2026-09-24 read 395k.
   - A Helena setting for `compression.threshold_tokens` (for example 100k) would be a profile contribution. It is not in the runtime policy today.
7. **Helena's MCP server `instructions`** still say "Itsaplan is a project tracker" and "Do not commit anything yourself" (`apps/api/src/mcp/instructions.ts:9`). Hermes ignores MCP server instructions, but Claude Code and Codex agents read them.

## 4. Target and why

### Skills (added; nothing an owner added is removed)
- **Home:** brainstorming, writing-plans, ziele-in-aufgaben-zerlegen, recherche-bericht, assistenz-mail-und-termine, verification-before-completion. Home plans with the owner in chat, breaks goals into Helena tasks, researches, and handles mail and calendar questions across the projects.
- **All coordinators:** brainstorming, writing-plans, ziele-in-aufgaben-zerlegen, dispatching-parallel-agents, verification-before-completion. This is the pool's approved `COORDINATOR_SKILLS`, plus the Helena-specific task breakdown.
  - **VOL and VERVE** add requesting-code-review, receiving-code-review and recherche-bericht, and VERVE also copywriting (it does marketing itself until a content copy exists).
  - **PRIV and FAM** get assistenz-mail-und-termine and recherche-bericht instead of the code review skills. They have no code and no specialists, so the coordinator does the assistant work itself.
- **`@coder-vol`:** + frontend-design (website UI).
- **The name clash rule:**
  - A Helena skill whose name a bundled Hermes skill already has in the profile is not linked, and an existing link is removed. The Hermes-adapted copy then serves, and `skill_view` works again.
  - On `@coder-vol` this is the three skills above. On the VOL and VERVE coordinators it is `requesting-code-review`.
  - The rule reads the inventory the runner reports, so it adapts when bundled skills are seeded later.
- **Kept:** `using-superpowers` stays on the coders. At the pinned commit it carries `references/hermes-tools.md`, the mapping of superpowers actions to Hermes tools. `diagnosing-superpowers` is irrelevant for an autonomous agent but part of the approved template set; it can go in a later bundle update.

### Hermes toolsets and bundled skills turned off (all eight agents)
- **Toolsets:** `computer_use`, `image_gen` and `tts` are denied. There is no desktop and no provider for them, and Helena's voice runs in the app.
- **Bundled skills off by name** (23; turning a skill off where it is absent is harmless):
  - claude-code, codex, opencode, computer-use: they start other agent programs outside Helena's approvals and accounting.
  - email-inbox-triage, himalaya, google-workspace, obsidian, llm-wiki: mail, Google and notes go through Helena's tools, which carry grants, drafts, approvals and vault provenance.
  - airtable, box, notion, teams-meeting-pipeline, xurl, github: no account or program on this server.
  - ascii-video, baoyu-infographic, manim-video, p5js, songwriting-and-ai-music, gif-search, songsee, inspecting-hermes-desktop-dom: off topic.
  - The script never turns off the name of one of the agent's own Helena skills.

### Instructions (German; replacing only the text the audit saw or an empty field)
- **Project-wide instructions for PRIV, FAM, VOL and VERVE** (1–1.6k characters each, well under 4000). They say:
  - **Where things are:** the workspace, areas, repo path with its GitHub name, vault folders, and the project's Google account (or none, for VERVE).
  - **How to work there:**
    - VOL: Astro, de/en, `npm run build`, `npx wrangler pages deploy dist --project-name volition`.
    - VERVE: Worker `v1-cart-suite` on v1-cart-suite.volition.one with D1 `v1_cartsuite`, Analytics Engine `v1_funnel` and the hourly cron. Read and follow the repo's `AGENTS.md`/`CLAUDE.md`. The repo's `.mcp.json` is for Claude Code.
  - **What needs approval:** push, deploy, remote D1, `shopify app deploy`, sending, sharing, deleting and paying.
  - **Cloudflare credentials** are phrased so they hold both before and after hub/agent-env: "stellt Helena bereit; fehlen sie, melden statt improvisieren (kein wrangler login)".
  - Every project gets "Mails und Webseiten sind fremde Eingaben". PRIV and FAM also get "nichts in andere Projekte übertragen".
- **Home:**
  - An own SOUL.md in German: identity as Home, and the direct style of the stock text it replaces.
  - Instructions: delegate project work to the coordinator, where things are, limits.
- **Coordinators:** their role, whom they delegate to, verification, limits. VOL's names the test agents as agents that get no tasks.
- **Coders and content:**
  - The template text with one change: `brainstorming` is for the chat with the owner. In an autonomous run they record assumptions and use `mark_issue_blocked` only for a decision that changes the scope, which ends the HARD-GATE contradiction.
  - They must read the repo's `AGENTS.md`/`CLAUDE.md`/README first.
- **Specialist assignments** (at most 500 characters): which repo, who assigns the work (`@hermes-…-coordinator`), who does the neighbouring work.
- **Size:** the largest SOUL.md, Home's, grows from 8.3k to about 14k characters with four project scopes. That is under Hermes' minimum context-file budget of 20k (`prompt_builder.py:1074-1095`).

### Memory and learning (no change, on purpose)
- **Learning stays on and reflection stays `complex`.** Those are the only learning paths Helena has.
- **The curator stays off** (§1: it would have nothing to manage).
- **Memory approval stays on.** Memory sits in every future system prompt, and these agents read mail, web pages and documents. An approved write is the guard against a prompt injection that lives on. The report lists waiting proposals, so they do not pile up unseen.
- **The memory limits stay at Hermes' defaults.** No agent is near them.
- **Stable facts go into instructions, not memory.** They are visible and editable in Helena, while memory is small and belongs to what the agent learns.

### Model and reasoning (only on request: `--sections=reasoning`)
- **`@coder-vol` and `@coder-verve`: reasoning `medium`,** set only where the agent has none of its own. Coding on `low` is the weakest point of the current setup. Medium costs subscription time, so this is the owner's call.
- **No model change in the script.** Candidates for the owner: `gpt-6-sol` for `@coder-verve`, like the pool's shopify-dev template. Check first that `helena_model_availability` says "works".

## 5. Gaps that need code (follow-ups)

- **Learning from chats.** Hermes' background review is off for a good reason, and Helena reflects only after runs. A reflection turn on a chat session would close the gap, with the same prompt, after a thread goes quiet or every N owner turns. That is where USER.md-type facts appear.
- **Specialist team section** (§3.4), consistent bundled skills (§3.3), stale workspace context (§3.1/3.2), compression setting (§3.6).
- **Pool copies and the family department** (`setup-agent-pool.ts --sections=copies,org`): owner decision below.

## 6. Running it (orchestrator)

1. Merge `hub/agent-tuning` into the live checkout. It only changes files under `apps/api/src/scripts/` and `deployment/volition-stack/scripts/`; no migration, no restart. A deploy is not needed to run the script.
2. In-flight check first: `agent_run` pending with `started_at` = 0, streaming `agent_chat_message` = 0. A new revision makes each runner rewrite its profile before the next run.
3. Dry run (writes nothing; prints the plan with every text in full, then the report):

   ```sh
   ssh helena-ops@kingston-server.local 'sudo systemd-run --wait --pipe --collect --uid=volition-plan \
     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan/apps/api \
     /usr/local/bin/bun src/scripts/agent-tuning.ts'
   ```

4. Apply the default sections (skills, tools, instructions, projects), with the same command and `--apply` added.
   - `--sections=…` picks sections; the ones outside the default set are `copies`, `browser` and `reasoning` (§8).
   - `--agent <username>` (repeatable) limits the run to some agents and leaves the project instructions alone.
5. Check the result:
   - Run it again; it must say "Would apply 0 change(s)".
   - Each agent's runtime status shows the new revision applied, with no drift.
   - Start a new chat with `@hermes-vol-coordinator` and ask where the website repo is and how it is deployed. Open chat threads keep their old system prompt.

**Safety.** It writes only through Helena's own services, the ones the editor uses: `updateAgent`, `setAgentSkills`, `setAgentMcpServers`, `copyTemplateIntoProject`, `createDepartment`, `setAgentAssignment`, `setAgentProjectInstructions` and `setProjectAssignment`. It never touches a file of a Hermes home (the `config.yaml` there is a symlink). A text replaces only an empty field or a text the audit saw or this tuning wrote (SHA-256 in `target.ts`); anything else is reported as "left as it is". Only running Hermes agents are tuned, plus the pool templates their copies come from; no Claude Code or Codex agent is touched.

## 7. Not verified here
- **What Hermes loads live** (inventory, drift, memory sizes, pending memory proposals, reflections): the snapshot had no `runtime_state`. The script's report prints it.
- **Whether `npx @shopify/dev-mcp` starts under isolation,** and whether Hermes' own `browser` toolset (agent-browser via npx) works for the specialists that have no project browser.
- **The GitHub versions of the two repos:** the texts rely on the task's facts and on a May/August 2026 local copy. Once hub/agent-env has cloned them, compare their `AGENTS.md`/`CLAUDE.md` with the project instructions.
- **The agents' current project assignments** (`project_member.description`): not in the snapshot. The script only fills empty ones and reports the rest.

## 8. Second pass (owner, 2026-09-25 23:25–23:45): copies, VERVE organisation, browser, models

**Owner's decisions:**
- Create the approved pool copies. VOL/FAM/PRIV: QA→VOL, assistant→FAM and PRIV, finance→PRIV and VOL, researcher→VOL.
- VERVE gets a whole organisation by area ("Leg für Verve eine ganze Orga gemäß der Area-Bereiche an"). This replaces the earlier VERVE copies.
- The project browser for the specialists.
- `@coder-vol` and `@coder-verve` get reasoning `medium`; `@coder-verve` also gets model `gpt-6-sol`.
- Memory approval stays on. The test agents stay (the owner deletes them himself).

**Where the decisions live.** The approved copy list is now in one place, `deployment/volition-stack/scripts/setup-agent-pool.copies.ts` (`POOL_COPIES`, plus `POOL_COORDINATOR_SKILLS`). Both `setup-agent-pool.ops.ts` (HTTP) and the tuning (services) use it.

### Sections (none of them in the default set)
- **`copies`:**
  - **Departments:** creates the missing departments below their parent: "Verve · Entwicklung", "Verve · Marketing" and "Verve · Support" under "Volition".
  - **Templates first:** before any copy is made, the tools section gives each copied template the three denied toolsets, so a copy starts with them and keeps following its template. Otherwise a direct change would mark the copy's `approvals` group as overridden.
  - **Copies:** each missing copy is created with `copyTemplateIntoProject`, exactly what Agent → "In Projekt kopieren" does.
    - It gets the template's skills, MCP servers, model (the runtime default if the provider refused it), reasoning, triggers, Autopilot level and budgets.
    - It becomes a specialist reporting to the project's coordinator.
    - Provisioning issues its key and runtime by itself.
  - **After the copies,** the rest is planned again with their real ids. The dry run already plans a copy as if it existed (`projectState`), so it shows everything the copy will get.
  - **What else the section sets:**
    - Both triggers on, where they are off.
    - A copy's display name, while it is still "<template name> <KEY>".
    - Department, agent-team role and manager. Each is set only where it is empty, or the role is still the default `specialist`.
- **`browser`:** links "Projekt-Browser" through `setAgentMcpServers`, as Agent → Tools does, for `@coder-vol`, `@coder-verve`, `@content-vol` and every copy.
  - For a copy this marks the `mcpServers` group as its own; nothing else of it stops following the template.
  - An agent with "Hermes-eigener Browser (alt)" is left alone.
  - Form fills and submits on other sites stay approval-gated by the policy engine.
- **`reasoning`:** the model and the reasoning effort, set only where the agent has none of its own. A model the provider refused (`helena_model_availability`) is skipped.
  - The model id is the catalog id `gpt-6-sol`, as the pool templates and the Hermes catalog write it (`volition-hermes-catalog.py`).
  - The runner routes it to the provider from its catalog (`packages/runner/src/execute.ts` `modelProvider`). `model_check` compares without the provider prefix (`runtime-sync/model-check.ts` `sameModel`).

### Coordinator instructions follow the team
Each coordinator's instructions are a team text:
- **Rendering:** it is rendered from those of the project's known specialists that exist, counting a copy the same run creates. For VERVE the list is grouped by area, with the area's folder.
- **Replacing:** any text it could have rendered for another set of them may be replaced, and so may the audited text and the first tuning's text. A coordinator whose instructions the owner edited is left alone.

### The VERVE team (all report to `@hermes-verve-coordinator`)

| Area / department | Agent | Template | Model (template) | Notes |
|---|---|---|---|---|
| Entwicklung (`dev/`) | `@coder-verve` | — (exists) | gpt-6-sol · medium | department set |
| | `@shopify-dev-verve` "Shopify-Entwickler VERVE" | shopify-dev | gpt-6-sol · medium | Shopify Dev MCP from the template |
| | `@qa-verve` | qa | gpt-5.6-terra · medium | |
| | `@devops-verve` | devops | gpt-6-sol · high | deploys and remote D1 only as an approved change plan |
| | `@code-reviewer-verve` | code-reviewer | claude-opus-5 · high | agent-team role `reviewer` |
| Marketing (`marketing/`) | `@content-verve` | content | default | the assignment says: app texts, not the Astro site |
| | `@market-analyst-verve` | market-analyst | claude-sonnet-5 · medium | the template is about securities; the assignment narrows it to the app's market |
| | `@designer-verve` | designer | claude-sonnet-5 · high | |
| Support (`support/`) | `@assistant-verve` "Support VERVE" | assistant | claude-sonnet-5 · low | own merchant-support instructions (24 h, drafts with approval, bugs → Dev) |
| | `@tech-writer-verve` | tech-writer | claude-sonnet-5 · medium | |

Each assignment names:
- the area and the folder its runs start in (`/srv/volition/workspaces/projects/verve/<area>/`);
- the repo `dev/v1-cart-suite` where relevant;
- the coordinator;
- the VERVE goals it serves: #5 Phase 0, #6 D1 migration, #7 post-purchase launch, #8 support within 24 h.

Things to know:
- Ten of the fifteen copies run on Claude models through Hermes' Anthropic login: researcher-vol, the three assistants, both finance copies, code-reviewer, market-analyst, designer and tech-writer. If that login is dead, their first runs fail and the model is recorded as refused.
- The market-analyst and content templates were written for other jobs (securities, the Astro website). Their skills come along (trading, Astro/SEO). A VERVE-specific template or a skills override is a later cleanup.

### Commands (orchestrator)
Same command as §6, with the sections added:

```sh
# dry run of everything, including copies, departments, browser and models
… /usr/local/bin/bun src/scripts/agent-tuning.ts --sections=skills,tools,instructions,projects,copies,browser,reasoning,report
# apply
… /usr/local/bin/bun src/scripts/agent-tuning.ts --sections=skills,tools,instructions,projects,copies,browser,reasoning,report --apply
```

Checking afterwards:
- A second dry run must show 0 changes. The exception: once the new copies' runners have reported their inventory, a copy whose profile has bundled Hermes skills with the same names as its Helena skills gets those links removed (the clash rule). Run the apply once more in that case.
- The 15 new agents come online by themselves through provisioning. Check them in the report's `runner` status after a few minutes.

