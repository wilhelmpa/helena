# One-time legacy runner bootstrap

Root uses `bootstrap-legacy.py` only for the reviewed old CLI whose SHA256 is
`ae24a1c10ce69f3038bbb563d40ac8ef6e0c2018385aea458f933a71ae55d0ef` (source at
`76380971`). It has a graceful first SIGINT, a destructive second SIGINT and no
safe-drain status file. The ordinary `runner-drain.py` continues to require the
running process's capability; it has no legacy bypass flag.

The old implementation also has a fail-fast feed error boundary. Keep the old API,
authentication, checkout, unit and bundle available throughout this procedure.
Do not change credentials or stop/restart API, runner or project processes while
it waits. A successful zero-work observation is a precondition, not a claims lock:
a claim already in flight can still arrive. The first SIGINT prevents subsequent
claims, and the same old process must finish the work it accepted. The helper
waits for that exact invocation to exit successfully and its cgroup to become
empty, then checks claimed database work again. It never kills or releases work.
A failed process, leftover child or unfinished database claim stops deployment.

## Root procedure

Use one serial Root deployment session. Keep all other deployment/runner operators
idle until the new capable runner is verified. Stage these reviewed files in a
root-owned directory inaccessible to other users, preserving their reviewed hashes:
`bootstrap-legacy.py` and `runner-drain.py`. Do not execute from the live checkout.
The operator requires Python stdlib, existing systemd tools and local PostgreSQL
peer access as `postgres`. It reads only fixed aggregate counts, process/unit
metadata, source/bundle bytes and matching stop-history lines. It reads no keys,
configuration profiles, prompts, task bodies or document content.

1. Verify the full tested target commit includes the separately reviewed capability
   core. Record the old live HEAD and an independently checked SHA256 of the actual
   root-owned `packages/runner/dist/cli.js`. Source and bundle must still be the
   versions used by the current process; the operator also rejects a bundle whose
   mtime is newer than its Linux process start. Keep the old deployed marker.
2. Prepare a durable plan, substituting the exact full tested target and old bundle
   digest. Review its IDs, hashes and counts before the next command:

   ```sh
   sudo python3 /root/helena-legacy-bootstrap/bootstrap-legacy.py plan \
     --target <full-tested-target-sha> --old-bundle-sha256 <reviewed-old-bundle-sha256>
   ```

3. Drain once. The operator verifies the pinned source, bundle, PID/start ticks,
   InvocationID and unit files again, installs its own reserved runtime override,
   and verifies effective SIGINT, infinite stop timeout, no SIGKILL/SIGHUP,
   `KillMode=mixed` and no ExecStop hooks. The stop intent is durably written before
   the single `systemctl stop --no-block` dispatch:

   ```sh
   sudo python3 /root/helena-legacy-bootstrap/bootstrap-legacy.py drain --deadline-seconds 120
   ```

   The 120-second limit ends only this observer. It leaves the stop job and its
   infinite timeout intact. Repeat the same command to observe completion: it
   cannot dispatch another stop. `stop-requested` without a stop job is ambiguous;
   inspect it without resending a signal, canceling the job or deleting state.
4. Verify `status` is `drained`. Successful completion requires `inactive/dead`,
   the original nonempty InvocationID, MainPID/ControlPID zero, no systemd job,
   successful exit code zero and no processes anywhere in the captured cgroup.
   Claimed runs, streaming/previously claimed pending chats, claimed runtime
   requests and claimed reflections must all be zero. Fresh unclaimed queued work
   is counted separately and stays queued for the new runner.
5. Explicitly release only the exact owned runtime override while the old source
   and bundle are still unchanged:

   ```sh
   sudo python3 /root/helena-legacy-bootstrap/bootstrap-legacy.py release
   ```

   This command starts nothing. It rechecks process/cgroup and database state,
   records `released` durably, removes only its byte-identical file and reloads
   systemd. A crash after intent or unlink is safe to retry before source changes.
6. Root may now fast-forward/build/deploy the exact tested capability release via
   the established deploy path. The old runner is already inactive, so its ordinary
   restart must only start the new bundle. Verify the new live HEAD/deployed marker,
   API readiness, fresh runner InvocationID and its real capability JSON containing
   `version:1`, current PID/startTicks and `phase:running`. Confirm queued work resumes.
   Enable the separate normal graceful deploy hook only after this bootstrap.

Never remove the override during `prepared`, `stop-requested` or `waiting` to make
an error disappear. Never invoke the new normal helper against an incapable old
process. If deployment fails after release, the runner stays stopped; complete the
reviewed target and explicitly start the verified new unit. A new target, foreign
unit/drop-in, replaced bundle, reboot, changed PID or unknown InvocationID requires
fresh Root review. The operator does not undo or conceal these conditions.

## Private state and limits

`/var/lib/volition/deploy/legacy-runner-bootstrap/` is root-owned 0700; its plan,
state and exact override backup are 0600. The reserved runtime file is
`/run/systemd/system/volition-hermes-runner.service.d/89-helena-legacy-bootstrap.conf`.
Foreign files are refused. The normal helper uses a different state directory and
reserved filename. Retain the completed private bootstrap state for audit.

Local Python fixtures cover one dispatch, ambiguous/crashed dispatch, deadline,
late claims, release retries, source/bundle/process/Invocation changes, cgroup
residuals and altered files. The pinned old CLI was run as a private Bun child
against a synthetic loopback API: a held chat claim returned only after one SIGINT;
the held run and that chat each completed once, with no new claim or release.
This proves the old CLI signal/feed path with existing local dependencies. No live
unit, real task or PostgreSQL data was changed. The actual Root systemd transition
and final deployed bundle/capability remain live acceptance steps.
