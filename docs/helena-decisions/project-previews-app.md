# Project preview API and controls

Helena exposes persistent project development previews through the existing MCP route
registry and browser toolbar. The native launcher owns processes, ports, readiness,
network isolation and bounded logs. No additional package or database table is required.

## Interfaces

The API uses the launcher's existing Unix socket framing (one versioned JSON request,
then a kind byte, four-byte length, JSON response). Operations are `preview-start`,
`preview-status`, `preview-logs`, and `preview-stop`. The API supplies the slug from its
resolved project, never from caller input. Requests time out after 10 seconds, or 90
seconds for start; responses are limited to 256 KiB. The API runs no shell commands.

`/projects/:projectKey/previews` and its `/start`, `/stop`, `/logs`, `/url` routes generate
`preview_status`, `preview_start`, `preview_stop`, `preview_logs`, `preview_url`. Existing
project membership and documents read/edit permissions govern access to the workspace.
Start and stop are `execute` actions in workspace scope. A project's agent socket may
only address that project; Home may address projects its agent already belongs to.

Start waits for the launcher readiness result. A failed start returns `status: failed`
and bounded, redacted log output; it never produces a ready URL. The browser policy reads
only running previews through `getProjectPreviewOrigins`, with exact HTTP loopback origin
and port matching. This is runtime state, not an owner-editable broad localhost allowlist.

## UI and refresh

The browser toolbar opens a preview dialog with name/directory, status, start/stop, logs,
and an action opening a new tab in the same project browser. A reader sees status/logs;
management requires documents edit permission. The interface is translated in all locales.
A `projectPreviews` revision scope uses the existing consolidated live-refresh service.
Dynamic revision readers run only after project permission checks and cache for two seconds.
The hash ignores last activity time so browsing does not trigger pointless refreshes.

## Alternatives

A separate MCP server would duplicate Helena's permission and policy routing. Per-agent
terminal background jobs die at the end of a run and cannot provide persistent previews.
A database copy of launcher state would introduce two competing process-state records.
The existing MCP SDK/route registry, React Query, consolidated revision service and native
launcher protocol supply the necessary interfaces without another runtime dependency.
