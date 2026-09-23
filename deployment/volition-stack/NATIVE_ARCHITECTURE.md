# Volition native architecture on Kingston

## Current responsibility boundaries

- Plan is the human interface and canonical store for projects, tasks, reviews, and
  configuration.
- Mastra owns workflow definitions, schedules, retries, checkpoints, run history, and
  recovery.
- The Hermes runner executes project agent sessions, skills, tools, and model calls.
- PostgreSQL stores Plan state. Mastra stores its state below `/var/lib/volition/mastra`.
- The filesystem vault stores durable project documents and files.
- Nginx is the only application listener exposed to the LAN. It authenticates embedded
  tools through Plan and removes browser credentials before proxying.

Systemd starts services and performs service recovery. Business schedules belong to
Mastra or Plan.

## Native services

| Service | Unix owner | State |
| --- | --- | --- |
| Plan API, web, and worker | `volition-plan` | enabled and active |
| Provisioning and Hermes runner | `volition-hermes` | enabled and active |
| Hermes team bridge and Mastra | `volition-mastra` | enabled and active |
| code-server and project terminal | `volition-hermes` | enabled and active |
| Project browser router and instances | `volition-hermes` | enabled; instances start per project |
| PostgreSQL, Redis, and Nginx | distribution users | enabled and active |
| Standalone Hermes gateway | `volition-hermes` | intentionally disabled |

The gateway remains installed for a reversible recovery path. Running it beside Plan's
project runner would let a second Hermes scheduler traverse all project profiles.

## Filesystem layout

```text
/srv/volition/source/plan/                         application source
/srv/volition/workspaces/projects/<slug>/          project workspace
/srv/volition/vault/Home/                          global durable documents
/srv/volition/vault/Projects/<KEY>/{Docs,Files,Assets,Inbox}/
/srv/volition/vault/Templates/
/srv/volition/trash/projects/                      deletion quarantine
/var/lib/volition/provisioning/                    provisioning state and registry
/var/lib/volition/hermes/                          shared Hermes runtime and auth
/var/lib/volition/hermes/profiles/<slug>/          project Hermes home
/var/lib/volition/mastra/                          Mastra state
/var/lib/volition/project-browser/projects/<slug>/ browser profile and runtime state
```

Project profiles are isolated by slug. The runner resolves the matching profile and uses
the global Hermes authentication fallback. Project deletion must not remove global Hermes
authentication, models, skills, or templates.

The vault is a shared native service boundary. Its directories are group-owned by
`volition` with mode `2770`, and regular Markdown/files use group read-write permissions.
The setgid bit preserves the `volition` group for new nested paths. Plan Docs writes the
canonical Markdown directly below the project vault; there is no container-owned document
copy.

## Project lifecycle and orchestration

Project creation writes one idempotent provisioning job. Provisioning creates the
workspace, vault folders, Hermes profile, terminal resource, code link, browser state,
coordinator assignment, and registry entry. A retry reuses those resources.

Mastra coordinates `agent-team` through `/run/volition-ipc/hermes-team.sock`. The bridge
submits project-bound work to Plan's external-agent queue. The Hermes runner claims that
queue using the selected project profile. Stable idempotency keys, leases, heartbeats, and
stored checkpoints cover retries and recovery.

```text
Plan API -> provisioning control :18800 -> Mastra proxy :4111
Mastra -> Hermes team Unix socket -> Plan internal orchestration API :3000
Plan agent queue -> Hermes runner -> /var/lib/volition/hermes/profiles/<slug>
```

## Public project URLs

All routes use the Plan origin and require a valid Plan session.

| Function | URL |
| --- | --- |
| Plan | `http://kingston-server.local/` |
| Code | `http://kingston-server.local/code/?folder=/srv/volition/workspaces/projects/<slug>` |
| Terminal, stored compatibility form | `http://kingston-server.local/focus/terminal-project/?arg=<slug>` |
| Terminal, canonical form | `http://kingston-server.local/focus/terminal-project/<slug>` |
| Browser | `http://kingston-server.local/browser/projects/<slug>/vnc.html?autoconnect=1&resize=scale&path=browser%2Fprojects%2F<slug>%2Fwebsockify` |
| Mastra diagnostics | `http://kingston-server.local/mastra/workflows` |

The terminal compatibility URL redirects to the project path and then Wetty's slashless
canonical path. The verified chain terminates after two redirects with HTTP 200. The
router validates host, same-origin WebSocket, slug, and resolved workspace. It starts one
Wetty child per requested project on a private Unix socket. Nginx and the router remove
Cookie and Authorization headers before Wetty. New projects become available after their
workspace directory is created.

The browser uses one persistent profile per project. Chromium CDP and browser TCP
listeners bind to loopback. KasmVNC also opens UDP sockets; service network restrictions
apply, but external UDP denial has not been verified at packet level. Restarting an
instance preserves its profile directory.
The project coordinator receives the matching `BROWSER_CDP_URL`. In Browser Use mode,
`browser_exec` should use `session="project"` to keep its tab visible in Plan's Browser panel
between calls. The generated project instructions specify this session.
The container-era browser paths and units under `deployment/volition-stack/browser/` are
legacy references. Kingston uses `/var/lib/volition/project-browser/projects/<slug>` and
the native units under `deployment/volition-stack/native/systemd/`.

## Security invariants

- Only Nginx exposes application routes to the LAN.
- Internal TCP services bind to loopback or Unix sockets.
- Embedded tools require a valid Plan session.
- Nginx does not forward Plan cookies or Authorization headers to tool upstreams.
- Runtime credentials are root-owned private files delivered with systemd credentials.
- Project slugs and paths are resolved server-side and cannot escape configured roots.
- Project agents receive scoped and revocable Plan capabilities. Shared Unix ownership
  does not provide an operating-system security boundary between projects.
- Consequential external actions stop at an explicit confirmation point.

## Verified status on 2026-09-23

- Plan API, web, worker, provisioning, Hermes runner, Hermes team bridge, Mastra,
  code-server, project terminal, browser router, PostgreSQL, Redis, and Nginx were active.
- The standalone Hermes gateway was disabled.
- Mastra tests passed 14/14 and its production Studio build completed.
- Hermes bridge and Mastra control contract tests passed 13/13.
- The Plan-to-provisioning-to-Mastra path returned seven workflows including `agent-team`.
- A project-profile chat completed with Luna at low reasoning.
- The VOL coordinator used `browser_exec` with Luna at low reasoning and its project CDP
  endpoint. With `session="project"`, the visited tab remained visible in Plan's Browser panel.
- A Plan document synchronized to the shared vault as Markdown under the native group
  permission boundary.
- Terminal routing tests passed locally and on Kingston. A real Socket.IO connection for
  `vol` opened in `/srv/volition/workspaces/projects/vol` after a service restart.
- The public VOL terminal compatibility URL ended at Wetty with HTTP 200 after two
  redirects. Anonymous access through Nginx returned HTTP 401.

These checks establish the current deployed paths. Future changes must rerun checks for
the affected service instead of relying on this historical result.

See [NATIVE_ACCEPTANCE.md](NATIVE_ACCEPTANCE.md) for the completed team execution,
recovery checks, and remaining deployment limits.
