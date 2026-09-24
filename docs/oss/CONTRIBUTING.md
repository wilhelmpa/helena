<!-- Draft (package G). Moves to the repository root at the public cut. -->

# Contributing to Helena

Thanks for helping. This page covers how to get Helena running, the rules the code follows,
and how a change gets merged. By taking part you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bug:** open an issue with the bug form, or add to an existing one.
- **Feature:** open an issue first. Agreeing on the behaviour saves a rewrite.
- **Small fixes** (typos, links, obvious one-liners) can go straight to a pull request.
- Issues labelled `good first issue` are a good start.

## Development setup

Requirements: Bun 1.4, Node 24, Docker (for Postgres), and Hermes Agent to run agents locally.

```bash
bun install
docker compose -f docker-compose.dev.yml up -d   # Postgres
bun run setup                                    # writes .env and .env.test, creates and migrates the databases
bun run dev                                      # API :3000, web :3001, worker
```

The API tests are integration tests against a real Postgres. Each run works on its own copy
of the test database, so parallel runs do not disturb each other.

```bash
bun run typecheck && bun run lint && bun run format:check
bun test scripts/ && (cd apps/api && bun test --env-file=../../.env.test)
```

## How the code is built

- **Extension points first.** A new capability is built as an extension at a fixed extension
  point: runtime, connector, agent tool, workflow step or trigger, policy, event, UI slot,
  template, language. If the point does not exist yet, build it first, then the feature as
  its first extension. No one-off paths. See [plugins.md](plugins.md).
- **Standards before our own code.** Check established SDKs and protocols first. Record the
  choice and the rejected alternatives in `docs/helena-decisions/<topic>.md`. Dependencies
  must be MIT, Apache-2.0, BSD, ISC or MPL-2.0 (no ELv2, SSPL, BUSL, Commons Clause or
  non-commercial). `bun scripts/helena-licenses.ts --check` enforces it.
- **UI:** one header row per page (`PageToolbar`). The sidebar's type scale everywhere (13 px
  rows, 12 px labels, 14 px section titles, 16 px page title). Surfaces use `--card`, hover and
  selection use `--accent`. No intro paragraphs. Every screen must also work on a phone.
  Rules: `docs/dev/ui-standard.md`, tokens: `DESIGN.md`.
- **Languages:** all user-facing strings go into the 10 locales under `apps/web/messages/`.
- **Each app and package** has an `AGENTS.md` with its local rules. Read the one for the area
  you change.
- **Database:** change the schema in `packages/db`, then run `bun run db:generate`. Commit the
  SQL; migrations only go forward.

## Commits and pull requests

- Commit messages and PR titles follow **Conventional Commits** (`feat(api): …`, `fix(web): …`).
  The type decides the next version.
- Sign off every commit (`git commit -s`). The sign-off certifies the
  [Developer Certificate of Origin](https://developercertificate.org/) for your contribution.
- A PR describes what changed, why, and how to test it; it links the issue.
- CI must be green: format, lint, typecheck, tests, the license check and the secret scan.

## License of contributions

Contributions are accepted under the project's licenses: AGPL-3.0 for everything, Apache-2.0
for `packages/runner`.
