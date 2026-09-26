# Blueprint provisioning and runner reloads

2026-09-26. Backlog point 6.

A blueprint creates the project, areas and agent assignments through Helena's services.
Those services queue native provisioning. Before writing any knowledge or board file, the
blueprint waits for the **current** project provisioning job to succeed, then requires an
existing, non-symlinked project vault directory. It never creates that project root itself.
A final barrier also covers plans that change agents without adding knowledge files.

The native provisioner owns root creation and grants the project runner its ACLs. Letting
the API create the root first makes the launcher correctly reject a foreign owner. The
fix preserves that ownership check and never broadens the accepted UIDs.

Pending provisioning has a five-minute deadline. Missing/failed provisioning or a missing
root produces an actionable error; prior additive changes remain available for the next
blueprint run. The project Setup status in Helena remains the diagnostic source. Existing
files remain unchanged when a blueprint is resumed.

A descriptor update writes a durable reload generation after resource/ACL provisioning.
The runner stops claiming new work, finishes its current runs/chats, then exits; systemd's
existing `Restart=always` loads the new catalog. The wrapper captures the generation before
catalog construction so changes during startup cannot be missed. A stuck drain has a
two-hour ceiling, then aborts and releases claims through the existing shutdown path.
Provisioning no longer sends SIGTERM to other agents' active work.

## Verification and deployment

- API integration: real sessions/DB and temporary vault; no root before provisioning,
  notes and boards after completion, retry, failed/pending/missing/symlinked roots, and
  descriptor waiting when no knowledge files are requested.
- Native integration: descriptor/area/file provisioning, reload order, failed partial
  provisioning and deprovisioning, wrapper environment.
- Runner process: graceful drain and bounded stuck-claim release.
- `deploy.sh` already rebuilds the runner, installs its changed wrapper, and restarts the
  API/worker/provisioner and runner when these paths change. No dependencies or migrations
  are added. Deploy only after the central in-flight check.
- Live proof still required by the orchestrator: a disposable project blueprint must reach
  successful Setup, correct vault ownership/ACLs and runner descriptors, then expose its
  note and board. A second dry-run must be additive/idempotent. Do not use real model calls
  merely to prove provisioning.
