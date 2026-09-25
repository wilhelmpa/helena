# Agent context: what agents know, learn and send

Decision and build record of `hub/agent-context`, 2026-09-25/26. It builds the "Needs code" list of the agent audit (`docs/helena-decisions/agent-tuning.md` §3, §5) and, on the owner's decision of 2026-09-25 ("Ziele wirksam machen — ja, bauen"), makes the organization goals effective for agents. Hermes citations are to `/srv/volition/source/hermes` at `ccd074ee` (Hermes 0.21.5).

**What changes for the owner, in short**
- Agents find their project workspace described correctly (Helena, the project browser tools, the repositories' own `AGENTS.md`), and every link they are given points at `https://helena.volition.one`.
- A specialist knows its coordinator and how to hand work back.
- Every Hermes profile carries the skills that ship with Hermes, and a name two skills share is shown on the agent page instead of Hermes silently loading neither.
- Agents learn from chats, not only from runs; memory still waits for the owner.
- A long chat no longer resends 100k–250k tokens with every call: Hermes compresses from 100 000 tokens (adjustable per agent and for the instance).
- Goals reach the agents: in their context, through four MCP tools, as a link on tasks, and on the goal pages with progress, workers and status proposals.
- Helena's MCP server tells Claude Code and Codex the truth about Helena (no "Itsaplan", no "never commit").

## 1. Workspace context (audit §3.1, §3.2)

**Problem.** The workspace `AGENTS.md`, which Hermes loads into every run's system prompt (`agent/prompt_builder.py` AGENTS.md chain), still said `browser_exec` and "Plan". `PROJECT.json` linked to `http://kingston-server.local`, set as `PLAN_PUBLIC_URL` in the provisioning unit. And its `organizationInstructions` was always empty: the coordinator bootstrap answered `projectInstructions: ''` whatever the project held.

**Decision.**
- **The public origin comes from Helena, per request.** The worker, which has `APP_URL`, sends its first entry as `publicUrl` in every provisioning envelope (`apps/worker/src/project-provisioning.ts`, `@repo/net primaryOrigin()`). The provisioning resolves its service addresses against it (`integration/config.mjs withPublicOrigin`). The unit names only paths now (`/code/`, `/focus/terminal-project/`, `/browser/`) and no host at all, so the next move of the origin needs no unit edit. `PLAN_PUBLIC_URL` stays as a fallback for a Helena that sends no origin.
  - Rejected: `EnvironmentFile=/etc/volition/plan.env` for the provisioning unit (it would hand the API's secrets to a second service); `switch_origin.py` writing a drop-in (a second copy of the same value, the thing the task said to avoid).
- **Helena's text sits between markers and is renewed.** `<!-- helena:project-context -->` … `<!-- /helena:project-context -->` in the workspace `AGENTS.md` (`integration/project-context.mjs`), `<!-- helena:area-context -->` … in each area's `AGENTS.md` (`integration/areas.mjs`). Each provisioning writes the block as Helena would write it now. Everything outside the markers is left exactly as it is.
  - The old block (the marker `<!-- volition-project-context -->` and one paragraph) is replaced when the paragraph is still Helena's (it starts "Read PROJECT.json before project work."). A paragraph someone rewrote stays below the new block.
  - An area file that is exactly the old generated text (for any names) is replaced whole. Anything else is the owner's or an agent's and stays.
  - Files are changed in place (never replaced), so they keep the owner and ACL agent isolation gave them.
- **PROJECT.json carries the project-wide instructions** (Organisation → project), `links.helena` next to the old `links.plan`, all on the public origin. Changing the project-wide instructions queues the project's provisioning again (`modules/organization/service.ts setProjectAssignment` → `modules/projects/provisioning-queue.ts`).
- **One-time refresh:** `apps/api/src/scripts/refresh-project-context.ts` queues every project's provisioning once (dry run by default).
- **The new text** names Helena, the MCP tools for tasks, goals, notes and approvals, the project browser tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_login`), that a repository in an area folder has its own `AGENTS.md`/`CLAUDE.md`/README to read first (Hermes only adds a subdirectory's `AGENTS.md` once a tool touches it, `agent/subdirectory_hints.py`), and that mails and pages are data.

**Found on the way and fixed.** Mails, pushes and the Git link-back comments built their links on the whole `APP_URL`. Since go-live that is a comma-separated list, so a mail link read `https://helena.volition.one,https://helena-home.volition.one/project/…`. They use `primaryOrigin()` now (`modules/notifications/outbound.ts`, `modules/git/handler.ts`).

## 2. The team section for specialists (audit §3.4)

`structureSection` (`modules/agents/runtime-policy/structure.ts`) now gives every agent in a reporting chain a `## Agent team` section, not only Home and the coordinators. `memberSection` names:
- the agent's role (specialist or reviewer) and whom it reports to: its manager in the organization chart, else the project's coordinators;
- the team's other specialists and reviewers with their capabilities, and that work fitting one of them goes back to the coordinator rather than being handed over;
- how to hand work back: in an agent-team stage exactly the stage's JSON, without touching the task's status (the engine owns it, `engine/builtin/steps/agent-team-contract.ts`); on a direct task a short `add_comment` report, then the completed state or the project's review column; tag the coordinator only when they have to act; `request_approval` before anything with effects outside Helena; `mark_issue_blocked` for a decision only a person can make.

An agent that is in no team and under nobody gets nothing, as before.

## 3. Skills that ship with Hermes (audit §3.3)

**Problem.** Hermes seeds its bundled skills on `profile create`, a gateway or TUI start, or a CLI start into an empty `skills/` (`tools/skills_sync.py`, `hermes_cli/main.py`). Helena starts one-shot runs, so profiles differed: fam, verve_11 and vol_12 had none.

**Decision: Helena runs Hermes' own sync, the same way for every profile.**
- The runner calls `tools.skills_sync.sync_skills(quiet=True)` in Hermes' own Python (`packages/runner/src/hermes-profile.ts HERMES_SKILLS_SYNC_SCRIPT`). It copies new skills, updates unchanged ones, and leaves a skill the profile changed or removed alone; its manifest (`skills/.bundled_manifest`) remembers what it seeded.
- When: once per new revision, on "Neu schreiben", and on the first apply after the runner starts; never on the minute checks (`policy.ts` `seedBundledSkills`). Under isolation it runs in the profile helper as the project's user, like every other profile write.
- A seeding that fails never keeps the revision from applying; the agent's status says why.
- **Instance setting** Administrator → Agenten-Laufzeit → Hermes-Profile → "Mitgelieferte Hermes-Skills": *Alle* (default) or *Nur die nötigsten*, which is Hermes' own opt-out marker `.no-bundled-skills` (only the skill Hermes needs itself). Switching to *Nur die nötigsten* seeds nothing new; skills already there stay.
- The per-agent "Hermes skills off" list (`skillsDisabled`, set by the tuning script) is untouched: Hermes hides those from the index (`skills.disabled`).
- Verified against the real Hermes source on Kingston with a throwaway `HERMES_HOME`: 58 skills seeded, a second run copies 0, the essential mode seeds 1.

**Name clashes are shown, not resolved silently.** `skill_view(name)` refuses every skill of a name that two different skills share, disabled or not ("Ambiguous skill name", `tools/skills_tool.py` `_locate_skill`, line 533). The agent page (Fähigkeiten) lists each shared name with where each copy comes from ("Aus Helena", "Mit Hermes ausgeliefert", …) and what fixes it: take the Helena skill off the agent (the Hermes-adapted one then serves) or rename it in the library (`apps/web/.../AgentSkillClashes.tsx`, `utils/agentAbilities.ts skillNameClashes`). It reads the inventory the runner reports, so it appears as soon as a seeding creates a clash.
- Rejected: the runner deleting the bundled copy (Hermes would then treat it as removed by the user and never bring it back) or refusing the Helena link (the owner's choice). The tuning script's clash rule already removes such links when it is run; the runbook runs it again after the seeding.

## 4. Helena's MCP server instructions (audit §3.7)

`apps/api/src/mcp/instructions.ts` is runtime-neutral now. Claude Code and Codex read it; Hermes does not. It names Helena, not "Itsaplan". It asks in a chat but uses `mark_issue_blocked` in an autonomous run. It reports finished work in a comment in a run and to the person in a chat. It no longer says "do not commit": commits and pushes follow the agent's own instructions and the approval rules, with the task's identifier in the message. It also gains a "Goals" paragraph.

## 5. Learning from chats (audit §5)

**Problem.** Hermes' background review is off for good reason: the one-shot process ends before its thread. Helena reflects only after runs (`agents/runner/reflection.ts`), so what the owner says in chats never becomes memory.

**Decision: a queued reflection per chat, drained by the agent's runner.**
- **Scheduling.** After each successful chat answer, the internal plugin `helena.chat-learning` (a subscriber of the `helena.chat.message` domain event, `modules/agents/chat-reflection/plugin.ts`) queues the thread's reflection in `helena_chat_reflection`:
  - due once the chat has been quiet for **10 minutes** (each later answer moves it on: a debounce, so a conversation is reflected on once, when it ends);
  - at once after **20** of the owner's messages since the last reflection;
  - never before **2** of them;
  - at most one waits per thread.
- **Serialization.** The reflection continues the chat's Hermes session, so it is handed out only while no answer of the thread waits or streams. An answer is held while a reflection of its thread is out (`chat/service.ts claimMessage`). The two never run on one session at once.
- **Running.** The runner has a fourth feed next to runs, chats and runtime requests (`packages/runner/src/cli.ts`, `chat-reflect.ts`). It runs one at a time and polls every minute. It uses the same reflection turn as a run (`reflect.ts reflectTurn`): only the `memory` and `skills` toolsets, 8 turns, 120 s, and the local model when Lokale KI's class `reflection` takes small sessions. The prompt (`runner/reflection.ts chatReflectionPrompt`) asks for what the person said about themselves and how they want things done (USER.md), settled facts (MEMORY.md), and a skill only for a procedure worked out step by step.
- **Guards.**
  - Memory approval still applies: the agent's writes wait as proposals.
  - The tokens go to the usage ledger as kind `reflection` and count against the agent's budgets (`enforceBudgets`).
  - Nothing is handed out while the instance's emergency stop is on or the agent is paused.
  - Only learning Hermes agents reflect.
- **Settings per agent** (Fähigkeiten → Selbstlernen → "Aus Chats lernen"): on/off, the quiet minutes and the message count. The latest reflections are listed there ("Zuletzt aus Chats gelernt").
- **Cost.** One turn per conversation that reads the chat's session. With the compression cap below that is at most ~100k tokens, usually far less, and often cached if the chat was recent.
- **Rejected.**
  - An `agent_run` with a new trigger: a Home chat has no project, the run and chat queues do not serialize one session, and it would show as work in the runs list.
  - A reflection turn right after the answer: it would hold the next question, and it could not wait for the conversation to end.

## 6. Context compression (audit §3.6)

**Hermes' keys** (`hermes_cli/config_defaults.py` "compression", line 553; read by `agent/agent_init.py _parse_compression_config`, line 1505):
- `compression.threshold_tokens`: an absolute cap on the trigger; the lower of the ratio threshold and this wins (`agent/context_compressor.py _apply_threshold_tokens_cap`). The default is 256 000. On the Codex OAuth route Hermes raises the ratio of gpt-5.x to 85 % of a 272k window (`codex_gpt55_autoraise`, `agent_init.py _compression_threshold`, line 1448), so compaction fired at ~231k. That is where the 100k–250k per call came from.
- `compression.target_ratio`: the share of the threshold kept as the recent tail and summary budget (0.20).
- `compression.idle_compact_after_seconds`: a session resumed after this idle time is compacted before it answers (0 = off; `agent/turn_context_compaction.py`, line 153).
- `auxiliary.compression.{provider,model}`: the summarising model (`config_defaults.py` line 742; "auto" = the main model).

**Decision.**
- **The instance default is 100 000 tokens** (Administrator → Agenten-Laufzeit → Hermes-Profile). It is well below the windows of today's models, and above what most runs reach, so runs are not summarised mid-work often.
- **Per agent** (Runtime-Richtlinie → "Kontext verdichten", Hermes only):
  - the threshold (16k–1M);
  - what to keep (10–50 %, default Hermes' 20 %);
  - compress after a pause (never, 30 min, 1 h, 4 h, 1 day; default never);
  - the model for the summaries (automatic, or any model the agent's runner lists).
- These are written into the managed configuration by the `hermes-settings` profile contribution (`packages/runner/src/hermes-settings.ts`) and checked by the drift probe like every managed setting.
- An agent's own compression model wins over Lokale KI's compression helper; the local-AI contribution then leaves that helper out (`local-ai.ts hermesLocalAiConfig ownTasks`).
- **Trade-off.**
  - A lower threshold means fewer tokens per call and a smaller session to resend.
  - It also means more compaction events: each is one summarising call over the context, loses verbatim detail, and breaks the prompt cache once.
  - 100k halves the typical per-call context of a long chat and still leaves a run room for large tool outputs.
  - Idle compaction pays off only for chats resumed after the prompt cache expired and then continued for several turns, so it stays off by default.
- Not exposed (documented here): `proactive_prune_tokens` (a no-LLM prune of old large tool results, e.g. browser snapshots), `tail_mode`, `protect_last_n`. They are candidates if long browser chats stay expensive.

## 7. Goals made effective (owner, 2026-09-25)

**Model.**
- `helena_goal_task` (issue ↔ goal, at most one goal per task). It is a table of its own rather than an `issue.goal_id` column: the goals stay one module, the large issue row and its serializers stay untouched, and `organization.ts` already depends on `app.ts`, not the other way.
- `helena_goal_note`: progress notes; a note may propose a status.
- Migration `0186_helena_agent_context` on this branch. It becomes **0187** after hub/agent-env's 0186. It also holds `helena_chat_reflection`.

**Who sees what** (`modules/goals/scope.ts`):
- The Home agent and every person of the team see all goals.
- Any other agent sees:
  - goals of its projects;
  - goals without a project, of its projects' departments or of a department above them;
  - goals of the whole team (neither project nor department);
  - and the goals above each of these, so a chain can be told.
- A goal of another project stays hidden even below one of its own.

**In the agent's context.** A `## Goals` section of SOUL.md (`runtime-policy/goals.ts`) lists the *active* goals that concern the agent, each as:
- `#id "title"`;
- its project and department;
- its target date;
- its chain ("part of: A › B");
- the first 200 characters of its description.

The section also names the tools. It is bounded to 12 goals and 3 000 characters ("… and N more (list_goals)"). Progress is left out on purpose: it changes with every finished task, and each SOUL change is a new revision every runner writes.

**MCP tools** (routes with `mcpTool`, categories per D-C1):

| Tool | Route | Category |
|---|---|---|
| `list_goals` | `GET /teams/:teamId/goals?status=&projectKey=` | read |
| `get_goal` | `GET /teams/:teamId/goals/:goalId` (chain, children, tasks with state/assignee/running, notes) | read |
| `link_issue_to_goal` | `PUT /issues/:issueId/goal {goalId|null}` (work_items edit guard + goal in scope) | write |
| `add_goal_note` | `POST /teams/:teamId/goals/:goalId/notes {body, proposedStatus?}` | report |
| `create_issue` | `goalId` added; checked before the task exists, linked in its transaction | write |
| `get_issue` / `get_issue_by_number` | answer the task's `goal` | read |

**Status changes are the owner's.** An agent proposes a status in a note (`proposedStatus`). A team owner or manager accepts or rejects it (`POST …/notes/:noteId/decision`, team manager only, not an MCP tool); accepting sets the status. People change the status on the goal itself and cannot propose.
- Rejected: `request_approval`, which is project-scoped (a department or team goal has no project) and built for actions outside Helena that start a new run once decided. A goal's status is Helena's own data, and a confirmation on the goal page is simpler for the owner.

**UI** (Organisation → Ziele, and the project's Team & Orchestrierung → Ziele). Each goal card shows:
- "x von y Aufgaben erledigt" with a bar;
- the agents working on its open tasks (assigned, delegated or with a run under way);
- a proposal with *Übernehmen* / *Ablehnen*;
- on request, the linked tasks (identifier link, state, who, "Agent arbeitet gerade"), unlinking a task, linking one by its identifier ("VOL-12"), and the notes.

The organigram shows "done/total" next to a goal. A card opens anew with the server's values when the goal changed there (an accepted proposal), so a stale form cannot save the old status back.

**The coordinators' skill** `bundles/agent-pool/skills/ziele-in-aufgaben-zerlegen` now:
- reads the goal (`get_goal`, `list_goals`);
- gives every task it creates `goalId`;
- links existing ones with `link_issue_to_goal`;
- reports with `add_goal_note`, proposing `achieved`/`paused` but never setting a status.

**Found, not changed.** The organigram lists a goal without a department at team level even when it has a parent goal (existing tree logic). The project view's parent picker shows "Keine" for a parent outside the project, though saving keeps the stored parent.

## 8. Tests

| Suite | Result |
|---|---|
| API | goals (unit 8, integration 4); chat reflection (unit 7, integration 5); structure (unit 10); bootstrap (12, incl. project instructions + requeue); agents, runtime-admin, scripts, MCP, organization, goals and issues together **865 pass / 6 fail** before my two test updates — the 4 "ai agents" failures are the known baseline, and the other 2 were tests that pinned the old behaviour (specialist gets no team section, exact Hermes settings), updated. Then **339/0** for goals + issues. |
| Worker | project-provisioning **9/0** (incl. the public origin, first APP_URL entry) |
| Provisioning integration (`node --test`) | **95/0**: new block renewal, legacy migration, owner text kept, symlink refusal, area block/legacy rules, public-origin resolution, envelope validation |
| Runner | full suite **336/0** (was 304): compression keys, local-AI helper skip, seeding only when asked, failure tolerance, once per revision, chat reflection turn and report |
| Web | full suite **807/0** (incl. skill clash detection) |
| tsc | api, web, worker, runner, sdk, net: clean |
| eslint / prettier | clean on the changed files |
| Bundle check | `setup-agent-pool.ts --check`: 17 agents, 84 skills, valid |
| UI | own stack (API :25570, next dev :25571, fresh DB), headless Chrome with sign-in, 1440 px and 390 px:<br>- goal cards with progress, workers, proposal accept (status becomes Erreicht, the form follows), unlink and link by identifier, notes;<br>- organigram "1/4";<br>- project goal view;<br>- agent page: Aus Chats lernen with the reflection list, the skill clash alert, Kontext verdichten (saved 80 000 and read back);<br>- Administrator → Hermes-Profile.<br>No console errors, no horizontal scroll on the phone. |

## 9. Live runbook (orchestrator)

1. **Merge.** Trial-merge `hub/agent-context` onto `volition/hub` in a worktree.
   - Renumber its migration after hub/agent-env's: take ours for journal and snapshot, then `bunx drizzle-kit generate --name=helena_agent_context` and paste the SQL of `0186_helena_agent_context.sql`.
   - Expected shared-file conflicts with hub/agent-env: none textual in the files I know; see §11.
   - Then `full-test.sh hub/merge-check`.
2. **In-flight check** before the deploy: `agent_run` pending with `started_at` = 0, `agent_chat_message` streaming = 0. The deploy restarts the runner.
3. **`deploy.sh`.** It installs the changed `volition-provisioning.service` (no host names any more), restarts provisioning, runs the migration, rebuilds the runner bundle, restarts runner, API, worker and web.
   - After the restart each runner applies a new revision (SOUL changes: team and goals sections; managed config: compression). It seeds Hermes' bundled skills once per profile: a few seconds per profile, all 8 at start.
4. **Refresh the workspaces** (dry run first):
   ```sh
   ssh helena-ops@kingston-server.local 'sudo systemd-run --wait --pipe --collect --uid=volition-plan \
     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan/apps/api \
     /usr/local/bin/bun src/scripts/refresh-project-context.ts'   # then again with --apply
   ```
   Check after ~1 min, without printing secrets:
   - `grep -c helena:project-context /srv/volition/workspaces/projects/*/AGENTS.md` shows 1 per project;
   - `grep -l browser_exec …` finds nothing;
   - `PROJECT.json` `links.helena` starts with `https://helena.volition.one/project/`;
   - `organizationInstructions` holds the tuned texts;
   - an area file such as `vol/homepage/AGENTS.md` starts with `<!-- helena:area-context -->`.
5. **Clashes after seeding.** Open the agent pages of `@coder-verve` and `@content-vol` (Fähigkeiten): a red "… gehört zu mehreren Skills" alert names the shared names. Then run the tuning script's dry run (`agent-tuning.ts`, agent-tuning.md §6). Its clash rule proposes removing those Helena links; apply after a look.
6. **Pool skill text.** The changed `ziele-in-aufgaben-zerlegen` reaches the team library with `setup-agent-pool.ts --update` (a personal API key in `HELENA_API_KEY`, dry run first). Until then the library keeps the old text.
7. **Proof.**
   - A new chat with `@hermes-vol-coordinator`: "Wo liegt die Website und wie wird deployt?" (the refreshed context).
   - An agent's runtime status: revision applied, no drift (the probe checks `compression.threshold_tokens`).
   - On Kingston, `jq .compression /var/lib/volition/hermes/profiles/vol/run/itsaplan-managed/config.yaml` (as root or the project user).
   - Create an active goal for VOL and check that the coordinator's SOUL.md has `## Goals`.
   - After a two-message chat has been quiet 10 min, the agent's "Zuletzt aus Chats gelernt" shows a reflection and its memory proposal waits in Freigaben.
8. **Owner-visible defaults to mention.** Chat learning is on for all learning Hermes agents (10 min / 20 messages). Compression is from 100 000 tokens for all agents. Bundled skills are *Alle*. All three are adjustable in the UI.
9. **Rollback.** `git revert -m 1 <merge>` and `deploy.sh`. The migration only adds tables, so they can stay. The seeded bundled skills stay in the profiles (harmless; turn single ones off per agent). Workspace blocks stay in the new form; a revert does not rewrite them back.

## 10. Not verified here
- A real Hermes run of a chat reflection. The turn and its report are tested with a fake Hermes, and the queue with the API. The runner builds the same `hermes --resume … --toolsets memory,skills` call a run's reflection uses (tested). The live proof is runbook step 7.
- The seeding inside the isolation profile helper on the live profiles. It is the same code path as the probe (`python3` of the helper's PATH).
- That Hermes honours `threshold_tokens` below the autoraised trigger for the Codex route. By the source (`_derive_trigger`: `min(threshold, cap)`) it does; the drift probe reads the value back, but not the effective trigger.
- nginx serving `/code/`, `/focus/terminal-project/` and `/browser/` on the public origin: the links assume the same paths as on the LAN.

## 11. Overlaps with hub/agent-env
hub/agent-env changes credential delivery, the runner's environment and clones.
- **Shared files:** `packages/runner/src/cli.ts`, `client.ts` and `chat.ts`, `apps/api/.../chat/index.ts` and `runtime-policy/index.ts`, `apps/web/src/services/queryKeys.ts`.
- **cli.ts:** I added the chat-reflection feed in `serve()` and two imports and a constant. agent-env changes `handle()`, `handleChat()` and `profileHelper()`. Different hunks.
- **client.ts:** two methods and a type near `claimChat`.
- **Not touched by me:** `chat.ts`, `chat/index.ts`, `runtime-policy/index.ts`, `run.ts`, `execute.ts`, `workspace-job.ts`, `isolation.ts`, `TeamAiAgentFields.tsx`.
- **Migration:** mine becomes 0187 after its 0186.
- **Masking:** agent-env masks the runner's reports (`maskForTeam`) on the run, chat and status routes. My new report route (`/agent-chat-reflections/:id/result`) carries a reflection summary. It should get the same masking once agent-env lands; that is one line in `chat-reflection/index.ts`.
