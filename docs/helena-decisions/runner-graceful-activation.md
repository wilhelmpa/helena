# Graceful native runner activation

The runner accepts repeated SIGINT requests without exiting early. It stops taking
new claims and joins all already claimed work, including a response from a claim
request that was already in flight. A failed feed also waits for its active tasks;
other feeds of that agent finish before the process can exit. Other agents retain
their independent feeds until an explicit process drain.

The native unit enables `HELENA_RUNNER_DRAIN_STATUS`. Before taking its first
claim, the runner writes version 1, its PID, Linux `/proc` start ticks and phase
`running` into a private file. SIGINT changes the phase to `draining`; an explicit
SIGTERM uses the existing release behavior and records `releasing`. A status write
failure after a signal does not terminate running work. No secrets or task content
are included in this file.

## Two releases

1. Introduce the runner capability and idempotent SIGINT first. Root must establish
   a safe initial activation window for the old runner, whose second SIGINT can
   still exit early. This change does not make an already-running old process
   safe, and does not change the unit's existing default stop signal or deadline.
2. Activate the separately reviewed deployment helper only after the actual
   running process provides the matching capability. Its guard must bind PID and
   kernel start ticks, not merely inspect the bundle installed on disk.

The helper must preserve the old checkout and API while that runner drains. Its
operator deadline must leave the ongoing work intact. It may install the new
bundle and explicitly start the runner only after the old invocation and its
cgroup are empty. The systemd helper is a separate change; no live activation is
claimed by this runner capability commit.

## Private proof

The real runner process against a synthetic local API finishes both a held run
and a held chat after repeated SIGINT, without another claim or release. A second
case holds a run while another feed's pending claim fails with 401: the process
still waits for the run's final result. Both cases fail against the old runner.

Linux additionally verifies the actual PID, `/proc` start ticks, capability
version and `running` to `draining` transition. Five targeted Linux process cases
pass, including the existing explicit SIGTERM and reclaimed-run behavior. Runner
production/test TypeScript checks, scoped lint and formatting pass. These tests
use no real provider, database or owner work.

The separate 30-minute command timeout is unchanged. This preparation does not
resume a timed-out owner task or guarantee recovery after a hard runner failure.

## Descriptor reload compatibility

The prepared runner's descriptor watcher is cancellable. Explicit SIGINT cancels
the poll, reload deadline and ten-second forced-exit timer before entering the
deployment drain. A pending marker read or already queued timer callback cannot
rearm them. A real synthetic process holds a run and chat beyond an already armed
descriptor deadline, then finishes both exactly once without release or new claims.

An ordinary descriptor deadline first records `releasing`, then aborts unfinished
work. A failed status write leaves work running. If that release already happened,
SIGINT cancels the forced-exit timer but preserves `releasing`; it cannot reclaim
work already returned to the queue. The deployment helper rechecks the old process's
exact capability during and after completion and refuses this unsafe phase even
after exit 0. No second signal or implicit recovery is introduced.

Deterministic timer tests cover the read/dispatch races, already queued callbacks,
status-write failure and unchanged ordinary descriptor deadline behavior. The
Linux-only process proof additionally verifies that an already releasing runner
never reports `draining`. This addon must be integrated together with its helper
completion check; the capability-only point-3 runner has no descriptor watcher.

Targeted private Linux acceptance passed: 11 runner/process/timer cases with 62
assertions, both pre-existing descriptor reload cases with 8 assertions, and 30
Python operator cases. Runner production/test TypeScript, scoped lint and repository
formatting passed. The new held-work process regression fails on the unmodified
combined core/descriptor baseline because it releases work after SIGINT; the helper
baseline also incorrectly accepts `ready` after the recorded phase becomes unsafe.
No provider, database, live unit or model was used by these checks.
