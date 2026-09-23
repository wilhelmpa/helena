# Volition workspace and files

This Compose project runs two loopback-only upstreams for the authenticated Volition gateway:

- `http://127.0.0.1:8091` — code-server 4.138.0, Node.js 24.21.0, Bun 1.4.2, pnpm 12.5.1 and Git. The It's a Plan tree automatically selects its repository-pinned Bun 1.4.0; both binaries also remain directly available as `bun-1.4.0` and `bun-1.4.2`.
- `http://127.0.0.1:8100` — authenticated-header ttyd 1.7.7 listener for all project terminals. It runs as UID/GID 1000 inside the workspace container and accepts exactly one lowercase project slug through `?arg=<slug>`. A fixed wrapper resolves only an existing `/projects/<slug>` directory and attaches to a slug-specific tmux session. The stable URL survives service restarts and recreates its tmux session lazily.
- `http://127.0.0.1:8092` — Nextcloud 34.0.4 with PostgreSQL 17.6, Redis 8.2.1 and `user_saml` 8.3.1.

All image tags are pinned by manifest digest. The workspace runs as UID/GID 1000 with no Docker socket, no host home mount, no Linux capabilities and a read-only root filesystem. Its only writable areas are its named home volume, `/projects`, and a bounded `/tmp` tmpfs. code-server authentication is disabled because the upstream is reachable only on host loopback and the Volition gateway is the authentication boundary. Its arbitrary-port proxy, auto-forwarding, telemetry and update checks are disabled. The terminal listener also binds only to host loopback, requires the gateway-provided `X-Forwarded-User` header, rejects cross-origin WebSocket handshakes, and starts only the project-scoped tmux session.

The workspace, Nextcloud front end, and Nextcloud data tier use separate Docker networks. PostgreSQL and Redis are reachable only on the internal `volition-files-data` network. The workspace has no route to either Nextcloud network; the gateway reaches both published applications through their host-loopback ports.

## Projects

The canonical host root for projects is `/home/pw/services/volition-workspaces/projects/<projectKey>`, exposed once at `/projects`. Provisioning creates the project directory and never replaces it, so files and tmux sessions survive container restarts and project changes. Verve is the single explicit legacy exception: `/home/pw/Projekte/Shopify/v1-cart-suite` is mounted at `/projects/verve`. The production checkout under `/home/pw/services/itsaplan` is never linked or mounted into the workspace.

The workspace receives no host GitHub token, deploy key, SSH directory, home directory, Docker socket or application integration token. Repository authentication is an explicit later setup step inside the isolated persistent editor home.

## Gateway contract

For both upstreams, the gateway must reject requests unless the Cloudflare Access JWT has been verified for the expected issuer, audience and expiry. It must discard any client-supplied identity headers before adding its own.

Keep both developer tools on the existing owner-only `plan.volition.one` route. Proxy `/workspace/code/` to `http://127.0.0.1:8091`, stripping that prefix, and proxy `/focus/terminal-project/` to `http://127.0.0.1:8100` without stripping it. Forward WebSocket upgrades and discard client-supplied identity headers before the gateway injects the verified owner identity. No separate code or terminal hostname is needed.

The stable human-terminal resources use this single loopback upstream:

| Public URL | Upstream | Working directory |
| --- | --- | --- |
| `/focus/terminal-project/?arg=default` | `http://127.0.0.1:8100` | `/projects` |
| `/focus/terminal-project/?arg=verve` | `http://127.0.0.1:8100` | `/projects/verve` |
| `/focus/terminal-project/?arg=priv` | `http://127.0.0.1:8100` | `/projects/priv` |
| `/focus/terminal-project/?arg=cons` | `http://127.0.0.1:8100` | `/projects/cons` |
| `/focus/terminal-project/?arg=karr` | `http://127.0.0.1:8100` | `/projects/karr` |
| `/focus/terminal-project/?arg=<new-slug>` | `http://127.0.0.1:8100` | `/projects/<new-slug>` |

Route the `/focus/terminal-project/` prefix without stripping it or its query string, preserve `Host` and the authenticated `X-Forwarded-User`, and forward WebSocket upgrades to port 8100. ttyd serves the socket at `/focus/terminal-project/ws` and carries the same `arg` query parameter. The wrapper rejects a second argument, anything outside `^[a-z0-9][a-z0-9-]{0,31}$`, a missing directory, and a resolved path outside `/projects`. Arguments are never evaluated as shell code.

For `cloud.volition.one`, proxy to `http://127.0.0.1:8092`, preserve `Host`, set `X-Forwarded-Proto: https`, and set exactly `X-Forwarded-User: owner@example.com` from the verified JWT identity. The Nextcloud Apache config maps this trusted header to `REMOTE_USER`; `user_saml` maps `REMOTE_USER` to the Nextcloud user id, display name and email and creates the user on first access. The local login backend remains enabled for recovery and WebDAV app-password use.

## Deploy

Create `.env` from `.env.example` with mode `0600`. Create four random, newline-terminated secret files in `.secrets/`, also mode `0600`: `nextcloud_db_password`, `nextcloud_admin_password`, `nextcloud_patrick_app_password`, and `redis_password`. The app password file is a dedicated Nextcloud app password for the owner account. Add the repository-scoped GitHub deploy key as `verve_git_deploy_key` and an official GitHub host-key file as `github_known_hosts`, both mode `0600`. Do not commit or print any of them.

Then validate and start:

```sh
docker compose --env-file .env -f compose.apps.yml config --quiet
docker compose --env-file .env -f compose.apps.yml up -d --build
docker compose --env-file .env -f compose.apps.yml ps
```

`nextcloud-init` is an idempotent one-shot service. It enables the `user_saml` mapping and disables Nextcloud's `firstrunwizard`. A successful deployment shows it as exited with status 0. Persistent data is held in five distinct named volumes: editor home, Nextcloud application/config, Nextcloud user data, PostgreSQL data and Redis data.

The Redis Docker secret remains root-owned at `/run/secrets/redis_password`. Each Nextcloud container copies it during startup to `/run/volition-secrets/redis_password` with mode `0400` and ownership `www-data:www-data`; the configured `REDIS_HOST_PASSWORD_FILE` always points to that runtime copy. This makes Apache, cron, and later `docker exec --user www-data ... occ` calls use the same readable path without widening the source secret's permissions.

The local recovery login is `https://cloud.volition.one/login?direct=1`. The administrator password is the contents of `.secrets/nextcloud_admin_password`; never pass it on a command line or copy it into logs.

## Project provisioner

`integration/server.mjs` is the private receiver for It's a Plan project provisioning events. The workspace-only unit binds it to the host side of the internal `volition_control` bridge on port `18800`. It accepts only `POST /api/provision` with the configured bearer token, a UUID `Idempotency-Key`, and `X-Itsaplan-Event: project.provision`. The event id in the body and headers must match. Project keys are restricted to uppercase letters and numbers before they are converted to a workspace path.

New projects request `workspace` and `terminal` by default. The provisioner creates the persistent host directory, returns a code-server deep link for `/projects/<slug>`, and returns a ttyd link whose fixed wrapper opens a slug-specific tmux session in exactly that directory. It does not create an agent, browser profile, cloud-file folder, repository credential or second workspace overlay. Verve keeps its explicit existing checkout mount and is not copied.

Every accepted event is recorded in an atomically replaced ledger under `/home/pw/services/volition-workspaces/.state`. Repeating the same UUID and payload returns the stored result. Reusing the UUID with another payload returns `409`. This state and the project directories are independent of the disposable workspace container and editor-home volume.

Create a random mode-0600 `project_provisioning_token` in the stack secret directory and configure the same value as `PROJECT_PROVISIONING_TOKEN` for the Plan worker. Install the user unit from `integration/systemd/volition-provisioning.service`, then verify the private health endpoint from the host:

```sh
mkdir -p ~/.config/systemd/user /home/pw/services/volition-workspaces/.state
install -m 0600 integration/systemd/volition-provisioning.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now volition-provisioning.service
curl --fail --silent http://172.30.254.1:18800/healthz
```

Set `PROJECT_PROVISIONING_URL=http://172.30.254.1:18800/api/provision`. The worker reaches it over the dedicated internal `volition_control` Docker bridge. The service is not exposed through Cloudflare, the LAN, or a public bind; only the returned code and terminal URLs traverse the existing owner-authenticated Plan gateway.

## Private Google MCP bridge

`google-bridge/server.mjs` is a host-local stdio MCP server for the legacy private mail and career triage jobs. legacy runtime starts it directly; it has no listening socket. The bridge invokes the existing owner-managed gog wrappers with `execFile`, never a shell, and exposes only bounded read operations for three fixed Gmail accounts plus the owner's primary calendar. Credentials remain in the host gog profile.

The live MCP surface is exactly `gmail_thread_get`, `gmail_search`, `gmail_attachment_metadata`, and `calendar_list`. It has no Gmail mutation, attachment download, calendar write, attendee, invitation, send, delete, or generic command tool. The unattended career job records a calendar proposal in It's a Plan for later owner review. Its model cannot create its own approval.

Install dependencies with `npm ci --ignore-scripts`, run `npm test`, then register the server through `hermes mcp add` using absolute paths. Probe the saved server and verify an empty diagnostics list before granting exact tool IDs to an agent. The production IDs are prefixed `google-private__`; only the mail tools belong to `itsaplan-inbox`, and only `calendar_list` belongs to `karriere-triage`.
