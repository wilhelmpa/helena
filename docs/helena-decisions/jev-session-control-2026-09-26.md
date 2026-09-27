# Optional Jev control in a Helena chat

State: 2026-09-26, owner backlog reconciliation. Prepared on `072fb36f` in the
isolated `codex/jev-session-control` worktree. Root alone integrates, runs the full
gate, deploys and records live acceptance. No provider request or live setting was
changed by this work.

## Scope and call paths

The owner's [video reference](https://www.youtube.com/watch?v=tTnUcSj-QPA), Jay E |
RoboNuggets, 2026-09-21, was compared against the supplied English auto-transcript
at 5:05, 6:26, 7:03, 8:01 and 9:51. Its speed and cost examples are not Helena
measurements. The implementation uses the existing Helena service and the official
[TypeSafe skill pinned at 65a39f3](https://github.com/typesafe-ai/skills/blob/65a39f393687675ce170e6094757de20370365b9/skills/typesafe-ai/SKILL.md),
already imported into Helena. Nothing was installed in Codex or Helena.

| Video use case | Existing Helena path | Scope of this patch |
| --- | --- | --- |
| Model routing | `agents/chat/service.ts:claimNextMessage` → `model-router/service.ts:routeRequest` → `decisions/service.ts:decide` | Restrict the optional first stage for this chat |
| Session on/off | Native composer commands and owned chat PATCH | Add `/jev on`, `/jev off`, `/jev inherit`; `/jev` reads the saved value |
| Skill selection | `agents/skills/service.ts:listAgentRuntimeSkills` → `runtime-policy/service.ts:runtimePolicySnapshot` | Bounded gap analysis below; no new selection or installation |
| Mail classification | Existing mail decision class and ingestion/receipt workflow | Remains independent of a chat preference; the separate mail session owns implementation |
| Semantic media search | Canonical Vault → knowledge index → existing hybrid search | Connection design below; no new index or store |

The native router already passes a server-owned `chatMessageId`. An explicit chat
model or voice-model choice skips that router. Existing agent/project switches,
specialist escalation and the configured fallback path remain authoritative.
The session preference does not control a directly selected Browser 2.0 connection,
arbitrary MCP calls without a trusted chat identity, background mail or CLI-native
agent behavior. The UI describes the setting as an optional chat pre-decision.

## Stored preference and revocation

The thread stores `jev_first_stage` (`inherit`, `on`, `off`, default `inherit`) and
an integer revision. Existing chats and new chats inherit the team policy. `on`
expresses participation only where all team, class, cloud, connection, eval and
router gates already allow it. Today `on` and `inherit` have the same effective
permission. `off` skips the optional first stage; the configured original path
still runs, including an explicitly configured Jev primary if one exists.

Attempts retain their role (`first-stage` or `regular`). Primary and fallback
assignments are deduplicated within the regular path; sharing a connection with
the optional stage preserves that separate attempt and its share of the original
deadline. A revoked or semantically uncertain stage can therefore return to the
independently configured connection with the ordinary questions. Its result,
including `unsure`, is not revoked by the optional stage's chat switch. Every
attempt still passes the existing `usable` checks. No regular class assignment or
cloud permission is inferred from a first-stage connection.

Only the chat owner can PATCH the preference, with current project visibility
checked. The setting can change while the answer is running. The composer handles
the command locally, including Enter and the submit button; it does not queue the
command as a model prompt. An exact `/jev` takes precedence over saved prompts of
the same name. A chat must already exist; an empty draft asks the user to start or
open a chat first.

The decision service resolves the thread from its assistant-message ID and verifies
agent, team and project identity. Missing, mismatched, deleted or off scopes cannot
use the extra stage. A preference revision is captured for the attempt. A fresh
database read is combined with the existing policy check before dispatch, during
the existing 100 ms polling loop and before accepting the result, including after
usage/log recording. A quick off/on changes the revision and invalidates the old
attempt across API processes. The abort signal belongs only to the optional stage;
the original workflow can continue. Provider cancellation cannot retract input
already sent. No new input or private data is sent by this patch.

Migration `0193_helena_chat_jev` follows the actual Vault0192 snapshot. It adds two thread columns;
no model, agent, team setting, skill link or credential is modified. Root may
renumber it when integrating the ordered release waves. Keep the added columns
during a code rollback; older code ignores them.

## Existing-skill selection: reviewed gap and bounded connection

Helena currently distributes the agent's linked skills through its runtime policy.
The composer `/skills` opens their administrative settings. There is no native
per-turn Jev skill ranker in this path. Team library membership alone is insufficient
as a candidate authorization rule: start with the already linked runtime skills of
the agent authorized in the current project, preserving current project membership,
tool denies and required safety instructions. Do not search the global team library
or the later catalog backlog item 12 for additional candidates.

A future optional ranker can use bounded `{id, name, description}` candidates, a
`none` answer and the current task under a separate explicitly cloud-permitted
decision class/eval. Return an existing candidate ID, recheck its assignment before
loading it, and retain all required instructions. Uncertainty or failures keep the
runtime's normal selection. A rank must never write `agent_skill_link`, install a
skill, widen tool grants or hide safety instructions. Private skill descriptions and
task text require explicit applicable data permission; this patch adds none.
The official [skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion)
is a design reference, not a permission to send Helena's catalog or use its example
thresholds without a dedicated evaluation.

## Semantic media/Vault search: connection design only

`packages/knowledge/src/search.ts` already combines full text with an optional
semantic retriever after `readableItems` and source/project/folder filters.
`vectors.ts` stores passages in the existing `knowledge_chunk`; the Vault source
uses canonical paths and `vault_entry.text`. `packages/vault/src/extract.ts` has
image OCR, but no image-scene captions, audio transcription or video-frame/segment
extraction. OCR can find visible words; it does not establish scene semantics.

Extend the existing extraction/index path with provenance-bearing derived text
only after unified Vault acceptance. Retain each original and its canonical path.
Describe the model/version, source hash, timestamps/frame offsets and extraction
status in metadata; invalidate descriptions and embeddings when the original or
permissions change. Reuse the current embedding runtime and knowledge chunks;
introduce no media copy store, parallel vector database or second search UI.

If a Jev reranker is later useful, retrieve a small already authorized candidate
set locally, then apply a separately enabled/evaluated and cloud-permitted class to
bounded descriptions. Never send raw private media, unrestricted result sets or
hidden-project metadata. Recheck reach before reading and returning a selected
canonical result. On missing captions, uncertainty, timeout or off, preserve the
existing hybrid result. Evaluate query/caption coverage, retrieval quality, ACL
denial, changed-file reindexing, canonical links and latency before claiming gains.

## Validation and remaining live acceptance

Validation of base commit `a9a54816` in the isolated server source tree `~/agent-work/jev-session-control`,
using only existing dependencies under `heavy.sh --class test`:

- Generated and applied `0192_helena_chat_jev`; a second generation reported no schema
  changes. The snapshot comparison confirms that only the two thread columns differ.
- 61 API tests / 609 assertions / 0 failures: first-stage decisions, router/mail
  decisions and chat workspace. The nine new cases cover inheritance/isolation,
  gates with `on`, foreign/malformed updates, trusted-message scope, in-flight off,
  off/on revision revocation, pre-dispatch revocation, late success and cached partial
  results revoked during fallback.
- 16 web tests / 0 failures: slash commands, composer keyboard behavior and chat rows.
- API and web TypeScript checks, scoped ESLint and changed-file Prettier passed.
- The local 12 command/keyboard tests also passed. Removing busy-chat command support
  made that regression fail; restoring it returned the suite to green.
- Test data was synthetic. The provider substitute listened on loopback. No TypeSafe
  inference, GPU/model, live configuration or shared database was used.

The private PostgreSQL instance used reserved port 65500. The runner stopped it on
exit; process status and a fresh port check confirmed that it was no longer running.
The heavy slot is free. Detailed logs are in
`~/agent-work/jev-session-control-logs/{api-tests-final,web-tests,api-types-final,web-types,scoped-lint-final,generate-verify,migrate}.log`.

Root's final gate must include the existing first-stage, router/mail and chat
workspace suites. After deployment, verify the saved mode survives reopening,
works from Home and project chat, and can change while an answer is running.
Verify the team switch remains off if initially off and an explicit chat model
still bypasses routing. With only an explicitly allowed synthetic class, prove
off during an actual held first-stage request discards its result and yields exactly
one continuation. Repeat with off/on and a foreign member. Record actual logs,
timing and outcomes. No private mailbox, account, browser page or media should be
used as spontaneous test input.

Reference reads also included the [SDK](https://docs.typesafe.ai/sdk/javascript),
[confidence guide](https://docs.typesafe.ai/confidence) and
[cascade cookbook](https://docs.typesafe.ai/cookbooks/sde_cascade). Typed answers
and confidence remain inputs to Helena's code, not execution permissions or a
measured quality guarantee.

## Follow-up: native browser acceptance and shared connection roles

The [Root acceptance supplement](../../deployment/volition-stack/browser/acceptance/JEV-SESSION.md)
extends the existing native JEV plan. It includes copyable synthetic UI prompts
and observer commands for explicit-model retention, chat persistence, an ordinary
browser goal, actual continuation after native handback and project boundaries.
The existing observer adds `compare-task` and `compare-unchanged`; both require
the same project, target and document. The unchanged mode only compares its fixed
fixture fields; it cannot establish absence of attempted actions without the
native step audit. Reconnect remains a separate acceptance cell.

Light local validation for this follow-up, with no database/browser/provider:

```sh
bun test apps/api/src/modules/decisions/attempts.test.ts packages/browser-gateway/src/task/run.test.ts packages/browser-gateway/src/task/loop.test.ts
node --test deployment/volition-stack/browser/acceptance/observe.test.mjs
```

- 42 Bun tests / 162 assertions and 6 Node tests passed. Four added public
  `runTaskTool` cases cover HTTP provider failure, a synthetic HTTP timeout response,
  transport failure and target ambiguity. They verify original project/agent/run/
  message binding at task start, task-token continuity, zero page actions and a
  continuation snapshot. They do not claim real elapsed timeout or subsequent
  execution by an agent.
- Four pure attempt-planning cases verify separate stage/regular roles, a shared
  fallback, regular deduplication and absence of implicit regular permission.
  Substituting the old ID-only behavior makes three tests fail; restoring the
  role-aware code makes all four pass.
- Added observer checks reject pre-existing success, malformed outcome fields,
  counter changes, navigation and cross-project evidence. Existing root-only CLI
  refusal and reconnect cases remain green.
- Changed TypeScript files were formatted with an already cached Prettier binary,
  without installation or download. No server or private DB was started.

Six additional real-service integration cases passed in the existing
`first-stage.test.ts`: same-connection uncertain/specialist, same-connection
fallback, in-flight off with decided/unsure regular result, and no implicit regular
assignment after off. Root released the private test window after browser/MFA
`68430b23` deployment. Exact source `df69b8ec3e608aa59df70b5adb42e195f24185c4`
was verified against SHA-256 hashes of all 5,682 tracked files, using existing
dependencies in the private source tree. Through `heavy.sh --class test`:

- First-stage, decisions and chat-workspace suites: **67 tests / 668 assertions /
  0 failures**, including the six new service cases.
- API TypeScript, scoped API ESLint, scoped gateway-test ESLint and changed-file
  Prettier checks passed. No web retest, install, GPU or provider call.
- The exit trap stopped private PG65500. Fresh `pg_ctl status` reported no server;
  `ss` showed no listener at 65500. Both test and verification slots were released.

Logs: `~/agent-work/jev-session-control-logs/df69b8ec/{api-tests,api-types,api-lint,gateway-lint,format-check,stop}.log`.
Root still owns integration and the shared full gate, which remains NOT RUN here.
All live UI/provider cells in the supplement remain NOT RUN.
