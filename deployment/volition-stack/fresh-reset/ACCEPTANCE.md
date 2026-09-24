# Fresh reset acceptance

Date: 2026-09-22

No destructive Prepare, Finalize, or backup-marker preparation was executed.

## Installed artifacts

- Versioned: `/home/pw/services/itsaplan/deployment/volition-stack/fresh-reset`
- Live: `/home/pw/services/volition-stack/fresh-reset`

## Verified

- Python syntax compilation succeeds.
- All 29 unit tests pass on the workstation and Keller server.
- Script version 2 separates destructive Prepare from read-mostly Finalize.
- The live default command returns `mode: dry-run`,
  `readyToExecute: false`, and no secret values.
- `--execute` without the exact confirmation exits with status 1 before marker
  validation.
- No `fresh-reset-marker.json`, `fresh-data-reset.prepared.json`, `fresh-runtime-acceptance.complete.json`, or `fresh-data-reset.complete.json` was created.
- The running Plan UI still emits Vault navigation. The Vault UI marker is
  absent and the reset remains blocked until a matching hidden-navigation web
  image is deployed.

## Current blockers

1. Make the backup job remove its plaintext `current` staging on every exit;
   keep the backup timer disabled until this is verified.
2. Deploy a Plan web image with Vault navigation disabled and create the image
   bound Vault UI marker.
3. Complete the Plan/Garage reset marker, including HOME scope and legacy
   volume attestations.
4. Complete the Hermes fresh-state bootstrap marker, including direct erasure and
   checkpoint hashes.

Mastra was removed later (the Helena engine in the API replaced it), and with it the
backup's Mastra archive and the gate that asked for it.

6. After Prepare, run `final_acceptance.py --execute --confirm RUN_VOLITION_FRESH_ACCEPTANCE`. It must bind its evidence to the exact prepared-marker SHA-256 and attest run claim/heartbeat/result, AG-UI terminal streaming, session resume, model and reasoning, Hermes profile persistence, and the full browser restart/profile/noVNC path.

These blockers are intentional preconditions. Prepare cannot erase data while any prerequisite marker is missing. Finalize cannot create a completion marker until the post-rebuild E2E marker is current and exact. Idempotent completion paths also rerun live drift checks.
