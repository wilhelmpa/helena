# Chat JEV and native browser acceptance supplement

State: 2026-09-26, owner backlog reconciliation. Root execution plan; **live steps
NOT RUN**. Requires the reviewed integration of `a9a54816` and its follow-up, the
serial shared gate and deployment. Root alone runs UI/provider acceptance. Use the
existing [JEV fixture plan](JEV-LIVE.md) and [observer staging](README.md); no second
browser, credentials, workflow or runtime. Preserve all original budget limits.

## Call paths and expected boundaries

| Path | Existing control | Expected fallback or stop |
| --- | --- | --- |
| Optional chat pre-decision | `/jev inherit/on/off`, trusted assistant-message scope, team/class/cloud/eval/router gates | Existing independently configured class primary/fallback within the same total deadline |
| Explicit chat model | Saved message model bypasses `routeRequest` | Continue with that model; `/jev on` cannot select a replacement |
| Native `browser_task` | Project browser-control connection/policy; per-action authorization and project session | `needs_agent`/`backend_error` returns current refs to the caller; no new model runtime starts |
| Existing configured specialist | Router's existing configured-model and uncertainty/context rules | Keep its configured model when those rules say to retain it |

`/jev off` only revokes the optional chat pre-decision. It does not cancel a directly
selected browser connection or prohibit the same connection's independent regular
class assignment. Native task cancellation uses its existing run cancel/owner
takeover controls. Never use `/jev off` as an emergency browser stop.

## 1. Persisted chat control and explicit model

Use the own P6BROW26 chat and agent from JEV-LIVE. Record its current chat preference
and explicit model selection. Keep team and global defaults unchanged.

1. Send `/jev`, `/jev off`, `/jev`, then reopen the chat and send `/jev` again.
   The owned chat GET must report `jevFirstStage=off`; commands must produce no
   user/model message, new queued run or inference. Record the actual thread ID.
2. Send `/jev on` then `/jev`. Confirm saved `on`, and confirm any pre-existing
   disabled team/class gate remains disabled. `on` never enables those gates.
3. Select an already available explicit local model in this own chat. Send one
   synthetic, tool-free prompt: `Reply only with HELENA_SESSION_MODEL_PROOF.` Record
   the actual claimed model and router metadata for this exact assistant-message
   ID. Pass only if the explicit choice remains effective and this message caused
   no router pre-decision. A text assertion by the model is insufficient proof.
4. Restore the recorded explicit model selection and chat preference. To test
   `/jev inherit`, set it, reopen and verify it once before restoring.

Use normal authenticated UI/owned chat endpoints. Do not read raw request headers
or secrets. If the current UI does not expose message routing metadata, Root may
use its documented narrow metadata query for these exact own IDs; otherwise mark
the execution-path cell inconclusive. Saved preference alone proves persistence.

## 2. One ordinary browser goal

After guided A–D in JEV-LIVE and section 3's immediate continuation, reset only
the own fixture before a new baseline.
Do not count that reset as reconnect. Restore the project's original test threshold
before this goal. Preserve the same connection and project/browser identity.

Take `goal-before.json` with the staged observer, then send the following natural
request through the existing project chat without supplying a tool name or JSON:

> Auf der bereits offenen synthetischen Testseite: Trage Ada Proof in Name ein
> und betätige Verify fixture. Prüfe den sichtbaren Text Fixture accepted Ada
> Proof. Bleibe in diesem Projekt und Tab. Höchstens vier Browseraktionen, keine
> Navigation, neuen Tabs oder weiteren Aufgaben. Bei Unklarheit oder Fehler stoppe.

After completion take `goal-after.json` and run:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin timeout 25s "$node_runtime" "$observer" compare-task goal-before.json goal-after.json
```

Record actual native tools/arguments, caller model, project/agent/message IDs,
task IDs and independent DOM evidence. A native Jev proof additionally needs an
actual `browser_task` run with `source=agent`, `backend=decision`, `policy=jev`,
successful inference and correct configured/reported model. Step tools alone can
prove an ordinary browser goal, but leave natural native-Jev selection unproved.
Prompt limits are operator limits: inspect the actual native `maxSteps` and budget,
use the existing cancel mechanism if exceeded, and record a failed boundedness
check. Never run repeatedly until the model chooses the desired tool.

## 3. Existing-agent continuation after a handback

Run this immediately after phase D, before section 2's reset. Reuse its actual
handback; if none occurred, leave this cell open.
Record its returned snapshot/refs and original configured caller model. In the
same own chat clarify exactly one harmless action:

> Die fehlende Auswahl ist jetzt eindeutig: Increase counter. Führe genau diesen
> einen Klick mit den vorhandenen Einzelschritt-Werkzeugen im selben Fixturetab
> aus und stoppe. Keine neue browser_task-Anfrage oder Navigation.

Take `continue-before.json` immediately before this message and
`continue-after.json` after it. The existing `compare` mode checks same project,
target and document plus exactly one counter increment:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin timeout 25s "$node_runtime" "$observer" compare continue-before.json continue-after.json
```

Also require an actual step-tool click through the normal agent, valid current
refs and the expected unchanged caller model. Here the increment proves agent
continuation; it is **not** a UI reconnect result. If the configured specialist or
local caller is unavailable, report that restriction. A returned snapshot by
itself proves only handback, not that the caller successfully continued.

## 4. Project boundary and difficult branches

- Reuse the existing cross-project preview-denial phase from README. Only two
  own disposable projects may participate. The first project's agent attempts one
  `browser_navigate` to the second project's actual registered synthetic preview.
  Require denial, no second-project exception, unchanged source fixture, and no
  target data returned. Verify `allowLocalAddresses` remains false. Do not test a
  private/user project or widen the local-address allowlist.
- Optional-stage timeout, network/provider failure, low probability, `uncertain`,
  `specialist`, in-flight off/off-on and same-connection role collision have
  deterministic synthetic service regressions. Run them on the private test DB
  only after Root releases the heavy window. They are not live provider evidence.
- For live in-flight off, only use an already authorized synthetic class with an
  eligible optional stage. Send `/jev off` while its actual first-stage request is
  observed, verify its result is discarded and exactly one configured continuation
  occurs. Repeat off/on at most once. If the stage finished before the command,
  record **inconclusive**, not a race pass. Do not add latency or inject errors into
  a live provider, change credentials, install a proxy or enable global routing
  solely to force the branch. If this bounded condition is unavailable, leave the
  cell open with the deterministic private-test result separately stated.
- Natural provider errors or uncertain results encountered in the bounded run
  may prove their matching live branch. Record safe status and elapsed time, zero
  unintended actions, task handback and actual continuation, where authorized.
  A synthetic HTTP 504 test only proves handback of that response; elapsed timeout
  enforcement is covered separately by the held-provider service regression.

## Budget and evidence ledger

This supplement adds at most one ordinary browser goal, one continuation message,
one cross-project denial and one tool-free explicit-model message. Reuse previous
boundary evidence if it matches the deployed candidate. A single four-step Jev
task adds at most ten successful decision roundtrips to JEV-LIVE's 22; actual
provider retries and caller-model inference are additional. Keep the combined
20,000 input / 4,000 output operator ceiling and 120-second per-phase stop mark.
Skip remaining phases if reached or consumption is unavailable. Cancellation may
wait for the current provider request; never start another phase while active.

Record `PASS / FAIL / INCONCLUSIVE / NOT RUN` independently for persistence,
explicit-model bypass, guided Jev success, ordinary-goal tool selection, native
handback, actual local/specialist continuation, foreign-project denial, timeout,
provider error, low confidence, in-flight off and off/on. Include deployed HEAD,
observer hash, own IDs, timestamps and selected model/token/step metadata only.
Do not combine private tests with live cells. Restore saved own-project/browser
settings, chat preference and model after the final phase; preserve user data.
