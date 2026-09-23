# Kingston native installation and operation

Kingston runs the Volition stack directly on Debian 13. The production source is
`/srv/volition/source/plan`. PostgreSQL, Redis, Nginx, Plan, Mastra, Hermes execution,
code-server, project terminals, and project browsers are native system services. Docker
Compose is not the installation or operating procedure for Kingston.

The Compose files and `install.sh` in this directory describe the earlier container
deployment. Keep them for migration and rollback reference only. Do not run `install.sh`
on Kingston and do not use Compose health as evidence for the native stack.

## Host requirements

The verified host uses Debian 13, Node.js 24.21 at `/usr/local/bin/node`, Bun 1.4 at
`/usr/local/bin/bun`, PostgreSQL 17, Redis 8, Wetty 3.2.2, code-server 4.138, and Nginx.
Create the `volition` group and dedicated `volition-plan`, `volition-hermes`, and
`volition-mastra` system users before installing units. Runtime users have no login shell.
Plan, provisioning, and other approved native writers share vault access through the
`volition` group. Vault directories use mode `2770`: group inheritance is required so a
Markdown file created by one service remains editable by the others.

## Persistent paths

```text
/srv/volition/source/plan
/srv/volition/workspaces/projects
/srv/volition/vault
/srv/volition/trash/projects
/var/lib/volition/plan
/var/lib/volition/provisioning
/var/lib/volition/hermes
/var/lib/volition/hermes/profiles/<slug>
/var/lib/volition/hermes/profiles/<slug>_<agentId>
/var/lib/volition/mastra
/var/lib/volition/project-browser/projects/<slug>
```

`/var/lib/volition/hermes/profiles/<slug>` is the runtime home of the project's coordinator,
and `/var/lib/volition/hermes/profiles/<slug>_<agentId>` that of each other agent of the
project. Shared Hermes authentication remains in the global Hermes home and is resolved by
the runner.

## Private configuration

Install the Plan environment file and required credentials below `/etc/volition` as
root-owned regular files with mode `0600`. Units receive credentials through
`LoadCredential=`. Never place secret values in unit files, repository files, command
arguments, logs, or this document. Validate only ownership, mode, file type, and non-empty
length during installation.

After creating the vault, verify its shared boundary without displaying document content:

```sh
sudo chgrp -R volition /srv/volition/vault
sudo find /srv/volition/vault -type d -exec chmod 2770 {} +
sudo find /srv/volition/vault -type f -exec chmod 0660 {} +
```

Apply those commands only to the dedicated Vault root. Do not broaden permissions on
`/srv/volition`, project source, runtime profiles, or credentials.

## Build and install

From the repository root:

```sh
cd /srv/volition/source/plan
/usr/local/bin/bun install --frozen-lockfile
/usr/local/bin/bun run typecheck
/usr/local/bin/bun run build
```

Build the separate Mastra application before starting it:

```sh
cd /srv/volition/source/plan/deployment/volition-stack/optional/mastra-studio
/usr/local/bin/bun install
/usr/local/bin/bun run test
/usr/local/bin/bun run build
```

Install reviewed units from `deployment/volition-stack/native/systemd/` into
`/etc/systemd/system/`. Install the project terminal wrapper below `/usr/local/libexec`,
its router under the repository path, and Nginx snippets from
`deployment/volition-stack/native/nginx/`. Run `systemd-analyze verify` for changed units
and `nginx -t` before reloading Nginx.

Apply migrations through `volition-plan-migrate.service`, then start services in this
dependency order:

1. PostgreSQL and Redis.
2. Plan migration, API, web, and worker.
3. Hermes runner and provisioning.
4. Hermes team bridge and Mastra.
5. code-server, project terminal, and project browser router.
6. Nginx.

The live instance runs no development servers:
- `volition-plan-api` and `volition-plan-worker` run the checkout's sources without a file
  watcher.
- `volition-plan-web` runs a production build from `/srv/volition/releases/web/current`,
  which `native/web-release.sh` builds and installs, keeping the three newest releases.
- Development happens in a separate worktree (`native/dev/README.md`).
- `sudo native/deploy.sh` fast-forwards the live checkout and then does the rest: installs
  changed dependencies, migrates, builds the web release, restarts what changed, and checks
  that everything answers.

The standalone `volition-hermes-gateway.service` is intentionally disabled. Plan uses the
project-scoped Hermes runner. Enabling the gateway would create a second scheduler across
all project profiles and is an architecture change.

## Operating checks

```sh
systemctl is-active \
  volition-plan-api.service \
  volition-plan-web.service \
  volition-plan-worker.service \
  volition-provisioning.service \
  volition-hermes-runner.service \
  volition-hermes-team-bridge.service \
  volition-mastra.service \
  volition-code.service \
  volition-terminal.service \
  volition-project-browser-router.service \
  nginx.service

systemctl is-enabled volition-hermes-gateway.service
sudo nginx -t
```

Expected internal listeners include Plan on `127.0.0.1:3000` and `:3001`, provisioning
on `:18800`, Mastra on `:4111` and `:4112`, code-server on `:8443`, project terminals on
`:8444`, and the browser router on `:6082`. PostgreSQL and Redis remain loopback-only.

After a change, verify the public route through Nginx, anonymous denial, HTTP assets, and
the applicable WebSocket path. A running unit or open port alone is insufficient.
