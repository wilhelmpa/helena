# JEV controls in Local AI

State: 2026-09-27, owner backlog reconciliation. Prepared in the isolated
`codex/jev-session-control` worktree, following `a29e7ee6`. Root alone integrates,
runs the shared release gate, deploys and records live acceptance. This work does
not install anything, load a local model, send real mail or call a real provider.

## One policy and explicit cloud scope

Dashboard → Local AI now reads and writes the existing team policy
`decisions.jev-first-stage.team.<teamId>` through the existing Decisions API. It
provides a master switch, an explicit existing team connection selection, and
separate **optional** email and browser switches. TypeSafe/JEV is labelled as a
cloud model, independent of the local AI master switch. Opening the dashboard
does not choose a connection or grant cloud permission.

Every use-case switch writes only that use case, including its explicit
`cloudAllowed` value. Concurrent patches lock the existing setting row and merge
with its current value; an unrelated use-case write cannot undo master Off or
overwrite another use case. Every accepted policy write changes a persisted
revision. The same shared query cache serves Decisions and Local AI, and a reopened
view refetches the persisted value. Existing policies without a revision continue
to read correctly. No enabled flag or owner model is changed by migration.

Saved On and effective permission are separate. The UI reports the class/eval,
cloud, local-only and cooldown blockers. Provider status is explicitly the **last
connection test**, not a guarantee of current availability. Neither opening the
panel nor a status read probes the provider. Connection changes clear use-case
grants and turn the optional master off until explicitly reconfigured.

The existing `classifyMessage` path still asks `decisions/service.ts:decide`.
Mail Off, uncertainty, timeout, provider failure and revocation hand back to its
configured primary/fallback. All existing task-eligibility, receipt and action
policy remains in that caller. `/jev` controls the optional stages of its trusted
chat; background mail has no chat and remains governed by the team mail switch.

## Native browser integration

Projects inheriting Standard may use the optional browser stage when the same
team policy, explicit cloud grant, browser eval and current connection gate allow
it. The existing `browser_task`/`browser_check`/`browser_choose` path handles the
request. Explicit project Standard stays Standard. Independently configured
project or instance decision connections retain their original behavior even
when the optional master is Off. Explicit chat model selection is untouched.

Migration `0194_helena_browser_jev_stage`, following Chat0193, adds a nullable `first_stage_scope` to
the existing task row. Only optional runs capture the team policy revision,
trusted chat revision and a SHA-256 fingerprint of nonsecret connection settings
plus credential update timestamps. Explicit runs keep a null scope. Partial
unique indexes allow at most one optional attempt per trusted message/run, so a
handback cannot start the optional stage again for the same work. No values typed
into a page or credentials enter this snapshot.

The current agent, team, project membership, active identity, enabled browser
tool, trusted run/chat and connection are checked before dispatch and again
during inference, before releasing an inference result, around the asynchronous
action policy, and at progress/completion. An Off→On revision change still revokes
the older attempt. The optional inference has a bounded timeout, no provider
retry, a 16,000-character request cap and an abort race that also returns when a
transport ignores cancellation. Failure/timeout cancels its token; the ordinary
step tools remain available. Already transmitted input cannot be retracted.

The gateway returns current page refs and the applied history on uncertainty,
failure or revocation. It does not navigate back or restart the workflow. It
gives queued step records up to one second before aborting the pending write and
skipping the remaining queue. Final permission confirmation and the finish write
each have the same one-second bound, without retries. The complete local step
history remains in the handback even if accounting is unavailable. The API does
not append a late step to a finished row. Late success after revocation is saved
as cancelled, and an empty late result cannot erase previously recorded steps.
The action policy still authorizes every effect; JEV probabilities grant none.

The new six-case browser evaluation checks small synthetic target selection.
It is **not** a native browser benchmark, calibration of the first-stage readiness
question, or proof of provider quality after changing a model. Existing eval
provenance semantics are unchanged. Do not infer live readiness from fixtures.

## Verification and remaining acceptance

Implementation commit: `33f386f27999341c270ac29392ed4d71ebcffff6`, following
the earlier `a9a54816`, `df69b8ec` and `a29e7ee6` session-control work.
Independent `review_r1` approved the final source, including bounded progress.
Targeted synthetic verification used existing dependencies, one
`heavy.sh --class test` job at a time and private PG port 65500:

| Check | Result |
| --- | --- |
| API: decisions, chat, native browser, action-policy and stage guard, before final accounting delta | 159 passed, 0 failed; 1,171 assertions in eight files |
| Affected native browser API after the final delta, exact `33f386f2` | 41 passed, 0 failed; 313 assertions in two files |
| Public gateway task, continuation and client after the final delta, exact `33f386f2` | 16 passed, 0 failed; 111 assertions in two files |
| Dashboard rendering and real API-client mutations against synthetic fetch | 6 passed, 0 failed |
| API, web and browser-gateway TypeScript | Passed; API/gateway repeated after the final delta |
| Changed API/web/gateway/DB source lint, locale parity/ICU | Passed; generated migration metadata ignored by ESLint |
| Changed-file repository Prettier check | Passed |
| Generated 0193 and private migration | Passed; a second generate had no schema changes |

Initial checks are under
`~/agent-work/jev-session-control-logs/dashboard-2/`; the corrected DOM test
harness and its final web TypeScript/lint checks are under `dashboard-3/`.
The first exploratory run's two fixture/import errors and formatting failures
are retained under `dashboard-1/`, not presented as passing evidence. Final
checks of `33f386f2` are under `dashboard-final/` and completed with exit code 0.
All 5,691 tracked files were SHA-256 matched before that run, using
`~/agent-work/helena-jev-33f386f2-manifest.json`. The three held-accounting
regressions each verify an aborted signal and handback in less than 1.8 seconds,
with the already-applied steps and current snapshot intact. No retry or second
task start occurs. The final
Dashboard test exercises master Off even after failed provider status, individual
cloud grants without replacing other cases, no automatic connection selection,
persisted reads on reopen, readers without writes, and an unavailable-state error.

PG shutdown was verified from the EXIT trap log, then independently:
`pg_ctl status` reported no server and `ss -ltnH 'sport = :65500'` returned no
listener after the final run. No shared full-test gate,
real-provider inference, real browser page or GPU/model benchmark was run here.
Earlier `df69b8ec` results certify that commit only. The wider checks above cover
the unchanged code and the final focused rerun covers the review's accounting
fix. No implementation commit was amended after delivery.

Root live acceptance remains **NOT RUN**:

1. Save/read the chosen team's master and independent use cases in Local AI and
   Decisions, including refresh/reopen. Confirm Cloud label and last-test status.
2. Prove the existing mail classifier chooses/backs out of the optional stage;
   keep existing configured mail settings and caller actions intact.
3. With a synthetic native browser fixture, prove On, Off, uncertainty,
   timeout/error and Off during a held decision/action-policy wait. Confirm the
   current snapshot and already-applied step survive, with no repeated optional
   run, no duplicate effect, and ordinary continuation.
4. Check the foreign-team/project/agent and local-only boundaries, explicit
   project connection behavior, and explicit chat model preservation.
5. Restore only settings changed for acceptance to their captured prior values.

The existing `deployment/volition-stack/browser/acceptance/JEV-SESSION.md` and
`JEV-LIVE.md` provide Root's fixture/observer procedure. This document extends
their scope to the optional native browser stage; explicit Browser 2.0
connections remain independent. Keep the new migration column/indexes and the
previous chat columns during a code rollback; older code ignores them.
