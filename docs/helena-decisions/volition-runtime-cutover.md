# Native runtime cutover

Keep `HELENA_NATIVE_RUNTIME` disabled on the live instance until Claude accepts the
backend evidence and completes the outstanding UI. Task 113d makes no deployment or live
configuration change. The rollout order is Home, coordinators, specialists.

## Native functions

| Function | Entry point | Behavior |
| --- | --- | --- |
| Learned skills | `GET/PUT /agent-runtime/skills`, `learn_skill`, existing owner runtime actions | Revision-checked creation and editing; full text script/reference files; pin and archive; originals remain stored |
| Curator | Existing curator views and requests | Paused unless enabled; archives exact unpinned duplicates; pinned and distinct skills remain |
| Histories | Existing owner `/runtime/sessions` routes; native runner reader | Lists, searches and pages native/imported transcripts; project and private-chat access checked before paging |
| Instructions | Runtime policy SOUL and native configuration | SOUL, configured instruction files including AGENTS, agent instructions, project-wide organization and member instructions, context contributions; Hermes-specific operating instructions stay runtime-specific |
| Runtime selection | `POST /teams/:teamId/ai-agents/runtime-selection` | Dry-run by default; apply requires the returned revision; refuses outstanding runs/chats; preserves model and unrelated policy fields; returns exact rollback mapping |
| Profile import | `POST /teams/:teamId/ai-agents/:agentId/profile-import` | Team manager only; atomic per profile; dry-run by default; source journal and agent lock make simultaneous retries idempotent; conflicts fail without overwrite |
| Catalog | Existing catalog script with `VOLITION_NATIVE_CATALOG=on` | System Python, native-policy local models and configured API/subscription models; no Hermes Python modules; native tool discovery uses the runtime/MCP catalog |
| Cloud fallback | Native model chain and explicit subscription runtime fallback | API-key models run in the loop; `openai-codex` becomes an authorized Codex handover, `claude-code` a Claude handover; API retains project context and cancellation |

Native learned skills have their own `ai_agent.volition_learned_skills` storage; Hermes
inventory reports cannot overwrite them during rollback. Migration 0222 adds import
provenance, its journal and separate native skill storage; 0223 copies existing native
skills from the external-runtime report cache. MEMORY/USER revisions and native session rows remain available across runtime changes.

The native catalog reads Home's desired runtime from `/agent-runtime/policy`, including
while the catalog still serves a mixed runtime fleet. Its native-only mode refuses Hermes
descriptors. Retain the existing mixed runner until the specialist stage is complete.
New `VOLITION_*` configuration names identify the native catalog; existing compatibility
paths and descriptor keys keep their names until the separate global renaming step.

## Import procedure

Run the local importer as the API service user `volition-plan`, with the API environment
from `/etc/volition/plan.env`; local mode is the default and needs no API key. It calls the
same service as the endpoint, with the same request validation and protection rules. A
successful apply records the system operator `Wartungsskript (Owner-Auftrag)` in the source
journal inside the profile transaction; previews and unchanged retries write nothing.
Migration `0229_volition_profile_import_audit` must be applied before import.

First create a private mapping from the database's agent/team configuration and existing
run/chat session IDs. `--plan` only lists profile directory names, so it does not require
access to the contents of isolated profiles. Coordinator profiles use `<slug>` (including
`VERV` → `verve` and Home), other agent profiles use `<slug>_<agentId>`; missing or ambiguous
assignments fail. The mapping includes no credentials and is created exclusively with 0600
inside a caller-owned 0700 directory; an existing output is refused.

```sh
systemd-run --wait --pipe --uid=volition-plan -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan /usr/local/bin/bun run scripts/volition-profile-import.ts --plan /var/lib/volition/plan/profile-import/145/mapping.json
```

Pause the affected runners and drain their outstanding work before taking snapshots.
For profiles readable by the API service user, snapshot the mapping in one call:

```sh
systemd-run --wait --pipe --uid=volition-plan -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan /usr/local/bin/bun run scripts/volition-profile-import.ts /var/lib/volition/plan/profile-import/145/mapping.json --snapshot /var/lib/volition/plan/profile-import/145/snapshots
```

`--snapshot` creates a new private destination, copies only MEMORY/USER, learned skills
outside `plan-managed`, and the supported session source. It never copies `auth.json`,
`.env`, Vault or token files (including these names inside skills). SQLite is opened with
`mode=ro` and copied through Python 3's standard-library SQLite backup API, including
committed WAL data; the destination is closed in DELETE journal mode without WAL. Python 3
with `sqlite3` must already be installed. The original source remains unchanged. The
resulting `<target>/mapping.json` preserves source keys and links and names the snapshots.
Unsupported/binary/oversized skill files and symlinks fail; a failed or interrupted snapshot
has no completed mapping and must be repeated into a new destination. The copy of memory
and skills requires paused writers; the SQLite backup itself is consistent.

With isolation enabled, profile contents belong to `vp-<slug>` (`vp-home` for Home).
Snapshot each agent under that project user, using `--agent <agentId>`; systemd's
`LoadCredential` makes the API user's private mapping available without making it public.
For example, replace `AGENT_ID` with the selected numeric agent ID and `vol` with its slug:

```sh
systemd-run --wait --pipe --uid=vp-vol -p WorkingDirectory=/srv/volition/source/plan -p LoadCredential=profile-mapping:/var/lib/volition/plan/profile-import/145/mapping.json /bin/sh -c 'exec /usr/local/bin/bun run scripts/volition-profile-import.ts "$CREDENTIALS_DIRECTORY/profile-mapping" --snapshot /srv/volition/workspaces/projects/vol/.volition-profile-import/145-AGENT_ID --agent AGENT_ID'
```

The snapshot helper accesses no database and needs no API credential or API environment; the project user receives only the mapping through `LoadCredential`. Afterward the
operator must grant `volition-plan` read/traverse access to the completed snapshot directory
and mapping, or transfer this approved snapshot to a service-owned private directory and
adjust only the `profile` paths in its mapping; keep `sourceKey` and session links unchanged.
Do not grant access to original profile credentials. For example, an operator can give the
API user read-only ACLs on the prepared snapshot and traversal on its two private parents:

```sh
setfacl -m u:volition-plan:--x /srv/volition/workspaces/projects/vol/.volition-profile-import /srv/volition/workspaces/projects/vol/.volition-profile-import/145-AGENT_ID
setfacl -R -m u:volition-plan:r-X /srv/volition/workspaces/projects/vol/.volition-profile-import/145-AGENT_ID
```

The import reader accepts `memories/{MEMORY,USER}.md` (or root files), learned skill
directories outside `plan-managed`, and `state.db` with Hermes `sessions`/`messages` tables;
a `sessions.json` export is also accepted. It opens SQLite read-only and refuses WAL
snapshots, symlinks, invalid UTF-8 and oversized data. Existing run and chat links are found
by original session ID, with explicit links accepted only for the target agent. Private chats
without their owner thread are refused; unlinked terminal history remains team-admin-only.

Use the completed snapshot mapping for dry-run, apply and unchanged verification:

```sh
systemd-run --wait --pipe --uid=volition-plan -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan /usr/local/bin/bun run scripts/volition-profile-import.ts /var/lib/volition/plan/profile-import/145/snapshots/mapping.json --local
systemd-run --wait --pipe --uid=volition-plan -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan /usr/local/bin/bun run scripts/volition-profile-import.ts /var/lib/volition/plan/profile-import/145/snapshots/mapping.json --local --apply
systemd-run --wait --pipe --uid=volition-plan -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan /usr/local/bin/bun run scripts/volition-profile-import.ts /var/lib/volition/plan/profile-import/145/snapshots/mapping.json --local --apply
```

For isolated snapshots, substitute each project snapshot's `mapping.json` in these calls.
Optional `--http` uses `VOLITION_IMPORT_URL` and `VOLITION_IMPORT_API_KEY` from the protected
environment of an authorized team manager; never put credentials in mappings or arguments.
All modes print immediate progress to stderr, emit only import summaries on stdout, close
connections and exit with 0/1; the hard total deadline (including startup, backup and closing)
is 300000 ms by default, configurable via `VOLITION_SCRIPT_TIMEOUT_MS` (1–900000), with exit
code 124 and the last phase on expiry. Completed profile transactions remain committed.

The second apply must report `unchanged`. Reusing a source key for changed source content,
a differing existing memory/skill, or an existing session target is a conflict. An unchanged
retry leaves newer native edits intact. Import is atomic per profile, not across the mapping;
completed profiles can be retried after another profile failed. Reindexing follows commit.

## Release and rollback sequence for Claude

| Stage | Required actions and checks | Rollback |
| --- | --- | --- |
| Preparation | Accept 113d targeted tests, serial workspace typecheck and Flash eval evidence against 98c; complete Claude UI acceptance; reconcile subsequent migration numbers; back up DB, immutable profiles, release and full agent model/policy mappings | Retain the prior release and every original profile; no user traffic has changed |
| Drain and import | Stop assigning new work; finish/cancel outstanding runs and chats; pause the affected runner during import so its old memory observations cannot replace the selected baseline; dry-run all mapped profiles, resolve conflicts, apply and repeat | Restore the affected agent policy/runner; imported native sessions and skill records remain stored |
| Home | Enable the native gate only with approved code; preview and apply one Home agent; refresh the mixed catalog, which reads Home's runtime from its policy; verify real owner chat, streaming, tools, private history, resume, memory approval, compression, costs and configured cloud fallback | Drain native work, restore Home's saved model and complete runtime policy through the existing agent PATCH endpoint, regenerate the catalog and verify the previous runtime; retain native data |
| Coordinators | Move a small group with runtime-selection; save its rollback response; verify delegation, reporting lines, claims, budgets, persistent orders, Telegram, cancellation and resume | Drain and restore the exact saved mapping for this group; do not change Home or unrelated agents |
| Specialists | Move one project at a time; verify coding/browser tasks, project isolation, learned scripts/reference files, curator, reflection and consolidation | Restore this project's agent mappings after draining; preserve shared library links and native records |
| Stable native operation | Owner accepts real work across all roles; keep Claude/Codex escalation agents on their own runtimes; repeat the configured cloud failure test in the installed launcher before removing its legacy bindings | Previous mixed release, descriptors and profiles remain available |
| Native catalog | Set native catalog mode with an operator-owned `VOLITION_RUNTIME_ROOT` and copied runtime descriptors; models come from the native policy plus configured template models; verify every expected agent and the absence of catalog problems before switching runner units | Restore mixed catalog mode and prior descriptors without replacing native histories |

For runtime-selection, send `{agentIds, runtime}` first, save the response, then send the
same selection with `apply: true` and its `revision`. Any policy/model edit makes that revision
stale. Rollback uses each saved `runtimePolicy` and `model` through the existing per-agent
PATCH route; it is not a forced global Hermes default. Keep the native feature gate on while
native agents remain selected.

## Hermes retirement

The [file inventory](volition-hermes-removal.tsv) assigns all 486 reference files from task
113 to removal stages. It identifies source references; Claude must also inventory installed
units, timers, credentials and dynamically generated descriptors on the target host.

1. Prove native-only catalog/provisioning and its model list; retire the Hermes bootstrap
   and runner units only after their native replacement serves every selected agent.
2. Remove Hermes runner adapters, profile helpers, legacy session readers and API/SDK
   compatibility paths; retain imported histories and existing authorization checks.
3. Remove Hermes views/refresh paths from token keeper; preserve independent Claude/Codex
   credentials and test both escalation targets without Hermes auth files.
4. Remove Hermes update sources, update-center routes and update units/timers.
5. Remove Hermes executable/profile/auth sandbox bindings; keep project-browser, API and
   priority sockets and the Claude/Codex bindings. Test the installed launcher again.
6. Claude removes transition-only UI choices/texts after the designed replacement is accepted.
7. Archive the installation and originals after owner approval. Keep historical migrations;
   change active defaults/constraints through a new migration, and rename legacy identifiers
   only in the separate global renaming step.

Rollback remains the saved mixed release, descriptors and exact per-agent mapping until
retirement is explicitly approved. New native history is retained even when an agent returns
to Hermes; it is not injected into the old Hermes transcript format.

## Evidence and UI ownership

Task evidence is under `~/agent-work/codex-tasks/113d-*`; the report records the exact commits,
checks and eval results. A synthetic cloud API in a Bubblewrap user/PID/network namespace
proves the local-server shutdown path without real cloud credentials. That test does not
replace installed-launcher and real-credential acceptance during Claude's rollout.

Claude still designs skills, memory, SOUL/AGENTS, learning/dreaming, histories and bulk
runtime controls using the established design system and RuntimePicker. This task changes
no visible page, style or layout, so it produces no UI screenshot acceptance.
