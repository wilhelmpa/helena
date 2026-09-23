# Volition private Google MCP bridge

Host-local stdio MCP server for authorized project coordinators and shared specialists. It executes the existing owner-managed `gog-hermes-read` and `gog-hermes-write` wrappers with `execFile`, a minimal environment, exact command allowlists, fixed accounts, bounded arguments, timeouts, and output limits. OAuth and keyring credentials remain in the host-owned gog profile and are never exposed to an agent or this source tree.

Tools:

- `gmail_thread_get`: sanitized read-only Gmail thread retrieval.
- `gmail_search`: bounded read-only Gmail search.
- `gmail_attachment_metadata`: attachment IDs/names/types/sizes without downloading bytes.
- `calendar_list`: bounded reads from `primary` for the same three allowlisted Google accounts as Gmail and Contacts.
- Calendar writes are intentionally not registered as MCP tools. An unattended agent cannot turn untrusted mail or LinkedIn text into a trustworthy approval. The internal validator remains covered by synthetic tests for a future owner-approved path: it refuses unmanaged event collisions, attendees, recurring events, and non-owner events.

The unregistered calendar-write path remains pinned to `personal@example.com`; expanding read access does not expand its account allowlist.

The server intentionally provides no attachment-download action. The existing workflow resolves imported attachments through the Paperless MCP by importer suffix, filename, subject, and account tag; Gmail attachment metadata is the only missing Google capability. The career job may read the primary calendar and create an It's-a-Plan review item, but an owner must approve any later calendar change through a separate trusted path.

Run `npm test` before deployment. Configure it in legacy runtime as a stdio MCP server using the absolute `node` and `server.mjs` paths. Register the exact five read-only tool IDs in the native legacy runtime allowlist and retain their MCP safety annotations. The authorized working agents use native approval mode `approve` for this bounded catalog so a background Codex run does not hang on an invisible confirmation. Do not grant this server to the tool-free inbox classifier or model-only trading worker. Provider credentials remain in the wrapper runtime.
