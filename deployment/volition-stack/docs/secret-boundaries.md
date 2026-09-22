# Secret boundaries

## Human vault

Vaultwarden at `vault.volition.one` is the interactive password vault. It is reachable
only through the Cloudflare Access protected gateway route. The container publishes no
host port and lives on an internal Docker network. Registration, invitations, Sends,
emergency access, and icon downloads stay disabled. Do not use Vaultwarden collections,
CLI sessions, or a human master password as an automation secret store.

Vaultwarden 1.37.3 does not implement Bitwarden Secrets Manager, machine accounts, or
its API. This is an intentional upstream boundary, not a missing switch:

- https://github.com/dani-garcia/vaultwarden/discussions/5483
- https://github.com/dani-garcia/vaultwarden/issues/3793

The encrypted backup captures the SQLite database, WAL, attachments, and metadata while
the writer is paused. `backup/tests/restore-vault.py` verifies the archive hash, safe
paths, SQLite integrity, owner hash, and record counts in an isolated temporary directory
without starting Vaultwarden or printing vault contents.

## Automation vault

OpenClaw's team-scoped SQLite secret store is the machine-secret authority. Store
credentials as `secret` entries, whose values are write-only through the CLI. Supply new
values through stdin or a mode-0600 file, never a command-line argument. Use `env` entries
only for non-secret configuration. Restrict network credentials with `--allow-host` where
the integration supports an exact host.

Agents, skills, and adapters receive SecretRefs. They must not copy resolved values into
prompts, Plan, logs, documentation, environment files, or Vaultwarden. Run
`openclaw secrets audit --check` after migrations and `openclaw secrets reload` only as a
separate reviewed runtime operation.

## Mastra boundary

Mastra owns workflow state, not credentials. It may receive an adapter token scoped to
submitting and observing OpenClaw jobs, plus opaque SecretRefs that OpenClaw resolves at
execution time. It must not receive mail, Git, browser, provider, or service credentials,
and it must not mount the OpenClaw store. Consequential external actions remain subject
to the OpenClaw approval boundary.

Run `scripts/probe-secret-boundaries.sh` for a value-free check of these boundaries and
the latest Vaultwarden restore artifact.
