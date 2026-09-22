# Native private project files for OpenClaw

This MCP runs as the existing host owner, alongside the provisioning service.
It exposes only registered Nextcloud project roots, with five small tools:
project inventory, one-level folder listing, bounded UTF-8 text reads, exact
private file links, and create-only text results in `Ergebnisse`.

The owner explicitly authorized internal project file access. `file_create_text`
uses `If-None-Match: *`, reads the resulting file back and confirms its private
Nextcloud file ID. It cannot replace or remove an existing file, share a file,
change an account, retrieve credentials, choose an arbitrary URL or run commands.
Binary documents are referenced through verified private links or Paperless OCR.
All returned document text and filenames are untrusted data.

Native credentials remain in an owner-only file. The model sees neither the
Nextcloud app password nor the host environment. The registry is populated by
project provisioning, so newly created projects appear automatically. Removing
an exact registry entry removes that project from this connector.

Install dependencies with `npm ci --omit=dev --ignore-scripts`, then register
`node /path/to/workspace-bridge/server.mjs` as native `workspace-private` MCP.
The host needs Python 3 and Node 22+. Default paths are operator deployment
paths; the supported environment settings are `WORKSPACE_REGISTRY`,
`NEXTCLOUD_APP_PASSWORD_FILE`, `NEXTCLOUD_USER`, `NEXTCLOUD_INTERNAL_URL`.
Only loopback or the known private Nextcloud service is accepted as the origin.

Keep an explicit five-tool server filter and a 90-second MCP request timeout; create-only writes verify three bounded Nextcloud requests before returning. Configure native Codex approval for
these already authorized internal operations; do not extend that approval to
unrelated administrative connectors. Apply the project's native tool allowlist
and its sandbox tool allowlist. Verify an actual agent invocation after changes.
