# Browser acceptance: existing tab, native completion and JEV

Prepared against `b8737a3ec9625451fa48035258f3641b79cd97e6`, 2026-09-26. This is
an execution plan, **not live evidence**. The root orchestrator runs it only after
the relevant candidate has passed the shared gate and its scheduled deployment.
Do not deploy the entire prepared backlog to run this proof early.

For the bounded native JEV execution after deployment, use [JEV-LIVE.md](JEV-LIVE.md):
the existing P6BROW26 fixture, exact native tool arguments, independent readback,
uncertainty handback, and separate model/token/latency evidence.
For chat `/jev` controls, explicit models, a natural goal and continuation through
the existing agent, use the bounded [session supplement](JEV-SESSION.md). Its
offline checks and pending live cells are recorded separately.

Keep three results separate:

| Result | Evidence required | What it does not prove |
| --- | --- | --- |
| Installed browser reconnect | Actual Helena live view, one old synthetic tab, same target/document, a new visible frame and a UI click after both idle and router restart | JEV inference |
| Native browser safeguards/completion | Exact-candidate tests using an existing real Chromium; independent success and terminal `likely_done`; scoped API tests | Provider availability or a successful installed UI reconnect |
| Installed JEV browser execution | A real typed decision using the configured connection, followed by bounded execution on the synthetic page and independent verification | Trading prediction, external persistence or arbitrary task success |

A reachable model list is insufficient. An inference response `402 billing_error`
is a **provider blocker**, even when local browser checks pass. Do not relabel it
as success, retry indefinitely, change keys, buy credits or fall back to another
provider and call that JEV evidence.

## Scope and prerequisites

- Root alone performs staging, service restart and live writes. Confirm no agent
  runs/chats are in flight immediately before the restart; schedule it serially
  with deployments and other acceptance work. Tell the owner the short restart
  window. Do not restart Chromium, KasmVNC, the API or the runner for this proof.
- Reuse the **own disposable project created for point 6**, or create a dedicated
  synthetic project through Helena. It must have its own provisioned browser,
  workspace and existing supported preview runtime. Use a second disposable
  project only for the cross-project guard check. Record their IDs/slugs.
- **Never close existing user tabs to satisfy the one-page condition.** Do not
  modify VOL, its workspace, Squarespace tabs or any private browsing project.
  Close only a blank tab that this proof itself created in the disposable
  project, before the baseline. If ownership is unclear, stop this proof setup.
- Use the existing authenticated owner session. No login, new account, dependency
  installation, package download or secret lookup is part of this runbook.
  Do not read browser profiles, cookies, `runtime.env`, API keys or service tokens.
- Record the deployed commit/marker and the installed router/frontend versions.
  They must include reconnect `c4a3ca3d` and native browser `37b1875e` (or their
  verified integration equivalents), plus the TypeSafe readiness/error fixes.
  Source tests against another revision cannot certify this deployment.
- Keep normal project/domain/privacy/approval policy. In particular, leave
  `allowLocalAddresses` disabled and preserve level 3. A project's own registered
  dev-preview origin is the narrow existing exception; another project's origin
  must not gain that exception.

## Stage the observer safely

`observe.mjs` uses only Node built-ins and the existing loopback Chromium CDP.
It never opens a tab, navigates, clicks, types or changes lifecycle state. It reads
only the selected project's `runtime.json`, checks that the browser has exactly
one page at the expected fixture URL, and evaluates a fixed expression that
returns synthetic markers. No cookie/profile command or arbitrary evaluation
input exists. Output contains only fixture metadata, IDs, counters and booleans.

Review and pin the acceptance commit first. Extract only these three files from
that **Git commit**, not from a working tree:

```text
deployment/volition-stack/browser/acceptance/observe.mjs
deployment/volition-stack/browser/acceptance/observe.test.mjs
deployment/volition-stack/browser/acceptance/fixture.html
```

For example, on the Mac review clone, substitute a reviewed full commit SHA:

```sh
acceptance_commit='<reviewed full SHA>'
acceptance_export="$(mktemp -d "${TMPDIR:-/tmp}/helena-browser-proof.XXXXXX")"
for proof_file in observe.mjs observe.test.mjs fixture.html; do
  git show "$acceptance_commit:deployment/volition-stack/browser/acceptance/$proof_file" > "$acceptance_export/$proof_file" || exit 1
done
node --test "$acceptance_export/observe.test.mjs"
shasum -a 256 "$acceptance_export/observe.mjs" "$acceptance_export/fixture.html"
```

Have root install the reviewed bytes into a **new** private directory below
`/opt/helena-proof/browser-acceptance/`. Verify the same SHA-256 values on Kingston.
All ancestors and `observe.mjs` must be root-owned, without symlinks or group/world
write permission; the observer checks this. Do not execute code from the Mac
checkout, a user-writable server checkout, or an unverified upload as root. Do not
source user shell files or let `NODE_OPTIONS` preload code. Use the verified
root-owned Node runtime and a clean environment. No package import/install is
needed. The test file runs unprivileged before staging, not as a root test suite.

Create a **new** root-owned `0700` evidence directory, e.g.
`/var/lib/helena-proof/browser-acceptance/<unique-run-id>`, with `umask 077`.
Do not use `install -d` on an existing `/tmp` or change an existing parent's mode.
The command examples below run in that root-controlled evidence directory;
`observer` names the reviewed staged file and `node_runtime` the verified absolute
Node path. Both are operator-selected fixed paths, not project input.

```sh
umask 077
observer='/opt/helena-proof/browser-acceptance/<reviewed-sha>/observe.mjs'
node_runtime='/usr/local/bin/node'  # verify the installed root-owned path first
proof_slug='<own-disposable-project-slug>'
fixture_url='http://127.0.0.1:<own-preview-port>/fixture.html'
```

Run each observer command under `timeout 25s` as shown below. Its individual
network operations also time out. Any nonzero exit, timeout, malformed report or
missing UI evidence is a failure/inconclusive result, never a pass.

## Serve the own synthetic fixture

Copy `fixture.html` as ordinary project data into the disposable app's existing
static/public directory. Start its existing preview with Helena's `preview_start`,
for example the following arguments when that disposable project already has an
autodetected supported app:

```json
{"name":"browser-proof","idleTimeoutSec":900}
```

Use `preview_status`/`preview_url` to obtain the actual project-bound loopback URL.
Do not guess a port, launch a detached server, install Vite/Astro, or pass an
unsupported `python -m http.server` command to `preview_start`. A missing supported
runtime is a fixture-setup blocker, not a reason to weaken the launcher. Preserve
the preview for the entire idle test (its idle timeout must exceed this test).

Open `/fixture.html` **once during setup**, in the disposable project's browser
using the ordinary Helena UI. After this, there must be exactly one page in this
project. No new tab is allowed during the reconnect phases. The observer accepts
only a loopback HTTP fixture URL with an explicit port and no query/fragment or
credentials. The fixture has a counter, a fresh document nonce, a heartbeat and
an `Ada Proof` field; it performs no network request or submission after loading.

In Helena's actual live view, verify the page is moving, click **Increase counter**
once, and see the increment. Do not use VNC or direct CDP input as a substitute
for this live-view test. Capture a cropped image containing only this fixture
and the connection indicator. The existing client retains its last frame during
reconnection, so an image of the old counter alone is insufficient evidence.

## A1. Idle and reconnect the same old tab

1. With the fixture visible, take the baseline:

   ```sh
   env -i PATH=/usr/local/bin:/usr/bin:/bin timeout 25s "$node_runtime" "$observer" snapshot "$proof_slug" "$fixture_url" > idle-before.json
   ```

2. Close this project's live-view panel/viewers, **not its browser tab**. Confirm
   no agent holds its browser lock and no other viewer remains. Record the UTC
   time. Leave it without observation, screenshots, router/CDP requests or agent
   calls for at least **145 seconds** (120-second idle threshold plus polling
   margin). Keep commentary/waits in increments of at most 60 seconds.
3. Reopen the same project browser panel, selecting the existing fixture tab.
   Do not reload the page, refresh Helena, navigate or create a new tab. Allow
   at most 45 seconds for a genuinely new frame; record elapsed time. This is
   an acceptance ceiling, not a promised product latency. Observe heartbeat
   movement, click **Increase counter exactly once through the live view** and
   see its new value. No agent/native task may click during this interval.
4. Take and compare the report:

   ```sh
   env -i PATH=/usr/local/bin:/usr/bin:/bin timeout 25s "$node_runtime" "$observer" snapshot "$proof_slug" "$fixture_url" > idle-after.json
   env -i PATH=/usr/local/bin:/usr/bin:/bin timeout 25s "$node_runtime" "$observer" compare idle-before.json idle-after.json > idle-compare.json
   ```

   A pass requires the actual fresh UI frame/input evidence **and** comparator
   exit 0: same project, one target, same target ID, same document nonce and
   `performance.timeOrigin`, counter exactly +1, forward timestamps. The elapsed
   report interval must cover the recorded idle interval. The nonce/time origin
   detects reloads even when a target ID is reused. The report cannot establish
   that no ephemeral tab existed between its two samples; the no-new-tab
   operating procedure and UI observation are also required.
5. Record whether the original hang reproduced. If reconnect requires creating
   a new tab, page reload, router poke or manual retry, record a failure before
   any recovery. A stopped preview is a distinct setup failure.

Heartbeat delta alone does not prove Chrome was frozen: timer throttling exists.
This phase proves recovery after the configured idle interval with no viewers.
Do not claim measured lifecycle freezing unless separately instrumented evidence
exists. The synthetic observer must not itself be used to wake the browser.

## A2. Router restart with the old live-view tab still selected

1. Keep Helena's live-view panel open and the same old fixture selected. Take
   `restart-before.json` using the snapshot command. Record UTC and these selected
   metadata properties only:

   ```sh
   systemctl show volition-project-browser-router.service -p ActiveState -p MainPID
   systemctl show "volition-project-browser-chromium@$proof_slug.service" -p ActiveState -p MainPID
   ```

2. After the in-flight check, root runs the one authorized service restart:

   ```sh
   timeout 30s systemctl restart volition-project-browser-router.service
   ```

   A timeout is not permission to repeat the restart blindly; read the service
   state and classify the first attempt. Do not restart or kill Chromium/Kasm.
3. Without clicking a reconnect/reload/new-tab control, wait at most 45 seconds
   for the **existing live view** to recover. A retained old frame does not pass.
   Observe a new heartbeat frame, click the counter exactly once through this
   UI and see the increment. Take `restart-after.json` and compare just as in A1.
4. Record router PID changed, Chromium PID unchanged, exact target/document
   unchanged, one page, comparison exit 0 and the new UI/input evidence. Returning
   direct CDP data while Helena remains stuck is **not** a pass.
5. Repeat once with the router restarted after the idle interval, before opening
   the viewer. This covers the new router's initially unknown frozen-page state.
   Use separate before/after report names and the same no-new-tab constraints.

Switch to the second **own disposable** project and back if it is available.
Confirm both show their own fixture and that A's counter click did not change B.
Root CDP access itself is privileged and is not evidence of project authorization.

## B. Native behavior and task/domain boundaries

Run the existing tests against the exact deployed candidate in an **unprivileged,
isolated checkout**, with already installed dependencies and a private temporary
directory. Do not run Bun, a package script or repository imports as root.
Do not use the shared full-test DB. Coordinate heavy work with the root gate.

```sh
# In the private checkout, as wilhelmpa, after checking this installed executable:
TMPDIR="$HOME/agent-work/browser-proof-tmp" \
HELENA_BROWSER_TEST_EXECUTABLE=/usr/bin/chromium \
bun test packages/browser-gateway/src
node --test deployment/volition-stack/browser/*.test.mjs
```

Create the new private TMPDIR beforehand as this unprivileged user. The existing
native test starts its own Chromium with its own temporary profile; it does not
attach to a user's profile. Explicitly verify the native-browser suite actually
ran instead of being skipped. The integrated baseline was 230 gateway tests
(including 10 real-Chromium tests) plus 94 router tests; record actual counts for
the exact candidate instead of copying those numbers into live evidence.

Relevant existing coverage:

- `packages/browser-gateway/src/task/native-browser.test.ts`: actual Chromium,
  stale/replaced/covered targets, freshness, native select/indices, observed
  values and exact-field completion; no external model.
- `task/loop.test.ts`, `task/success.test.ts`, `task/run.test.ts`: independent
  completion, bounded WAIT/decisions, read-mode behavior, and the public caller's
  terminal `likely_done` with a continuation snapshot. Policy decisions in these
  tests are scripted; they are **not JEV inference**.
- `packages/browser-gateway/src/domain.test.ts`: own preview exception, foreign
  local origins and ordinary allow/block policy.
- API integration tests `modules/agent-browser-gateway/__tests__/integration/browser-gateway.test.ts`
  and `modules/browser-task/__tests__/integration/browser-task.test.ts`, plus
  `modules/agent-browser-gateway/contract-approval.test.ts`: project/agent binding,
  service-token rejection, exact issue/domain/action approval reuse, and real
  typed-provider readiness/error handling with synthetic mocked transport.
  Run these using the repository's isolated API harness and private PG **55565**
  only after confirming the port/database is free. Their test keys are synthetic.

For the installed domain check, use the existing **project-scoped Helena agent
tools**, in the disposable project, through normal authenticated Helena execution:

1. `browser_navigate` to A's own registered fixture URL is allowed.
2. From A, attempt `browser_navigate` to B's own **synthetic** preview URL. It must
   be rejected before navigation. Verify A's URL/target/document are unchanged.
   No private domain or real service is a test target. Do not change global local
   networking, write a fake production token or expose a service/agent credential.
3. A read-mode `browser_task` must not type or click. Record the task/project/run
   IDs, mode and safe result only, together with unchanged input/counter. If JEV
   fails first with 402, this installed action guard has **not been reached**;
   retain that distinction and use only the isolated test evidence above.

Level 3 deliberately does not exercise an approval hold. Exact approval reuse
across issue/domain/action is therefore certified by the isolated API regressions,
not by an owner's unrestricted UI or root CDP. Do not lower live project autonomy
or act on real Squarespace domains just to create that proof. If live task-approval
reuse is separately required, keep that cell open; this runbook does not silently
turn a private-DB regression into a live observation.

## C. Real JEV inference and independent completion

Only after local checks, use the **existing** server-side TypeSafe connection
(currently ID 46, configured `jev-latest`; recheck nonsecret metadata). Never pass
its key to the agent, a CLI, the fixture, a screenshot or a report. The connection's
normal Test action makes a typed inference with synthetic input; a model-list-only
response is not enough. Stop this phase on 402 and report the provider blocker.
Do not repeatedly call a failing service or substitute another model silently.

If inference succeeds, invoke the native `browser_task` tool through the actual
Helena project agent, limited to the disposable page. Verify the recorded tool
arguments are exactly the intended synthetic scope. Example (substitute only the
known own preview URL):

```json
{
  "goal": "Fill Name with Ada Proof and press Verify fixture. The page must show Fixture accepted Ada Proof.",
  "values": {"name": "Ada Proof"},
  "mode": "act",
  "maxSteps": 6,
  "success": {
    "url": "http://127.0.0.1:<own-preview-port>/fixture.html",
    "textIncludes": ["Fixture accepted Ada Proof"],
    "fields": [{"label": "Name", "value": "Ada Proof"}]
  }
}
```

Omit `startUrl` because the existing fixture is already selected; this avoids an
unnecessary navigation. The fixture's buttons are explicitly `type=button` and
make no submission. No `allowIrreversible` exception is needed. After execution,
require `done`, matching independent criteria, actual fresh UI/readback and a
server-side successful JEV decision in that task's nonsecret event metadata.
The observer's `nameMatches`/`accepted` booleans provide an additional local
readback. This is proof of the requested DOM outcome, not database persistence.

Then request only confirmation of this already completed synthetic goal:

- Without `success`, a model completion must finish as **`likely_done`**, with a
  snapshot and no automatic caller loop. Do not display verified success.
- With an intentionally impossible `textIncludes` criterion, a model DONE must
  **not** produce verified `done`; the bounded call hands back (for example
  `needs_agent`) or reaches a bounded stop. Use `mode:"read"`, `maxSteps:1` so the
  negative check cannot alter the page. Do not assert a specific model choice.

There is no separate `verify_success` tool. Verification is the deterministic
`success` contract in `browser_task`. The current Browser 2.0 Lab form does not
send this field; it can demonstrate legacy `likely_done` and real decisions, but
cannot alone certify `done`. An actual agent tool call with the shown arguments
or the exact-candidate native tests must supply the completion-contract evidence;
do not invent a hidden Lab field or a replacement generative runtime.

## Evidence, cleanup and pass sheet

Keep cropped synthetic screenshots and the small observer reports in the private
evidence directory. Do not save HAR files, full page dumps, auth headers, complete
settings JSON, environment dumps, browser profiles or raw provider errors. Record
only safe provider status/category/model and decision/run IDs. Never report a
secret-bearing exception string. All cells below start **NOT RUN**:

| Check | Result and actual evidence |
| --- | --- |
| Exact deployed revision and staged observer hash | NOT RUN |
| Own disposable project/fixture; one old tab | NOT RUN |
| Idle ≥145 s, no viewer/lock, fresh UI frame, exactly one UI click | NOT RUN |
| Idle same target/document, no reload/new tab | NOT RUN |
| Router restart: changed router PID, unchanged Chromium PID | NOT RUN |
| Automatic old-view reconnect + UI input + same target/document | NOT RUN |
| Restart while idle, then old-view reconnect | NOT RUN |
| Own preview allowed; foreign synthetic project preview denied | NOT RUN |
| Exact-candidate real-Chromium/native and scoped API regressions | NOT RUN; test evidence only |
| Installed task read-mode guard actually reached | NOT RUN; 402 before action is BLOCKED |
| Real TypeSafe typed inference | NOT RUN; 402 is BLOCKED |
| Installed JEV task with independent `done` | NOT RUN |
| Legacy `likely_done` terminal; false criterion never verified | NOT RUN |

Stop only the proof's own preview through `preview_stop`; confirm stopped with
`preview_status`. Preserve or archive the own disposable project for subsequent
acceptance as the root plan requires. Move unneeded fixture/evidence data to the
documented backup area rather than permanently deleting owner data. Close only
views/tabs created by this proof and only after the reconnect reports are final.
Never run broad `pkill`, reset an existing profile, close user tabs, or change
production project settings as cleanup.

Transport and scope were reviewed against existing
`isolation/proof/cdp.mjs`, `isolation/proof/proof_browser.py`, router/idle/screencast
tests, `apps/web/src/hooks/useBrowserScreencast.ts` and the native gateway tests.
The isolation proof's cookie/login migration operations are intentionally not
part of this acceptance. No third-party runtime or new dependency is introduced.
