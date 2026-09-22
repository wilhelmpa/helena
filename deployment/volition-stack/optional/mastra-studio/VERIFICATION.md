# Verification — deployed 2026-09-22

This source tree now contains six executable, typed Mastra workflows. `npm test`
verifies the complete registry and trigger map, deterministic idempotency keys,
safe dry-runs for all six workflows, and a real suspend/resume cycle whose
approved result remains `needs-attention` without executing an external effect.
`npm run build` and an isolated Docker build also pass.

The production container now runs `volition/mastra-studio:2026-09-22-v2` and is
healthy with zero restarts. Before replacement, the persistent Studio data volume
was archived to `backups/mastra-studio-before-v2-20260922T0145.tar.gz`. The
authenticated public Studio shows the six new two-step workflows. A `system-audit`
dry-run completed successfully through the public UI with both steps visible in
the timeline and no external effect.

# Original read-only deployment verification — 2026-09-21

Installed on Keller at `/home/pw/services/volition-stack/optional/mastra-studio`.
Protected entry: <https://plan.volition.one/mastra/workflows>.

## Passed

- Real `mastra build --studio` production build, Core 1.67.0 / CLI 1.30.0, isolated from production Plan's Core 1.58.0.
- Remote container healthy; separate internal network and data volume; UID 1000; read-only filesystem; all capabilities dropped; no published ports.
- All six workflow registrations return four steps, documentation-only descriptions and empty run histories.
- 39 HTTP probes passed: workflow lists/details/graph HTML, source catalog, missing/wrong identity denial, method/execution blocking, disallowed APIs, malformed paths and HEAD behavior.
- Real browser renders the remote Triage graph, its four labelled steps and the documentation-only banner via a temporary administrative SSH tunnel. Full source descriptions are available through the catalog.
- Clicking Run in the browser returns HTTP 405 with the read-only explanation. No run or production action is created.
- Direct remote-API probes confirm the Studio's supporting metadata routes. The catalog's feedback badge explicitly reports no feedback; it is not connected to production observations.
- Outbound TCP probes from the container to `1.1.1.1:443`, `192.168.2.1:80`, and `172.18.0.1:3000` fail. LAN access to server ports 4111/4112 fails.
- Direct gateway requests without JWT, including forged trusted identity headers, return 403.
- Public HTTPS returns Cloudflare authentication (302). Browser login reaches the existing six-digit authenticator challenge.
- Gateway config compared with its pre-change snapshot: only the exact `/mastra` route is added; the container sees that config.
- IDs and start times of Plan API/web/worker, Nextcloud, Paperless and workspace containers remain unchanged across activation; all six are running.
- Five rollback-helper tests pass locally and on Keller: add/remove semantic roundtrip, idempotency, preservation of unrelated fields/routes/mode, route conflicts/duplicates and concurrent-change detection.
- The isolated container/network was stopped and recreated successfully during deployment; its private volume was preserved.

## Remaining verification boundary

The fully authenticated **public** Studio page has not been verified after Cloudflare MFA, because that requires the owner's authenticator code. Authentication was not weakened or bypassed. The actual remote Studio UI was verified through a temporary loopback-only administrative SSH test connection, which was removed after testing.

## Scope and reversibility

These six graphs document existing source flows. They are not live connections to production runs, not a durable workflow migration, and not evidence that the previously identified automation gaps have been fixed.

Undo with `bash rollback.sh` in the installed directory. This removes only Studio's route/container/network; its image, source, private data volume and config snapshot remain for recovery. The snapshot is at `/home/pw/services/volition-stack/config/.state/gateway.json.before-mastra-studio`. No production data migration occurred.
