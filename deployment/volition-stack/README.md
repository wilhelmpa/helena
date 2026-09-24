# Volition deployment checkpoint

This directory contains the deployable configuration and source used by the Volition instance. Runtime state and credentials are excluded.

## Runtime layout

| Bundle | Services | Boundary |
| --- | --- | --- |
| `itsaplan` | API, web, worker, PostgreSQL, Garage | Application network plus internal `volition_control` |
| `volition-apps` | code workspace, Nextcloud, PostgreSQL, Redis, cron | Workspace, files-front, and internal files-data networks |
| `volition-stack` | identity-validating gateway | Host network in the current deployment |
| `volition-vault` | Vaultwarden | Internal vault network |
| Hermes | Home-agent harness and resumable sessions | Hardened user systemd runner; provider credentials remain outside Plan |

Workflows, agent teams and routines run in the API itself (the Helena engine); there is no separate workflow service.

Keep these services separate. A single container would combine credentials, writable data, lifecycle, and network privileges. Operate them as one product through Compose and systemd.

## Excluded data

The checkpoint excludes `.env`, `.secrets`, application state, databases, object data, backups, logs, dependency directories, deploy keys, and historical staging copies. Production identities and provider identifiers are replaced with examples. `config/gateway.example.json` contains placeholders for deployment-specific Cloudflare identifiers.

## Prerequisites

- Docker Engine with Compose v2
- systemd user services
- Cloudflare Tunnel and Access
- Hermes Agent installed for the operator account
- Node.js 24 and Bun where required

The captured units use `/home/pw`. Replace that path before installing on another host. Review every `ReadWritePaths`, `LoadCredential`, and `EnvironmentFile` entry.

## Secrets

Create `.secrets` with mode `0700`. Create these files with mode `0600`:

- `nextcloud_admin_password`
- `nextcloud_db_password`
- `nextcloud_patrick_app_password`
- `plan_control_token`
- `redis_password`
- `trading_bridge_token`
- `verve_git_deploy_key`
- `github_known_hosts`

Use a password manager or host credential store as the source. Copy `.env.example` to `.env` for non-secret settings. The main itsaplan `.env` remains the source for its database and application configuration.

## Gateway

Copy `config/gateway.example.json` to the ignored `config/gateway.json`. Set the Cloudflare Access issuer, audience, and owner identity. Cloudflare must route the application hostnames to the local gateway. The gateway verifies each signed Access assertion before proxying.

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
docker compose -f compose.gateway.yml up -d
```

Install the required files from `systemd/user` in `~/.config/systemd/user` and adjust host paths. The factory reset installs the Hermes Home-agent bootstrap automatically; its retry timer waits for the first owner registration and stops after successful provisioning.

For a guarded Plan database reset and minimal Home-chat bootstrap, follow [`docs/fresh-reset.md`](docs/fresh-reset.md).

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

The gateway currently uses host networking. Move it to explicit front and control networks after all loopback integrations have dedicated Unix sockets or bridge listeners. Nextcloud capability and root-filesystem changes require a restore-tested rollout.
