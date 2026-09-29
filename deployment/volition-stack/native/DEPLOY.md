# Deploying Helena (native install)

One way in: `deploy.sh`. It checks, moves the live checkout forward, installs, restarts, checks
again and rolls back on its own when something fails. No hand-written wrapper scripts around
it: what the one-off root scripts of September 2026 did (exact-commit guard, in-flight check,
holding the bootstrap timer, the after-check) is part of it now.

```sh
sudo deployment/volition-stack/native/deploy.sh --expect <full sha> <branch>
```

## What it does, in order

1. Refuses a live checkout with uncommitted changes, a second deployment at the same time, a
   branch that is not exactly `--expect`, a commit it rolled back before (unless `--retry`),
   and a target that is not a fast-forward.
2. Waits (up to `--wait-inflight`, 600 s) until no agent run is claimed and no chat answer is
   being written (`--allow-inflight` skips this).
3. When the runner's code changes: holds `volition-hermes-bootstrap.timer`, drains the runner
   (`runner-drain/`), and gives the timer back once the new runner runs.
4. Fast-forwards the checkout, installs dependencies, migrates the database (one transaction;
   `migrate.ts` writes a backup first), installs units and helpers, builds or installs the web
   release and the runner bundle, restarts what changed, activates the drained runner.
5. Checks: every service active, API and web answer, and a headless Chromium loads `/login`,
   `/` and `/chat` through nginx, signed in as the LAN owner where the instance has one
   (`smoke/web-smoke.mjs`): an uncaught exception, a script that did not load or Next's
   error page fails the deployment.
6. Writes the marker `/var/lib/volition/deploy/deployed` = the commit now live.

## When it fails

Any failing step after the checkout moved, and failing checks, start the way back: the
checkout is reset to the marker's commit (the one sanctioned reset of the live checkout) and
the script runs again for that direction, with the same changed paths: units and helpers of
the good commit are installed again, the previous web release and runner bundle are put back
instead of rebuilt, the services restarted, the checks repeated.

| Exit | Meaning |
| --- | --- |
| 0 | Deployed and checked. |
| 1 | Refused or failed before anything changed. |
| 2 | Failed, rolled back; the last good commit answers again. The failed commit is listed in `/var/lib/volition/deploy/rolled-back` and refused until `--retry`. |
| 3 | Failed and the way back failed too, or `--no-rollback`: needs a person. |

Not rolled back:

- **The database.** A failed migration changed nothing. A migration that succeeded before a
  later step failed stays; the backup `migrate.ts` wrote before it is named in
  `journalctl -u volition-plan-migrate.service`. Migrations are meant to be additive, so the
  previous code runs on them; the checks after the rollback show whether it does (exit 3 if not).
- **A drained runner.** Its drain state names the failed target, so it stays stopped (runs wait
  in the queue, none is lost) and the bootstrap timer stays held until a person reviews it:
  `sudo python3 deployment/volition-stack/native/runner-drain/runner-drain.py status`
  (see `runner-drain/README.md`), then `systemctl start volition-hermes-bootstrap.timer` and
  remove `/var/lib/volition/deploy/bootstrap-timer-held`.

`--no-rollback` stops at the first failure instead and leaves everything as it is.

## Building the web app elsewhere

`next build` is too heavy for Kingston. Build the Linux x86_64 release on the Mac and
transfer its tarball as described in [README.md](README.md). The deploy checks the commit,
lockfile, file hashes and native module architecture before drain and checkout. The web app
is only installed when `apps/web` or `bun.lock` changed; otherwise the artifact is not needed.
