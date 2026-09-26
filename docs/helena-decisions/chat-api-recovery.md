# Chat recovery during a short API outage

The runner continues producing an answer while the API restarts. It retries event
delivery and the completed result without executing the command again. A chat's
existing `attempts` value fences its reports. Event batches carry their starting
offset; a message-row lock makes a repeated identical batch an acknowledgement,
without appending its text or tool results again. A conflicting replay is refused.
The session is considered reported only after its batch is acknowledged.

`AnswerStream` removes only an acknowledged batch from its queue. The chat's
200-event limit applies there, so a later failed batch cannot requeue an earlier
acknowledged part. Result retries accept the same terminal status and claim without
repeating completion side effects. Older clients retain their existing protocol;
the recovery guarantees require the updated runner and API together.

No database migration is required. The product change and its core tests use the
schema already present at `e032c65d`. The additional `chat-recovery-jev.test.ts`
belongs only to the prepared JEV queue: it checks that replay preserves a later
owner policy change and its revision.

## Private acceptance

The API integration test runs the actual application in a separate process against
a private test database. A synthetic runner command emits text and a tool result,
then waits. The test reads the live SSE stream, stops that API process, lets the
same command finish while the API is unavailable, and starts another API process
on the same loopback port. It requires one execution marker, one stored tool
result, `attempts=1`, final success, and a stream resumed with `Last-Event-ID` that
does not repeat the earlier tool result.

Further tests cover simultaneous identical batches, conflicting replay, stale
claims, lost result acknowledgements, session acknowledgement, and a failure
after the first of several 200-event batches. They use synthetic data and no model
or provider. These are API/runner proofs, not a live browser UI acceptance.

## Deployment boundaries and activation

| Changed service | Consequence and acceptance |
| --- | --- |
| Project-browser router / nginx only | Preserve API, worker, runner and terminal process start times. Browser reconnect and input require their own acceptance. A chat need not finish solely for this transport change. |
| API, updated runner kept alive | The private test covers a short outage during an active chat. Persisted events survive the API process. The browser already resumes by event cursor; after its bounded automatic retries it offers reconnect, which must not regenerate the answer. |
| Runner bundle or service | This patch cannot upgrade the already-running runner in memory. `deploy.sh` rebuilds and restarts it when `packages/runner` changes. Do not treat the API-only proof as approval to interrupt active work. |
| Worker, runtime, model or database migration | Assess that component separately; the chat-report proof gives no general safe-restart guarantee. |

The existing runner handles one `SIGINT` by stopping claims and finishing active
work. The normal systemd stop uses `SIGTERM`, `KillMode=mixed` and a 45-second
deadline; it is not the same operation. A second signal while draining exits the
runner. No graceful systemd activation change is included or live-proven here.

Root should stage and test the release, preserve active work, and activate the
new bundle only after the affected runner has safely finished its current work.
If a dedicated graceful-drain operator is needed, prove its signal, restart and
timeout behavior privately before using it. Keep the API available to the old
runner while it drains. Unrelated router/nginx releases can proceed separately.

The default chat lease is 300 seconds. The proof covers an API outage shorter
than that lease with the runner alive. It does not prove recovery after loss of
both processes, a hard runner restart, or a lost acknowledgement from an external
mutating tool. Queued runs already retry their terminal result under a claim;
their timeline remains best-effort, including its existing event/size limits and
possible loss at a failed final flush. Do not claim universal exactly-once tools
or complete run timelines from these tests.

## Command timeout and continuation

The runner default is `timeoutMs = 30 * 60 * 1000` in
`packages/runner/src/config.ts`; `ITSAPLAN_TIMEOUT_MS` can override it. Both local
and isolated execution in `execute.ts` enforce this wall-clock limit. Expiry stops
the command and produces `Timed out after <timeoutMs>ms`. Transport heartbeats and
event delivery do not extend that execution deadline.

A timeout is reported as a failed answer. It does not automatically requeue owner
work. The separate `sessionLost` recovery applies only when the runtime reports a
missing session; Hermes recognizes `Session not found`. For a later user turn,
`resumableSession` in the chat service retains the prior session only when that
agent's last answer is also the latest answer in that session. Otherwise the new
session receives the recorded conversation. Neither path rolls back or proves
exactly-once repetition of earlier tool side effects.

Root observed chat 352 fail after about 30 minutes on 27 September, with timeout
metadata and no API or runner restart during the preceding router deployment.
This is consistent with the command deadline, and is separate from the API-report
fix. Its safe task continuation remains open; this change neither raises the
limit nor retries that owner task.
