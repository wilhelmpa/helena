# Volition integration service

Private host-side integration for It's a Plan. It binds to a loopback or RFC1918 address and is intended to be reachable only from the dedicated `volition_control` network.

## Endpoints

- `POST /api/provision` provisions a project workspace, registry, OpenClaw coordinator and main session, native browser dashboard, and verified Nextcloud folder with `Dokumente`, `Ergebnisse`, and `Archiv`. It requires the provisioning bearer, `Idempotency-Key`, `X-Itsaplan-Event` and `X-Itsaplan-Event-Id`.
- `POST /inbox/gmail/push` records a validated Gmail Pub/Sub notification in the durable queue before returning `204`. It uses the dedicated push bearer and best-effort wakes the worker.
- `POST /api/inbox/sync` reads Gmail history and message metadata through `gog` with the exact read-only command allowlist. It uses the worker integration bearer.
- `POST /api/inbox/triage` queues read-only triage. With `INBOX_TRIAGE_CONTROL_PLANE=mastra`, it runs the provider-neutral Mastra `inbox-triage` workflow; Mastra calls the private `inbox-triage.v1` classifier capability and never receives Gmail or model credentials. `GET /api/inbox/triage/:runId` returns its status. Results are checked again host-side against the supplied project keys and source issue identifiers.
- `GET /healthz` is unauthenticated and returns only service health.
- `GET /api/connections` and `POST /api/connections/actions` expose redacted OpenClaw MCP/channel plus Nextcloud health. Actions are limited to probe and native channel reconnect; no arbitrary command is accepted.
- `/api/mail/*` provides owner-facing Gmail search, sanitized thread reads, label access, bounded attachment downloads and draft handling through the existing `gog` profiles. Sending a draft requires a fresh, single-use, two-minute confirmation token obtained by reading that exact draft first. These routes are not OpenClaw tools.
- `artifact-sync-run.mjs` copies versioned Plan documents to private project namespaces in Nextcloud. It uses immutable filenames, source fingerprints, exact private file links and conflict-preserving writes. See `ARTIFACT_SYNC.md`.

The Gmail push, worker integration and provisioning bearers are independent. Secret values live only in owner-readable files referenced by systemd credentials or the private worker environment. Message content is never written to the push queue or service logs. RPC triage uses the official OpenClaw Gateway client pinned to the installed release, starts one lazy persistent loopback connection, and observes the accepted run without starting a fallback run. The `cli` transport remains available for rollback; its prompt files use mode `0600` and are removed after each run.

The Mastra bridge uses a separate private bearer and a deterministic workflow
run ID derived from the validated triage input. Gmail Pub/Sub still has exactly
one consumer, the existing Plan Postgres tables remain the authoritative inbox
dedupe and retry store, and the Plan worker remains the only ticket writer.

## Service units

`systemd/volition-provisioning.service` runs the API. `systemd/volition-inbox-watch-renew.timer` invokes the hardened one-shot watch renewer daily with a randomized delay. The renewer enables only `gmail.watch.renew`, disables Gmail sending and never prints command output. `systemd/volition-artifact-sync.timer` runs the isolated archive service hourly with a randomized delay.

Copy `.env.example`, set only the required paths and public origins, and keep real values in private environment or credential files. Run `npm test` before installing or restarting the unit.

The inbox classifier must have no tools in its effective OpenClaw policy, including MCPs, shell, files, messaging, and delegation. It only returns bounded JSON. Do not point this integration at a coordinator or the legacy inbox agent with write capabilities. A read-only prompt is not a permissions boundary.

Mail HTML is never rendered by this service: `gog --sanitize-content` returns text and removes remote URLs. Attachment responses are `attachment`, `private, no-store`, `nosniff`, and capped at 20 MiB. The service only uses OAuth permissions already present in each profile; missing scopes return `unsupported_scope` and never trigger a reauthorization flow.
