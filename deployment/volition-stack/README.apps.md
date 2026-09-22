# Volition workspace and files

This Compose project runs two loopback-only upstreams for the authenticated Volition gateway:

- `http://127.0.0.1:8091` — code-server 4.138.0, Node.js 24.21.0, Bun 1.4.2, pnpm 12.5.1 and Git. The It's a Plan tree automatically selects its repository-pinned Bun 1.4.0; both binaries also remain directly available as `bun-1.4.0` and `bun-1.4.2`.
- `http://127.0.0.1:8100` — authenticated-header ttyd 1.7.7 listener for all project terminals. It runs as UID/GID 1000 inside the workspace container and accepts exactly one lowercase project slug through `?arg=<slug>`. A fixed wrapper resolves only an existing `/projects/<slug>` directory and attaches to a slug-specific tmux session. The stable URL survives service restarts and recreates its tmux session lazily.
- `http://127.0.0.1:8092` — Nextcloud 34.0.4 with PostgreSQL 17.6, Redis 8.2.1 and `user_saml` 8.3.1.

All image tags are pinned by manifest digest. The workspace runs as UID/GID 1000 with no Docker socket, no host home mount, no Linux capabilities and a read-only root filesystem. Its only writable areas are its named home volume, `/projects`, and a bounded `/tmp` tmpfs. code-server authentication is disabled because the upstream is reachable only on host loopback and the Volition gateway is the authentication boundary. Its arbitrary-port proxy, auto-forwarding, telemetry and update checks are disabled. The terminal listeners also bind only to host loopback, require the gateway-provided `X-Forwarded-User` header, reject cross-origin WebSocket handshakes, and never create an unsandboxed OpenClaw agent.

The workspace, Nextcloud front end, and Nextcloud data tier use separate Docker networks. PostgreSQL and Redis are reachable only on the internal `volition-files-data` network. The workspace has no route to either Nextcloud network; the gateway reaches both published applications through their host-loopback ports.

## Projects

The canonical host root for projects is `/home/pw/services/volition-workspaces/projects/<projectKey>`, exposed at `/projects/<projectKey>`. Verve is the single explicit exception: `/home/pw/Projekte/Shopify/v1-cart-suite` is mounted at `/projects/verve`. It's a Plan uses a real, independent editor checkout at `/home/pw/services/volition-workspaces/projects/itsaplan`. It carries the Git history and current source changes but excludes runtime `.env` files, credentials, databases, backups and production data. The production checkout under `/home/pw/services/itsaplan` must never be linked or mounted into the workspace.

The Verve checkout keeps its HTTPS origin unchanged. Inside code-server only, Git rewrites that exact repository URL to SSH and uses the repository-scoped `verve_git_deploy_key` plus the pinned `github_known_hosts` file. The key is not mounted into other services, and no host GitHub token, SSH directory, home directory, or Docker socket is exposed to the workspace.

## Gateway contract

For both upstreams, the gateway must reject requests unless the Cloudflare Access JWT has been verified for the expected issuer, audience and expiry. It must discard any client-supplied identity headers before adding its own.

For `code.volition.one`, proxy to `http://127.0.0.1:8091`, preserve `Host`, forward WebSocket upgrades, remove any upstream `X-Frame-Options`, and set `Content-Security-Policy: frame-ancestors 'self' https://plan.volition.one` so the authenticated Plan hub may embed it.

The stable human-terminal resources use this single loopback upstream:

| Public URL | Upstream | Working directory |
| --- | --- | --- |
| `/focus/terminal-project/?arg=default` | `http://127.0.0.1:8100` | `/projects` |
| `/focus/terminal-project/?arg=verve` | `http://127.0.0.1:8100` | `/projects/verve` |
| `/focus/terminal-project/?arg=priv` | `http://127.0.0.1:8100` | `/projects/priv` |
| `/focus/terminal-project/?arg=cons` | `http://127.0.0.1:8100` | `/projects/cons` |
| `/focus/terminal-project/?arg=karr` | `http://127.0.0.1:8100` | `/projects/karr` |
| `/focus/terminal-project/?arg=<new-slug>` | `http://127.0.0.1:8100` | `/projects/<new-slug>` |

Route the `/focus/terminal-project/` prefix without stripping it or its query string, preserve `Host` and the authenticated `X-Forwarded-User`, and forward WebSocket upgrades to port 8100. ttyd serves the socket at `/focus/terminal-project/ws` and carries the same `arg` query parameter. The wrapper rejects a second argument, anything outside `^[a-z0-9][a-z0-9-]{0,31}$`, a missing directory, and a resolved path outside `/projects`. Arguments are never evaluated as shell code. The OpenClaw native `/terminal/<id>` URL is intentionally not used because its id is process-local and becomes invalid after a Gateway restart.

For `cloud.volition.one`, proxy to `http://127.0.0.1:8092`, preserve `Host`, set `X-Forwarded-Proto: https`, and set exactly `X-Forwarded-User: owner@example.com` from the verified JWT identity. The Nextcloud Apache config maps this trusted header to `REMOTE_USER`; `user_saml` maps `REMOTE_USER` to the Nextcloud user id, display name and email and creates the user on first access. The local login backend remains enabled for recovery and WebDAV app-password use.

## Deploy

Create `.env` from `.env.example` with mode `0600`. Create four random, newline-terminated secret files in `.secrets/`, also mode `0600`: `nextcloud_db_password`, `nextcloud_admin_password`, `nextcloud_patrick_app_password`, and `redis_password`. The app password file is a dedicated Nextcloud app password for the owner account. Add the repository-scoped GitHub deploy key as `verve_git_deploy_key` and an official GitHub host-key file as `github_known_hosts`, both mode `0600`. Do not commit or print any of them.

Then validate and start:

```sh
docker compose --env-file .env -f compose.apps.yml config --quiet
docker compose --env-file .env -f compose.apps.yml up -d --build
docker compose --env-file .env -f compose.apps.yml ps
```

`nextcloud-init` is an idempotent one-shot service. It enables the `user_saml` mapping and disables Nextcloud's `firstrunwizard`, so an embedded Files view does not reopen onboarding for each fresh frame. A successful deployment shows it as exited with status 0. Persistent data is held in five distinct named volumes: editor home, Nextcloud application/config, Nextcloud user data, PostgreSQL data and Redis data.

The Redis Docker secret remains root-owned at `/run/secrets/redis_password`. Each Nextcloud container copies it during startup to `/run/volition-secrets/redis_password` with mode `0400` and ownership `www-data:www-data`; the configured `REDIS_HOST_PASSWORD_FILE` always points to that runtime copy. This makes Apache, cron, and later `docker exec --user www-data ... occ` calls use the same readable path without widening the source secret's permissions.

The local recovery login is `https://cloud.volition.one/login?direct=1`. The administrator password is the contents of `.secrets/nextcloud_admin_password`; never pass it on a command line or copy it into logs.

## Project provisioner

`integration/server.mjs` is the private receiver for It's a Plan project provisioning events. It listens on `PROVISIONING_HOST` and port `18800`; the default host is `127.0.0.1`. It accepts only `POST /api/provision` with the configured bearer token, a UUID `Idempotency-Key`, and `X-Itsaplan-Event: project.provision`. The event id in the body and headers must match. Project keys are restricted to uppercase letters and numbers before they are converted to a workspace path.

The provisioner creates the host project directory, an isolated OpenClaw coordinator through `openclaw agents add`, and internal registry metadata under `~/.openclaw/volition/projects`. It creates `/Projects/<projectKey>` through the loopback-only Nextcloud WebDAV endpoint and returns the files resource only after an exact-folder `PROPFIND` succeeds. Verve uses the existing `/home/pw/Projekte/Shopify/v1-cart-suite` checkout and `/projects/verve` mount. It does not copy or edit that checkout. Browser profiles remain pending until their service API is configured; the response contains a warning and no browser resource record.

Every accepted event is recorded in an atomically replaced ledger at `~/.openclaw/volition/provisioning-ledger.json`. Repeating the same UUID and payload returns the stored result. Reusing the UUID with another payload returns `409`.

Copy `integration/.env.example` to `~/.openclaw/volition/provisioning.env`, set only the provisioner values there, and keep the file mode at `0600`. Install the user unit from `integration/systemd/volition-provisioning.service`, then verify the local health endpoint:

```sh
mkdir -p ~/.config/systemd/user
mkdir -p ~/.openclaw/volition
install -m 0600 integration/.env.example ~/.openclaw/volition/provisioning.env
cp integration/systemd/volition-provisioning.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now volition-provisioning.service
curl --fail --silent "http://${PROVISIONING_HOST:-127.0.0.1}:18800/healthz"
```

The deployed worker reaches the service over the dedicated `volition_control` Docker bridge. Bind `PROVISIONING_HOST` only to the host bridge address, assign the worker its fixed bridge address, and restrict host TCP port 18800 to that source address with the input firewall. The worker keeps its application network for PostgreSQL. Do not expose port 18800 through Cloudflare, the LAN, or a public bind.

## Private Google MCP bridge

`google-bridge/server.mjs` is a host-local stdio MCP server for the legacy private mail and career triage jobs. OpenClaw starts it directly; it has no listening socket. The bridge invokes the existing owner-managed gog wrappers with `execFile`, never a shell, and exposes only bounded read operations for three fixed Gmail accounts plus the owner's primary calendar. Credentials remain in the host gog profile.

The live MCP surface is exactly `gmail_thread_get`, `gmail_search`, `gmail_attachment_metadata`, and `calendar_list`. It has no Gmail mutation, attachment download, calendar write, attendee, invitation, send, delete, or generic command tool. The unattended career job records a calendar proposal in It's a Plan for later owner review. Its model cannot create its own approval.

Install dependencies with `npm ci --ignore-scripts`, run `npm test`, then register the server through `openclaw mcp add` using absolute paths. Probe the saved server and verify an empty diagnostics list before granting exact tool IDs to an agent. The production IDs are prefixed `google-private__`; only the mail tools belong to `itsaplan-inbox`, and only `calendar_list` belongs to `karriere-triage`.
