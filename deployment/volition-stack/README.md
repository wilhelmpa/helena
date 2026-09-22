# Volition deployment checkpoint

This directory contains the deployable configuration and source used by the Volition instance. Runtime state and credentials are excluded.

## Runtime layout

| Bundle | Services | Boundary |
| --- | --- | --- |
| `itsaplan` | API, web, worker, PostgreSQL, Garage | Application network plus internal `volition_control` |
| `volition-apps` | code workspace, Nextcloud, PostgreSQL, Redis, cron | Workspace, files-front, and internal files-data networks |
| `volition-stack` | identity-validating gateway | Host network in the current deployment |
| `volition-vault` | Vaultwarden | Internal vault network |
| `volition-mastra-studio` | workflows and run control | Internal isolated network |
| OpenClaw | gateway, browser, agent sandboxes | User systemd services; agent containers use network mode `none` |

Keep these services separate. A single container would combine credentials, writable data, lifecycle, and network privileges. Operate them as one product through Compose and systemd.

## Excluded data

The checkpoint excludes `.env`, `.secrets`, application state, databases, object data, backups, logs, generated Mastra state, dependency directories, deploy keys, and historical staging copies. Production identities and provider identifiers are replaced with examples. `config/gateway.example.json` contains placeholders for deployment-specific Cloudflare and Pub/Sub identifiers.

## Prerequisites

- Docker Engine with Compose v2
- systemd user services
- Cloudflare Tunnel and Access
- OpenClaw installed for the operator account
- Node.js 24 and Bun where required

The captured units use `/home/pw`. Replace that path before installing on another host. Review every `ReadWritePaths`, `LoadCredential`, and `EnvironmentFile` entry.

## Secrets

Create `.secrets` with mode `0700`. Create these files with mode `0600`:

- `inbox_push_token`
- `mastra_inbox_adapter_token`
- `nextcloud_admin_password`
- `nextcloud_db_password`
- `nextcloud_patrick_app_password`
- `plan_mastra_control_token`
- `redis_password`
- `trading_bridge_token`
- `verve_git_deploy_key`
- `github_known_hosts`

Use a password manager or host credential store as the source. Copy `.env.example` to `.env` for non-secret settings. The main itsaplan `.env` remains the source for its database and application configuration.

## Gateway

Copy `config/gateway.example.json` to the ignored `config/gateway.json`. Set the Cloudflare Access issuer, audience, owner identity, Google service account, Pub/Sub subscription, and mailbox allowlist. Cloudflare must route the application hostnames to the local gateway. The gateway verifies each signed Access assertion before proxying.

## Start

Create the external resources once:

```bash
docker network create --internal --subnet 172.30.254.0/29 --gateway 172.30.254.1 volition_control
docker volume create itsaplan_web-cache
```

From the itsaplan repository root:

```bash
docker compose -f docker-compose.yml -f deployment/volition-stack/compose.hub.yml config --quiet
docker compose -f docker-compose.yml -f deployment/volition-stack/compose.hub.yml up -d
```

From this directory:

```bash
docker compose -f compose.apps.yml config --quiet
docker compose -f compose.apps.yml up -d
docker compose -f compose.vault.yml up -d
docker compose -f optional/mastra-studio/compose.yml up -d
docker compose -f compose.gateway.yml up -d
```

Install the required files from `systemd/user` in `~/.config/systemd/user`, adjust host paths, then enable the selected services and timers. Some OpenClaw drop-ins refer to operator-managed helper scripts outside this checkpoint. Install and review those helpers before enabling those drop-ins.

## Verification

```bash
npm --prefix gateway ci
npm --prefix google-bridge ci
npm --prefix integration ci
node --test gateway/*.test.mjs
node --test google-bridge/test/*.test.mjs
node --test integration/test/*.test.mjs
python3 -m unittest discover -s workspace-bridge/test
python3 -m unittest discover -s backup/tests
python3 scripts/verify-checkpoint.py
```

Run a secret scanner before each commit.

## Remaining hardening work

The OpenClaw gateway currently receives Docker group access for sandbox orchestration. Replace it with a rootless, allowlisted sandbox broker before removing that access. The gateway currently uses host networking. Move it to explicit front and control networks after OpenClaw is available through a dedicated Unix socket or bridge listener. Nextcloud capability and root-filesystem changes require a restore-tested rollout.
