# Artifact sync

The artifact sync copies project documents from Plan into the private Nextcloud account. The source API is read only. The sync never deletes or overwrites a source or destination file.

## Destination layout

Each project key is validated before it becomes part of a path.

```text
Projects/<project>/Dokumente/Plan/
Projects/<project>/Archiv/Plan/
Projects/<project>/Dokumente/.volition-sync/
```

Plan filenames contain the document ID, version and content hash. A new version creates a new file. An existing filename is accepted only when its downloaded SHA-256 hash matches. A mismatch stops the run as a conflict.

Each successful run writes an immutable JSON manifest. It contains SHA-256 hashes, Nextcloud file IDs and private `/f/<fileId>` links. Plan document entries also contain the exact Plan document link and linked ticket URLs.

## Configuration

Set these values in the private service environment:

```dotenv
ARTIFACT_SYNC_ENABLED=true
ARTIFACT_SYNC_STATE_PATH=/home/pw/.openclaw/volition/artifact-sync.json
PLAN_INTERNAL_URL=http://127.0.0.1:3000
PLAN_PUBLIC_URL=https://plan.volition.one
FILES_PUBLIC_URL=https://cloud.volition.one/apps/files/files
ITSAPLAN_MCP_BEARER=<existing private Plan API key>
```

Supply the Nextcloud application password as a private systemd credential. The example units use `NEXTCLOUD_APP_PASSWORD_FILE`. Credential files must be regular files with no group or other permissions. The Plan API key is read from the existing private `itsaplan-mcp.env` file and sent only as `x-api-key` to the loopback Plan API.

## Verification and operation

Each run discovers the current project list from the loopback Plan API with the private API key. A newly created project is included without changing the timer configuration.

Run a complete source read and hash pass without writing Nextcloud or local state:

```bash
node artifact-sync-run.mjs --dry-run
```

Run the sync once:

```bash
node artifact-sync-run.mjs
```

Install the supplied user service and timer, then enable the timer. The timer runs hourly with a randomized delay. The service has read-only home access and can write only the private state directory.

After a real run, verify that every reported Nextcloud link uses the expected private origin and that the file ID returned by PROPFIND opens the exact uploaded file. The Connections page reports the latest successful or dry-run time and a bounded error message. Source records remain unchanged. Destination conflicts remain present for manual review.
