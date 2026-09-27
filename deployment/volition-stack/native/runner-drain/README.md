# Native runner deployment drain

This helper operates only `volition-hermes-runner.service`. It requires the separately
released runner capability described in `docs/helena-decisions/runner-graceful-activation.md`.
The normal helper has no override for an old running runner. The separately pinned
one-time procedure is described in `BOOTSTRAP.md`.

`deploy.sh` determines the exact target before changing the checkout. Only runner
code, its bundled SDK/dependency lock, native unit, wrapper or catalog changes enter
this drain. A browser-only release follows its independent service path. The API,
checkout, bundle and database remain available in their previous state until drain
finishes. Deployments are serialized; running jobs are not globally blocked.

The dedicated `volition-hermes-bootstrap.timer` and bootstrap service must be
held inactive by Root throughout drain/deployment/activation; record their original
state and restore only the previously active timer after success. These start
sources otherwise conflict with a pending stop job. The helper checks them and
refuses; it does not stop unrelated units or change timer enablement.

Before the helper's first `daemon-reload`, Root must persist and verify any intended
resource-limit changes. A reload can replace an effective runtime `MemoryHigh`
with a differently ordered persistent drop-in. In the point-3 bootstrap this reset
Lemonade from runtime 11 GiB to persistent 10 GiB without restarting it; deployment
correctly stopped before fast-forward. Stage the reviewed persistent 11 GiB file
first, verify its hash and effective limit after reload, and retain the 12 GiB hard
limit. Do not replay a completed bootstrap or signal to recover this situation.

Root must run the reviewed deployment script from a stable staged source that is
not changed during that deployment. Do not fast-forward live before invoking it.
The script checks the old deployed commit, drains, fast-forwards, builds/installs,
restarts the other affected services, checks API readiness, and explicitly activates
the new runner. Its bundle and unit must match the recorded activation state.

## State and ownership

`/var/lib/volition/deploy/runner-drain/` is root-owned mode 0700. `state.json` and
`override.backup` are mode 0600. The state binds the tested target, old checkout,
MainPID, Linux start ticks, systemd InvocationID, cgroup, unit/drop-in hashes and
bundle hash. Completed states are retained by content hash before the next drain.
The backup contains only the exact helper-owned runtime override; an existing
foreign file at that reserved name is refused.

The reserved runtime file is
`/run/systemd/system/volition-hermes-runner.service.d/90-helena-deploy-drain.conf`.
The helper verifies effective SIGINT, infinite stop timeout, disabled SIGKILL and
SIGHUP, `KillMode=mixed`, and absent ExecStop/ExecStopPost commands before requesting
one `systemctl stop --no-block`. It durably records that request before dispatch.
This follows systemd's documented [stop signal and escalation rules](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.kill.xml).

`deactivating` is still running work. Success requires `inactive/dead`, zero main
and control PIDs, the same original nonempty InvocationID, no job, successful exit,
an empty original cgroup, and a final capability matching the old PID/start ticks
in `running` or `draining` phase. A descriptor deadline which already began releasing
work is refused even if the process later exits successfully. The helper
never sends a second signal, cancels a stop job, kills residual processes, or
removes the runtime override during an active drain.

## Recovery

Use the helper from the same reviewed staged source and the exact recorded SHA:

```sh
sudo python3 /root/helena-reviewed-release/runner-drain/runner-drain.py status
sudo python3 /root/helena-reviewed-release/runner-drain/runner-drain.py drain \
  --target <full-tested-target-sha> --before <full-previous-deployed-sha> --deadline-seconds 120
```

| State | Meaning and next step |
| --- | --- |
| `prepared` | The durable intent/backup exists. Retry verifies identity and owns only its exact runtime file before dispatch. |
| `stop-requested` | Dispatch may have happened. Retry only observes the existing stop job or natural completion. An active unit without that job is ambiguous: stop, inspect the recorded invocation and journal; do not resend a signal or delete state to bypass this refusal. |
| `waiting` | Work is still finishing. The operator deadline leaves work and the stop job running, with its infinite stop timeout intact. Repeat `drain` to observe completion. |
| `drained` | The old invocation/cgroup is empty. The same target deployment can continue. If a later build/install fails, keep the override and runner stopped while completing or explicitly reviewing recovery. |
| `ready` | Deployment and API readiness have been checked; bundle and unit hashes are bound. Retry `activate` only for this exact target. |
| `released` | Activation was recorded before removing the owned override. Retry verifies the same ready hashes, removes only that exact file if still present, reloads systemd and uses idempotent `start`, never `restart`. |
| `complete` | A fresh capable invocation is running. The next deployment archives this state and creates its own binding. |

After completing and checking a failed deployment, Root can explicitly mark and
activate the same target:

```sh
sudo python3 /root/helena-reviewed-release/runner-drain/runner-drain.py ready --target <full-tested-target-sha>
sudo python3 /root/helena-reviewed-release/runner-drain/runner-drain.py activate --target <full-tested-target-sha>
```

Do not use `ready` merely to clear a failure. Verify the target checkout, successful
build/install, database state and API readiness first. A changed backup, override,
ready bundle or unreviewed unit/drop-in is refused and preserved. A partial durable
write with different bytes requires inspection of the private state; it is not
silently overwritten. A host reboot removes `/run` overrides and invalidates the
old PID/invocation; this requires fresh Root review, not replay of the old stop.

## Acceptance limits

Real unprivileged Linux runner processes prove repeated SIGINT, held run/chat
completion, failed-feed joining and actual PID/start-tick capability metadata.
Python fixtures execute the helper's state transitions and the real deploy prefix
against temporary Git repositories. They cover deadlines, uncertain dispatch,
crashes, residual processes, mismatched identities, tampering and independent
browser releases. No live unit or owner work has been changed. A Root-controlled
private systemd probe and final live activation remain separate acceptance steps.

If activation reached `complete` but the deployed marker was not written, do not
rerun the whole deploy and rebuild an active runner. Root must compare the target,
ready bundle/unit hashes, new running capability, database migration and service
health evidence, then finish only the deployment audit/marker step. A different
target needs its own normal drain. The helper intentionally refuses the ambiguous
same-target full-deploy replay.

No command timeout is changed. The descriptor-compatible runner cancels its marker
poll, deadline and ten-second exit timer on the first explicit SIGINT, including
callbacks already queued or a marker read still pending. Ordinary descriptor reloads
retain their bounded release behavior. Their capability changes to `releasing`
before any abort; failure to write it leaves work running. If release already began,
SIGINT stops further timer escalation but cannot undo that release or relabel it as
a safe deployment drain. The helper therefore refuses completion and preserves its
state/override for explicit Root review. The separately pinned legacy CLI has no
descriptor timer and continues to use its own source/process/DB completion guards.
