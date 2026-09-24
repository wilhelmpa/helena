# Package G: making Helena open-source ready

Plan for package G of the Helena OSS plan (`docs/volition-helena-oss.md`, to be renamed
`helena-oss.md` with the other handoff docs). Branch `hub/oss-packaging`, 2026-09-24.

This document stays **private**: it names the live install, its paths and its owner. What
the public repository receives is listed in §2. The tooling decisions and the rejected
alternatives are in [`docs/helena-decisions/oss-tooling.md`](helena-decisions/oss-tooling.md).

## Kurzfassung (DE)

- **Kern, optional, privat:** Jede Datei und jeder Ordner ist eingeordnet (§2). Privat bleiben
  Kiosk, LAN-Relais, Google/gog, die Sudo-Regeln des Owners, Dev-Mode, Pool-Kopien und
  Ziele sowie die Kingston-Runbooks. Sie kommen in ein privates Overlay-Repo `helena-ops`.
  Die ganze Compose-Ära (Nextcloud, Gateway, Garage-Backup, Fresh/Factory-Reset,
  Sicherheits-Images) wird gelöscht; ihre Historie bleibt im privaten Repo.
- **Umbenennung in einem Schritt:** `rename-map.json` ist die einzige Quelle.
  `migrate_live.py` zieht die laufende Installation mit Journal, Wiederaufnahme und Rollback
  um: Datenbank, Rollen, Nutzer, Gruppen, Pfade, Units, nginx, sudoers, polkit, Env-Dateien,
  Hermes-Profile und Git-Worktrees.
  - Getestet in der eigenen Umgebung: 13 Tests, darunter ein kompletter Durchlauf aus
    Anwenden, Prüfen, Wiederholen und Rollback bis auf das Byte.
  - Ein Nur-Lese-`plan` gegen Kingston selbst ergab „preflight ok“, und jede Unit war
    zugeordnet.
  - **Ausfallzeit:** erwartet etwa 4 Minuten, eingeplant 10. Der Web-Build dauert auf Kingston
    gemessen 52 s. Der Rollback dauert ebenso lang.
- **Frische Historie:** Die Veröffentlichung wird ein neues Repo mit einem einzigen Commit, aus
  dem gefilterten Release-Baum. Die Migrationen werden zu einer Baseline zusammengefasst.
  Grund: `0139_project_mail_accounts.sql` enthält die privaten Mailadressen des Owners.
  - Scanner: gitleaks mit öffentlichen und privaten Regeln, einmalig zusätzlich TruffleHog.
    **Dafür braucht es dein OK zur Installation.**
  - Funde in der privaten Historie werden rotiert.
- **Lizenz:** AGPL-3.0 mit neuer NOTICE; der Runner bleibt Apache-2.0, Hermes ist MIT.
  - Die Liste der Drittlizenzen entsteht aus den Lockfiles: 1328 Pakete, davon 1 blockierend
    (`buffers`, ohne Lizenz). Behebung per Override `unzipper@0.12`.
  - Offen: wer als Copyright-Inhaber genannt wird, und DCO statt CLA.
- **Versionen:** release-please bleibt. Während des Battle-Tests gibt es `1.0.0-rc.N`,
  öffentlich startet Helena mit `1.0.0`. **CI:** Die Workflows sind als Entwurf geschrieben
  und nicht gepusht.
- **Docker:** Hier steht nur die Skizze (§8), denn der Owner will Docker als Letztes.
  Empfehlung: ein Image `helena` mit Rollen und ein Image `helena-agents` (Hermes-Image plus
  Runner). Die Punkte, die vorher in den Code müssen, sind aufgelistet.
- **Demo:** `scripts/helena-demo/seed.ts` legt idempotent eine Demo-Organisation an: Crew,
  Aufgaben, Routine und Workflow. Den Modus „Demo ohne API-Key“ gibt es als Design.

## 1. Order and dependencies

Package G runs last, but these parts can happen before the others finish:

| Step | Needs first | Who |
|---|---|---|
| Classification, rename kit, license list, docs drafts, demo seed | nothing | this branch |
| Owner-literal cleanup in core code (§2.5) | nothing; small PRs | any agent, per area |
| **Rename commit + live migration** (§3) | D (Mastra gone: fewer names to move), agent-isolation decision (vp-* users), a quiet week: no agent branch open that touches `deployment/` | orchestrator + owner, maintenance window |
| Migration squash, public manifest, fresh history (§4) | rename done, H (battle test) green | orchestrator |
| Docker (§8) | rename done; owner: "Docker machen wir als Letztes" | Opus agent |
| Publication | owner's OK (org, repo name, date), release criteria §5 of the OSS plan | owner |

The rename goes before the Docker work, so the image, the compose file and every new doc use
the final names from the start.

## 2. Core, optional, private

Legend:
- **core**: in the public repository, part of every install.
- **opt**: public, but an optional module that is off unless configured.
- **priv**: moves to the private overlay repository `helena-ops` (§2.6).
- **retire**: deleted before the cut; its history stays in the private repository.
- **replace**: rewritten for Helena; the draft is named.
- **D**: removed by hub/native-engine together with Mastra.

### 2.1 Repository root

| Path | Class | Note |
|---|---|---|
| `apps/api`, `apps/web`, `apps/worker` | core | Owner literals: §2.5 |
| `apps/bot` | opt | Telegram notifications; starts only with a bot token |
| `packages/*` (agent-naming, agent-tools, auth, crypto, db, eslint-config, mail, mailer, net, runner, storage, vault) | core | `packages/runner` stays Apache-2.0 |
| `packages/browser-gateway` (hub/agent-browser-mcp), `@helena/sdk` (hub/framework) | core | |
| `scripts/` (setup, env-file, naming tests, helena-licenses) | core | The naming test is extended to `volition`/`itsaplan` after the rename |
| `.github/` | replace | Drafts in `docs/oss/ci/`; `cla.yml` → `dco.yml`; CODEOWNERS; issue forms adapted |
| `.agents/skills`, `.claude/skills`, `AGENTS.md`, `CLAUDE.md`, `apps/*/AGENTS.md` | core | Contributor guides for coding agents; review for private paths |
| `CHANGELOG.md` | priv | Upstream history. The public repository starts a new changelog at 1.0.0 |
| `CODE_OF_CONDUCT.md` | replace | Contributor Covenant 2.1; contact address changes |
| `CONTRIBUTING.md`, `README.md`, `SECURITY.md` | replace | `docs/oss/` |
| `ICLA.md` | retire | Upstream CLA. DCO instead (owner decision, §5) |
| `LICENSE` | core | AGPL-3.0 text unchanged |
| `NOTICE` | replace | §5 |
| `TELEMETRY.md` + `apps/worker/src/telemetry.ts` | retire | Reports to the upstream endpoint `telemetry.itsaplan.dev`, on by default (audit F26). Remove it; `SECURITY.md` states "Helena sends no telemetry" |
| `DESIGN.md` | core | |
| `assets/` | replace | Helena brand from `apps/web/public/brand`; new screenshots; Coolify/Railway buttons out |
| `charts/itsaplan`, `docker-compose.coolify*.yml`, `docs/coolify.md`, `docs/railway.md`, `docs/helm.md` | retire | Upstream deployment targets without runner or Hermes. They do not work for Helena |
| `docker-compose.yml`, `apps/*/Dockerfile` | replace | Docker phase (§8) |
| `docker-compose.dev.yml`, `docker-compose.test.yml` | core | Rename the project name |
| `.env.example`, `.env.test.example`, `apps/web/.env.example` | replace | Generated from the env schema (audit F13, §8.4) |
| `bun.lock`, `package.json`, `turbo.json`, `tsconfig*`, lint/format/git config | core | |
| `release-please-config.json`, `.release-please-manifest.json` | core | Drop the chart from `extra-files`; the version restarts (§6) |
| `docs/dev/*`, `docs/development.md`, `docs/runner.md` | core | Rewrite `development.md` and `runner.md` for Helena |
| `docs/self-hosting.md` | replace | Docker quickstart (§8) |
| `docs/breaking-changes.md`, `docs/mcp-results.md`, `docs/pr-screenshots/` | retire | Upstream PR material |
| `docs/volition/architecture.md` | replace | `docs/oss/ARCHITECTURE.md` |
| `docs/volition/ui-standard.md`, `workflow-builder-contract.md` | core | Move to `docs/dev/` |
| `docs/volition/design-handover.md` | priv | |
| `docs/helena-decisions/` | core | |
| `docs/helena-oss-packaging.md` (this file) | priv | |
| `deployment/helena-rename/` | priv | After the migration ran, it moves to `helena-ops/runbooks/` |

### 2.2 `deployment/volition-stack/` (becomes `deployment/helena/`)

| Path | Class | Note |
|---|---|---|
| `agent-pool/pool.ts`, `agent-pool/skills/` | core | The pool templates. Their instructions are German; English versions (i18n of templates) are a follow-up |
| `agent-pool/legacy.ts` | priv | COPIES, COORDINATOR_SKILLS, ROADMAP_GOALS name the owner's projects |
| `scripts/setup-agent-pool.ts` (+ `.browser.ts`) | core | Without the sections `copies`, `org`, `shopify`, `goals`, which move to `helena-ops` as their own script |
| `scripts/fresh-reset.mjs`, `probe-secret-boundaries.sh`, `verify-checkpoint.py`, `scripts/test/` | retire | Compose era |
| `browser/` (router, screencast, input, video) | core | Starts per-project Chromium through systemd today; §8.3 |
| `integration/` provisioning service: `server.mjs`, `provisioner.mjs`, `config.mjs`, `project-*.mjs`, `areas.mjs`, `boards.mjs`, `plan-coordinator.mjs`, `agent-launcher.mjs`, `purge-trash.mjs`, `move-path.mjs`, `atomic-json.mjs`, `validation.mjs` | core | The only component that changes OS resources. Long term it folds into the runner (hub/hermes-sync already materialises profiles) and the router |
| `integration/mastra-*.mjs`, `hermes-team-bridge*.mjs`, `triage.mjs` | D | |
| `integration/connections.mjs` | core → access-center | Superseded by hub/access-center connectors |
| `integration/hermes-plugins/plan-approval-guard/` | core | Becomes `helena-approval-guard`; essential, since it blocks dangerous commands |
| `integration/hermes-runner/` | core | `hermes-config.fragment.yaml` carries `tirith_path: /home/pw/…` (owner literal) |
| `integration/scripts/volition-hermes-{runner,bootstrap,catalog.py,browser-smoke.py}` | core | Renamed; deploy must install them (§3.3, installer gap) |
| `integration/systemd/` | core (native) | |
| `isolation/` + `native/isolation.sh` | core (native) | Agent isolation with systemd. In Docker, the separation is per container (§8) |
| `native/deploy.sh`, `web-release.sh`, `vault-setup.sh`, `files-documents.sh`, `install-browser.sh` | core (native) | "Native Debian install" stays a supported advanced path; it is what the battle test runs on. Owner literals out |
| `native/systemd/`, `native/chromium/`, `native/nginx/{project-terminal,tool-proxy-security}.conf`, `native/nginx/install-hermes-guard.sh` | core (native) | |
| `native/nginx/*mastra*` | D | |
| `native/terminal/` | core | Project terminal (Wetty + tmux) |
| `native/owner-terminal/` | opt | Needs TOTP by default. `90-wilhelmpa*` sudoers are priv |
| `native/syncthing/` | opt | Vault sync to devices |
| `native/local-owner/` | opt, generalised | LAN auto-login. Today it hard-codes `kingston-server.local` and `192.168.2.0/24`. It becomes an admin setting with explicit host and CIDRs, **off by default**. The current script is priv |
| `native/google/` | priv | The gog setup with `volition-google` and the owner's sudoers. The connector itself is core (access-center) |
| `native/kiosk/`, `native/lan/`, `native/dev/` | priv | Owner hardware, the m5 host relays, dev mode on Kingston |
| `optional/mastra-studio/` | D | |
| `backup/` | retire | Garage, Nextcloud and offsite of the compose era. A new `helena-backup` follows (§8.6) |
| `compose.{apps,gateway,hub,vault}.yml`, `install.sh`, `.env.example`, `config/`, `gateway/`, `files/`, `workspace/`, `workspace-bridge/`, `google-bridge/`, `security-images/` (incl. the vendored `gosu-1.19-source.tar.gz`), `security-patches/`, `factory-reset/`, `fresh-reset/`, `systemd/user/`, `docs/fresh-reset.md`, `test/install.test.mjs`, `README.apps.md` | retire | The whole compose era (Nextcloud, Cloudflare Access gateway, ttyd, Vaultwarden). `docs/secret-boundaries.md` is read for `SECURITY.md` first |
| `README.md`, `INSTALL.md`, `NATIVE_ARCHITECTURE.md`, `NATIVE_ACCEPTANCE.md` | priv | Kingston runbooks. The generic parts go into `docs/oss/ARCHITECTURE.md` and the native install guide |
| `test/native-units.test.mjs` | core | Adapt to the new unit names |

### 2.3 Outside the repository

- `~/volition/CLAUDE.md` and `~/volition/docs/volition-*.md` (handoff, designs, plans) move to
  `helena-ops/docs/` and are renamed `helena-*.md`. The orchestrator updates the references in
  the same step as the rename. Kingston keeps its synced copy.
- Units and scripts installed by hand, not by deploy.sh (the "installer gap", §3.3):
  `volition-hermes-serve.service`, `volition-cloudflared.service`,
  `volition-project-browser-restore.service`, `/usr/local/libexec/volition-{browser-restore,home-browser-provision,hermes-browser-smoke,plan-kiosk*}`.

### 2.4 Private data in the history

- `packages/db/drizzle/0139_project_mail_accounts.sql` maps project names to the owner's
  three real mail addresses. Every migration since 0000 is in the history, so the public
  repository gets a **squashed baseline migration** (§4.3), not the chain.
- Test fixtures use the owner's project keys and names (VOL "Volition", VERVE, FAM, PRIV), and
  `local-owner-session.test.ts` uses `kingston-server.local`. They become neutral (DEMO,
  example.org) in the rename commit.

### 2.5 Owner literals inside core code (fix before the cut)

| Where | Literal | Fix |
|---|---|---|
| `integration/provisioner.mjs` `projectSlug` | `VERV → verve` | Drop the special case; the owner's slug stays through a migration of the registry |
| `integration/config.mjs` | `plan.volition.one`, `plan-api.volition.one`, `172.30.95.2:4111`, `VERVE_PROJECT_PATH` | Defaults from `HELENA_PUBLIC_URL`; the Mastra and Verve parts go |
| `native/terminal/*router.mjs`, `native/owner-terminal/*router.mjs` | allowed hosts `kingston-server.local,kingston-server` | Derived from `APP_URL` |
| `apps/web/next.config.ts` | `allowedDevOrigins: ['kingston-server.local', …]` | From an env var |
| `integration/hermes-runner/hermes-config.fragment.yaml` | `tirith_path: /home/pw/…` | Relative to `HERMES_HOME` |
| `apps/api/src/modules/knowledge/service.ts` | `OBSIDIAN_VAULT = 'Volition'` | `OBSIDIAN_VAULT_NAME`, default `Helena` (the web already reads it) |
| `packages/auth/src/index.ts` | TOTP issuer `'Volition'` | `Helena` (new enrolments only; existing authenticator entries keep their label) |
| `apps/api/src/scripts/bootstrap-home-agent.ts`, coordinator instructions | "keep tasks traceable in Plan" | "in Helena" |
| OpenAPI tags and descriptions | "Plan", "Mastra" | Helena wording; Mastra tags go with D |
| `apps/api/src/modules/owner-terminal/*`, `packages/db/src/schema/app.ts` comments | `wilhelmpa`, `90-wilhelmpa` | "the owner account" |
| agent-pool instructions | "des Owners", the owner's Astro site and Shopify apps | Generic wording in the public templates; the owner's variants go to `helena-ops` |

### 2.6 The private overlay `helena-ops`

```text
helena-ops/                  private repository (owner's GitHub or Kingston only)
  hosts/kingston/            host facts, env templates without values, nginx site, local-owner
                             config (host, CIDRs), dev mode (native/dev)
  kiosk/  lan/  google/      from native/kiosk, native/lan (runs on the m5 host), native/google
  owner-terminal/            sudoers 90-wilhelmpa
  agent-pool/                legacy.ts + a setup script for copies, org, shopify, goals
  runbooks/                  NATIVE_*.md, INSTALL.md, the rename kit and its journal
  docs/                      the handoff (CLAUDE.md, helena-*.md)
  scan/private.gitleaks.toml rules that find the owner's private data (§4.2)
  archive/                   the retired compose-era deployment, read-only
  install.sh                 installs a Helena release, then applies the overlay
```

The public repository never references it. The overlay pins a Helena release (a tag, later an
image digest) and applies its files on top.

## 3. The one-step rename

### 3.1 Principles

- **One map.** [`deployment/helena-rename/rename-map.json`](../deployment/helena-rename/rename-map.json)
  is the single source for the repository codemod and the live migration.
- **One window.** The rename commit and the live migration land in the same maintenance window.
  Before it, nothing is renamed piecemeal (naming rule in CLAUDE.md).
- **Compatibility for one minor release.** The code reads the new env names first and the old
  ones as a fallback, and accepts the `itsaplan` MCP grant as an alias. Webhooks send the old
  `X-Itsaplan-*` headers next to the new ones. The runner renames `run/itsaplan-managed` itself
  if it finds it. All of it is removed in the next minor.
- **Compatibility symlinks** (`/srv/volition → helena`, and so on) keep every path a script
  or config still names working until `finalize` removes them after a burn-in of two weeks.

### 3.2 The names

| Kind | Old | New |
|---|---|---|
| Database / role | `itsaplan`, `itsaplan_dev`, `itsaplan_test*` / role `itsaplan` | `helena`, `helena_dev`, `helena_test*` / role `helena` |
| Users | `volition-plan`, `volition-hermes`, `volition-browser`, `volition-sync`, `volition-google`, `volition-mastra`, `volition-storage`, `volition-vaultwarden`; isolation `vp-<slug>`, `volition-launcher`, `volition-egress` | `helena`, `helena-hermes`, `helena-browser`, `helena-sync`, `helena-google`, … ; `hp-<slug>`, `helena-launcher`, `helena-egress` |
| Groups | `volition`, `volition-plan-secrets`, `volition-hermes-secrets`, `volition-private`, … | `helena`, `helena-secrets`, `helena-hermes-secrets`, `helena-private`, … |
| Units | `volition-plan-{api,web,worker,migrate}`, `volition-hermes-runner`, `volition-project-browser-*`, `volition-*` | `helena-{api,web,worker,migrate}`, `helena-runner`, `helena-browser-*`, `helena-*`; full table in the map; the stale `-api-dev`, `-gateway`, `novnc/vnc/xvfb` units are retired |
| Paths | `/srv/volition`, `/var/lib/volition`, `/etc/volition`, `/var/lib/volition-google`, `/var/log/volition`, `/run/volition-*`, `/usr/local/{libexec,lib}/volition-*` | `…/helena…`; the checkout `source/plan` → `source/helena`, app state `/var/lib/helena/app`, `plan.env` → `helena.env`, `hermes-plan-key` → `runner-api.key` |
| Env vars | `PLAN_*`, `ITSAPLAN_*`, `VOLITION_*`, `MASTRA_*` | `HELENA_*`; `MASTRA_*` goes with D; `PLAN_SECRET_ALLOW_HOST`, `VERVE_PROJECT_PATH` retired |
| Headers | `x-volition-local-access`, `X-Itsaplan-{Event,Event-Id,Signature,Delivery}`, UA `itsaplan`, `itsaplan-webhooks/1` | `x-helena-local-access`, `X-Helena-*`, `helena`, `helena-webhooks/1` |
| MCP | server `itsaplan`, tools `itsaplan__*`, grant `mcpGrants: ["itsaplan"]` (5 agents live) | `helena`, `helena__*`, data migration of the grants |
| Hermes | `run/itsaplan-managed`, `itsaplan-{runner,policy-manifest,vault-manifest}.json`, plugin `plan-approval-guard` | `helena-*`; plugin `helena-approval-guard` |
| Packages | root `itsaplan`, `@itsaplan/runner`, `@repo/*` | `helena`, `@helena/runner`, `@helena/*` (one scope with `@helena/sdk`) |
| Browser globals | `window.__ITSAPLAN_ENV__`, `__itsaplanScrollRestoration`, localStorage `itsaplan-theme` | `__HELENA_ENV__`, `__helenaScrollRestoration`, `helena-theme` (read the old key once) |
| Files and dirs | `deployment/volition-stack`, `charts/itsaplan`, `docs/volition/`, backup dumps `itsaplan-<stamp>.dump` | `deployment/helena`, removed, `docs/dev/`, `helena-<stamp>.dump` |
| Visible strings | TOTP issuer, Obsidian vault, "Plan" in agent instructions and OpenAPI, vault git authors `*@volition.local` | Helena / `*@helena.local` |
| Kept | Syncthing folder ID `volition` (paired devices know it), branch names until the cut, `itp_` API key prefix (old keys keep working) | |

### 3.3 The repository side: the rename commit

1. **Codemod** (to write from the map; mechanical, reviewed as one diff): move the directories,
   rename files, replace tokens in text files. It never touches `packages/db/drizzle/**`
   (history), `CHANGELOG.md`, `LICENSE`/`NOTICE` attribution or `bun.lock` (regenerated with
   `bun install`).
2. **Compatibility shims**, removed in the next minor (§3.1): an env reader
   `readEnv('HELENA_X', 'PLAN_X')`, which comes naturally with the zod env schema (audit F13);
   the MCP alias; dual webhook headers; the runner's rename of `run/itsaplan-managed`; the old
   localStorage key.
3. **Data migration:** `mcpGrants` `itsaplan → helena` in `ai_agent.runtime_policy`. The
   reverse statement is in the map (`database.rollbackSql`), so the live rollback undoes it.
4. **Close the installer gap:** deploy.sh (then `helena-deploy`) installs every libexec helper
   and every unit the install needs from the repository. Hand-installed files
   (`hermes-serve`, `browser-restore`, `home-browser-provision`, kiosk scripts) either get a
   source in the repository or move to `helena-ops`. Today a fresh native install cannot be
   reproduced from the repository.
5. **Tests:** the naming test (`scripts/no-itsaplan-strings.test.ts`) also fails on `volition`
   and `itsaplan` outside an allowlist; `native-units.test.mjs` and
   `deploy-scripts-executable.test.ts` use the new paths.
6. **NODE_ENV=production everywhere** (audit F01). The API unit sets `development` only for
   non-secure cookies over plain-http LAN. With the SSRF switch (`SSRF_ALLOW_PRIVATE`, 023f2f8d)
   and access-center's explicit cookie and rate-limit settings, the rename commit's
   `helena-api.service` runs with `production`.

### 3.4 The live side: `migrate_live.py`

`deployment/helena-rename/migrate_live.py` (Python 3 stdlib, no install). Commands: `plan`,
`preflight`, `apply`, `verify`, `rollback`, `finalize`, `status`.

`apply`, in this order. Every action is journaled before the next one starts, so a failed apply
**resumes** where it stopped and a `rollback` undoes exactly what happened:

1. **preflight:**
   - it runs as root, and the new names (paths, users, groups, database, role) are free;
   - every move stays on one filesystem (a rename, not a copy);
   - Postgres is reachable and the role's password is SCRAM (a rename clears an md5 password);
   - the live checkout is clean, and the target ref is a fast-forward containing `deployment/helena/native/deploy.sh`;
   - the rollback ref has the tree of the current HEAD and descends from the target.
2. **dump:** `pg_dump -Fc` of every database into the backup directory (0700).
3. **units:** it records every `volition-*` unit with its enablement and state, then stops
   (timers and sockets first) and disables them.
4. **database:** for each database: disallow connections, terminate backends, rename, allow
   again. Then it renames the role.
5. **groups and users:** `groupmod -n`, then `usermod -l -d`. The UIDs and GIDs stay, so file
   ownership needs no change. It refuses while a user still runs a process.
6. **paths:** it moves each root and leaves a relative compatibility symlink behind. Then it
   runs the inner renames, the Hermes profile entries (`run/itsaplan-managed` …) and
   re-points absolute symlinks such as `releases/web/current`.
7. **git:** `git worktree repair` for the moved worktrees (`plan-dev`, `plan-orchestration`,
   `hermes-dev`).
8. **config:** under `/etc/systemd/system`, nginx, sudoers (checked with `visudo -cf`), polkit,
   udev, the Chromium policy, `/usr/local/{libexec,bin}`, tmpfiles, logrotate and cron.d it
   renames names that carry an old token, rewrites contents and re-points links. It takes
   units from the units map first; retired units go to the backup.
9. **rewrite files:** env files get key renames, `postgres://` user and database renames and
   the paths. Runner descriptors, the Hermes `config.yaml`s (MCP server `itsaplan` → `helena`,
   `${ITSAPLAN_API_KEY}`, the plugin), browser `runtime.env`, the Syncthing config (path only,
   the folder ID stays), venv shebangs, the owner's `gog` wrapper and git configs are rewritten
   too. Secret files are edited in place; their originals go to the backup with mode 0600, and
   nothing prints a value.
10. **reload:** `daemon-reload`, then `nginx -t`.
11. **code:** a fast-forward of the live checkout to the rename commit (no reset or checkout).
12. **enable and deploy:** it enables the new names of the units that were enabled, runs the
    new `deploy.sh` (dependencies, migrations, web release, runner bundle, unit install), then
    starts the new names of every unit that was active, the browser instances included.
13. **verify** (its own command): every unit is active, the health URLs answer, the database
    has its new name, and a left-over scan lists old tokens by file and line, never the line
    itself.

`rollback` walks the journal backwards:
- it stops and disables the new units and undoes the data migration, deleting the migration rows the deploy added;
- it fast-forwards the checkout to the rollback ref (the rename commit reverted, tree equal to the old HEAD);
- it restores every rewritten file byte for byte and moves every path, user, group, database and role back;
- it moves aside the helena-named files the deploy installed;
- it runs the old `deploy.sh` and enables and starts the old units as recorded.

`finalize` removes the compatibility symlinks after the burn-in, and only when the left-over
scan is clean.

**Downtime.** Measured on Kingston, 2026-09-24:

| Part | Time |
|---|---|
| Dump of the four databases (before the stop, no downtime) | ~20 s |
| Stop (runner `TimeoutStopSec=45`) | ≤ 45 s |
| Database, users, groups, path moves (same filesystem), rewrites, worktree repair | < 30 s (the symlink scan skips `node_modules`, `.git`, sessions and caches) |
| deploy: `bun install` after the package renames (warm cache) | 30–60 s |
| deploy: pre-migration dump + migrations | ~15 s |
| deploy: web build (**measured 52 s** on Kingston under load 7) + release copy | ~70 s |
| deploy: runner bundle, unit install, restarts, health | ~40 s |
| **Total** | **about 4 minutes expected; plan a 10-minute window.** A rollback takes as long |

**What the owner does outside the container.** The m5 host keeps its own names until it is
convenient to change them:
- the LAN relay user units (`native/lan/volition-lan-*.service`);
- the Caddy route to `kingston-server.local`;
- the kiosk session on the host, if one runs there.

The compatibility symlinks cover the Kingston side meanwhile.

**Runbook** (orchestrator, with the owner, in the window):

```bash
# before the window
git -C /srv/volition/source/plan-dev revert --no-edit <rename-commit>   # on branch helena/rename-rollback
sudo python3 deployment/helena-rename/migrate_live.py plan
sudo python3 deployment/helena-rename/migrate_live.py preflight \
  --target-ref helena/rename --rollback-ref helena/rename-rollback
# the window: no full-test.sh run, no agent run in progress (pause the agents in Helena)
sudo python3 deployment/helena-rename/migrate_live.py apply \
  --target-ref helena/rename --rollback-ref helena/rename-rollback \
  --backup-dir /var/backups/helena-rename/2026-XX-XX
sudo python3 /srv/helena/source/helena/deployment/helena-rename/migrate_live.py verify \
  --backup-dir /var/backups/helena-rename/2026-XX-XX
# the headless route sweep, then un-pause the agents
# if anything is wrong:
sudo python3 …/migrate_live.py rollback --rollback-ref helena/rename-rollback \
  --rollback-deploy-cmd "/srv/volition/source/plan/deployment/volition-stack/native/deploy.sh helena/rename-rollback" \
  --backup-dir /var/backups/helena-rename/2026-XX-XX
# two weeks later
sudo python3 …/migrate_live.py finalize --backup-dir /var/backups/helena-rename/2026-XX-XX
```

After the migration, the orchestrator updates the agent working scripts in `~/agent-work`,
`full-test.sh` and the `.env.test` files (database `helena_test`), plus the clones' `origin`
URLs, and CLAUDE.md.

### 3.5 Test evidence

`deployment/helena-rename/test/` has 13 tests. All 13 pass on Kingston against the private
cluster on port 55495; the rule tests also pass on the Mac.

- **Rule tests:**
  - only whole tokens are matched: `volition.one`, mail addresses and foreign paths keep their spelling;
  - env keys and `postgres://` URLs are renamed;
  - Hermes config: the MCP server, `${ITSAPLAN_API_KEY}` and the plugin;
  - unit names come from the map, instances included.
- **End to end:** a sandbox root that mirrors Kingston (units, drop-ins, masks, `wants` links,
  nginx with an `sites-enabled` link, sudoers, polkit, libexec, env files, runner descriptors,
  Hermes profiles, the venv, Syncthing, the web release link, git with a worktree) with a real
  Postgres (database, role, drizzle table, `ai_agent` grants). The test runs
  `apply → verify → apply again (no-op) → rollback`. It checks every renamed object, that no
  secret value was printed, that the backups have mode 0600, and that after the rollback the
  tree hashes to exactly its state before.
- Resume after a failure halfway (a failing `usermod`); a dry run that changes nothing; preflight
  refuses a taken name or a rollback ref with the wrong tree.
- The tests found five real bugs, now fixed:
  - the start step was shadowed by a marker;
  - `…-chromium@%i` references did not follow the units map;
  - brand parts of file names (`91-volition-gog`, `volition.conf`) were not renamed;
  - config links did not follow the renamed file;
  - the stub did not rename group members.
- **Read-only plan against the live system** (`sudo migrate_live.py plan`): "preflight ok"; all
  48 `volition-*` units (the five project browsers included) mapped; 6 groups, 8 users, 17
  path moves.

## 4. Fresh public history and the secret scan

### 4.1 The cut

1. **Freeze.** The rename is done, H is green, and the release branch `release/1.0` is cut in
   the private repository.
2. **Public manifest.** `helena-ops/scan/public-manifest.txt` holds include and exclude globs
   derived from §2; the exclusions are priv, retire and this file.
3. **Export.** `git archive release/1.0` is filtered by the manifest into a new directory.
4. **Clean-up commits in the private repository first.** The export only removes files;
   anything to *change* happens in the private repository, so the two never diverge:
   - the migration squash (§4.3);
   - the owner literals (§2.5);
   - neutral fixtures (§2.4);
   - the docs from `docs/oss/` moved to the root;
   - the new NOTICE and CHANGELOG.
5. **Checks on the export:**
   - `helena-licenses --check`;
   - gitleaks with the public rules, then with `helena-ops/scan/private.gitleaks.toml` (the
     owner's names, mail addresses, host names, LAN ranges, project keys, `/home/pw`,
     `kingston`);
   - the full test suite, and a build from the export itself;
   - an Opus review of the tree (release criterion 4).
6. **New repository.** `git init`, one commit "Helena 1.0.0" by "Helena contributors" (no
   personal author data), tag `v1.0.0`, pushed only with the owner's OK.
7. **After publication:** GitHub secret scanning with push protection, private vulnerability
   reporting, branch protection, Dependabot and Scorecard.

### 4.2 Scanning the private history

The public tree is new, but the private history remains in every clone. Before the cut, run
gitleaks once over the whole private history (`gitleaks git --redact`) of the main repository,
`hermes` (the owner's commit on `volition/main`) and `~/volition`. Every finding is **rotated**
(API keys, tokens, the SSH key, `BETTER_AUTH_SECRET` if it ever appeared) even though it will
not be published. Installing gitleaks (and optionally TruffleHog) **needs the owner's OK**;
see the decision doc.

### 4.3 Migration squash

The public repository starts with one baseline migration generated from the final schema,
together with the seed data rows that migrations insert today (e.g. `0046_seed_storage_settings`).

- **Proof it matches.** A database migrated through the old chain and one built from the
  baseline must give the same `pg_dump --schema-only`.
- **Live compatibility.** The live database keeps its `drizzle.__drizzle_migrations` rows.
  drizzle applies only journal entries newer than the last applied `created_at`, so a
  baseline dated at or before the last live migration is skipped there. Later public
  migrations apply to both.
- The old chain stays in the private repository.

## 5. Licenses

- **Helena: AGPL-3.0-only**, as set by the fork. The LICENSE text stays unchanged.
  `packages/runner` stays **Apache-2.0**, as upstream licensed it; our changes to it are under
  Apache-2.0 too.
- **NOTICE** (draft, the copyright holder is an owner decision):

  ```text
  Helena
  Copyright (C) 2026 <copyright holder>

  Helena is a fork of It's a Plan (AGPL-3.0), copyright (C) 2026 Andrii Poluosmak.
  Upstream project: https://github.com/croffasia/itsaplan

  Helena is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0), except
  packages/runner, which is licensed under the Apache License 2.0 (packages/runner/LICENSE).

  Helena drives Hermes Agent (MIT License, Copyright (c) 2025 Nous Research), which runs as a
  separate program. Third-party components and their licenses: THIRD-PARTY-LICENSES.md.
  ```

  The current NOTICE names "Volition" as the copyright holder; the "no Volition" rule and the
  need for a legal holder conflict here. Options:
  - the owner as a person;
  - the company that publishes (a legal entity may be named even when the brand is not shown);
  - "Helena contributors", which is weak for enforcing the AGPL.

  **Owner decision.**
- **Hermes: MIT** (checked: `/srv/volition/source/hermes/LICENSE`, `pyproject.toml`
  `license = "MIT"`, version 0.21.4). Helena starts Hermes as a separate program and never links
  it, so the MIT terms only require keeping its notice when we ship its image unchanged. The
  live checkout carries **one local commit** ("stream-json: emit the model reasoning as
  reasoning events", 2 files). It goes upstream as a PR before 1.0; until then the image build
  applies it as a patch, and the image then counts as a modified Hermes, which is still
  MIT-compliant.
- **Third-party list:** `docs/oss/THIRD-PARTY-LICENSES.md`, generated. Of 1328 packages, 1302
  are allowed and 5 are notices (sharp's libvips LGPL-3.0, caniuse-lite CC-BY-4.0, Inter
  OFL-1.1). One is blocking: `buffers@0.1.1` declares no license and its repository is gone.
  Fix: `"overrides": { "exceljs>unzipper": "0.12.3" }` (0.12 drops `binary`/`buffers`), then
  test the xlsx import and the vault extraction. The image build later adds the Debian, Node
  and Chromium notices through an SBOM (§8).
- **Contributions:** DCO instead of the upstream ICLA (decision doc §4). CLA only if the owner
  wants the option to relicense.
- **Trademark:** "Helena" is a common name, so a name search in the relevant classes (software)
  is advisable before publication. **Owner decision** (possibly with a lawyer).

## 6. Versions and releases

release-please as it is configured (decision doc §3):
- a release PR from conventional commits; merging it tags `vX.Y.Z` and writes the changelog;
- the image tags follow the version;
- during the battle test: `1.0.0-rc.N`; the first public release is `1.0.0`;
- `@helena/sdk` gets its own SemVer line in manifest mode (plugins declare the range they need);
- migrations only ever go forward; a downgrade is a restore of the pre-migration dump;
- `docs/oss/UPGRADING.md` (to write) lists breaking changes per minor.

## 7. CI

Drafts in `docs/oss/ci/`, never pushed. They move to `.github/workflows/` at the cut:
`ci.yml` (format, lint, typecheck, tests with a Postgres service, the rename kit, license check,
gitleaks), `release.yml` (release-please), `images.yml` (placeholder for the Docker phase),
`codeql.yml`, `scorecard.yml` and `dco.yml`. Actions are pinned by SHA at publication.

## 8. Docker (outline only; "Docker machen wir als Letztes")

### 8.1 Images: two, not one and not six

| Image | Contents | Why |
|---|---|---|
| `helena` | Bun + Node, the built web (standalone), API, worker, migrate/seed/backup tools, the browser router with Chromium and ffmpeg. The entrypoint takes a role: `web`, `api`, `worker`, `router`, `migrate`, `seed`, `all` | One build, one version, one SBOM. The roles share nearly all code, and compose runs one container per role (separate restarts, health and limits). `all` runs a small supervisor for the single-container quickstart |
| `helena-agents` | `FROM nousresearch/hermes-agent:<pinned digest>` + the runner bundle + (optionally) Claude Code and Codex CLIs | The runner spawns `hermes` as a child process with the profile directories and the project workspaces. It must share their filesystem and process space, so it lives *in* the Hermes image. Upstream's image stays untouched below (MIT, s6-overlay supervision, non-root `hermes` user) |

Rejected:
- **Everything in one image:** couples Hermes' Python/Node toolchain (several GB) to every web
  deploy, and gives the web the rights of the agent sandbox.
- **One image per role:** duplicates the monorepo build five times, and the versions can drift.

### 8.2 compose.yml

- `postgres` (17-alpine).
- `migrate` (one-shot, `helena` role `migrate`, under a Postgres advisory lock: two starts
  must never migrate twice; today `migrate.ts` takes no lock).
- `api`, `worker`, `web`, `router` (all `helena`).
- `agents` (`helena-agents`).
- Optional profiles: `bot`, `syncthing`, `code` (code-server).

Volumes: `db`, `vault` (git), `workspaces`, `hermes` (profiles, sessions, memory), `storage`,
`browser` (per-project profiles: they hold logged-in sessions, so they are sensitive), `backups`.

Only `web` publishes a port. The API is reached through the web proxy, or a reverse proxy in
front with `API_HOST=0.0.0.0` inside the network: the API binds to 127.0.0.1 by default, which
no container can reach.

### 8.3 What must change in the code first

- **Browser router without systemd.** Today the provisioning service starts
  `volition-project-browser-{kasm,chromium}@` units.
  - In Docker the router spawns and supervises Chromium per project itself, with a CDP
    screencast for the live view.
  - KasmVNC becomes optional; CDP input covers "Übernehmen".
  - A decision for the owners of package A and the gateway: headful on Xvfb, or headless.
- **Provisioning without systemd or root.**
  - Workspaces, vault folders and Hermes profiles are directories on the shared volumes.
  - `useradd`/ACLs (agent isolation) only exist on the native path; in Docker, isolation is
    the container boundary plus a non-root UID per container.
  - Long term the provisioning folds into the runner (hub/hermes-sync) and the router.
- **Env schema** (audit F13): 54 variables, no schema, two `intEnv` copies. The fix is one zod
  schema per app, with defaults and descriptions, validated at start, with `.env.example`
  generated from it. The rename's compatibility reader lives there too.
- **Logs and health** (audit F14): 86 `console.*` calls, no request id, and `GET /` does not
  check the database.
  - pino with `X-Request-Id`;
  - `/healthz` (process) and `/readyz` (database, migrations current), and the same for the
    worker on a small port (it has no HTTP today);
  - OpenTelemetry later.
- **One document extraction module** (audit F19): today the API uses in-process libraries and
  the vault uses CLI tools (pdftotext, tesseract, pandoc). One module means one set of system
  packages in the image.
- **Secure cookies without `NODE_ENV` tricks** (audit F01): `production` everywhere. Plain-http
  test installs get an explicit, loudly logged `HELENA_INSECURE_COOKIES=1`.
- **The first-user race:** `isFirstUser` counts and inserts without a lock, so two sign-ups
  could both become admin.
- **Telemetry** removed (audit F26).
- **Trusted proxies:** the owner-terminal LAN bypass reads `X-Real-IP` / `X-Forwarded-For`
  from anyone. With a published API port a client can fake a LAN address, and Docker bridge
  addresses (172.16/12) count as "LAN". It must honour these headers only from a configured
  proxy (`HELENA_TRUSTED_PROXIES`), and the bypass is off by default anyway (§8.5).

### 8.4 First run

1. `helena init`, a small script shipped next to `compose.yml`, writes `.env` with generated
   secrets (`BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, the Postgres password, the internal
   control tokens) and `APP_URL`.
2. `docker compose up -d`: the migrate job runs first, then everything starts.
3. **One-time setup link.** With no admin in the database, the API creates a setup token (one
   hour, single use) and the logs print `http://<host>/setup?token=…`. Registration is
   **closed** by default; only this link creates the first account, which becomes
   Administrator. That removes the first-user race. `docker compose exec api helena setup-link`
   prints a new one.
4. The setup page asks for the admin account, the instance name and an optional model key
   (stored encrypted in Zugänge). It offers "Load the demo" (§9) and ends on the Home page with
   the Home agent online.

### 8.5 Secure defaults for other people's installs

- No LAN auto-login: `LOCAL_SINGLE_USER_*` unset.
- Owner terminal only with TOTP: `stepUpRequired` stays true and no LAN bypass unless it is
  switched on with explicit CIDRs and trusted proxies.
- No telemetry.
- Registration closed.
- The API, Postgres and CDP not published.
- Agent runs with the approval guard.
- Autopilot level 1 ("act with approval") as the default for new agents; package E.

### 8.6 Upgrade, backup, restore

- **Upgrade:** `docker compose pull && docker compose up -d`. The migrate job takes the
  pre-migration dump (`backup.ts`, retention 30 days) and applies the migrations under the lock.
  A downgrade means pinning the old tag and restoring that dump.
- **`helena backup`:**
  - `pg_dump -Fc`, the vault as a git bundle plus its untracked files, and the workspaces;
  - Hermes profiles, sessions and memory, without caches;
  - `storage`, and the browser profiles only with `--with-browser-sessions`;
  - `.env`; the backup is encrypted with age or GPG if a recipient is configured.
  - `APP_ENCRYPTION_KEY` is printed as a warning: without it the stored credentials are lost.
- **`helena restore <archive>`:** into an empty stack; it checks the version and runs the
  migrations afterwards.
- The same two scripts work natively (systemd timer), replacing the retired Garage/Nextcloud
  backup.

### 8.7 Quickstart budget: under 15 minutes on an empty machine

| Step | Time |
|---|---|
| Install Docker (not counted; prerequisite) | – |
| Download `compose.yml` + `helena init` | 1 min |
| Pull images: `helena` ~0.6 GB, `helena-agents` (Hermes base with Playwright Chromium, Python, Node) ~3–4 GB, Postgres 0.1 GB | 5–7 min at 100 Mbit/s |
| First start, migrations of an empty database | 1 min |
| Setup link, admin, demo crew | 3 min |
| **Total** | **10–12 min** |

The Hermes image dominates. If the budget gets tight: a slimmer `helena-agents` variant
without the messaging extras (upstream's image bakes Matrix, Google Chat and others in), or
prebuilt multi-arch images on GHCR.

## 9. Demo

- **Seed:** `scripts/helena-demo/seed.ts`, idempotent and API-only (the same transport as the
  pool setup). It uses the Home agent, the pool templates (`researcher`, `tech-writer`,
  `planner`, `qa`), two projects ("Website relaunch" `SITE`, "Operations" `OPS`) each with its
  coordinator and specialists copied from templates, sample tasks, a weekly routine and a
  builder workflow (research → write → review with an approval step). Nothing is assigned
  unless `--start-work` is given, so no model runs without the user deciding it.
- **"Demo without an API key":** design in `scripts/helena-demo/README.md`. A replay runtime
  answers from recorded runs through the runtime-adapter extension point (§3a), so it is a
  plugin like any other runtime; no special path in the core.

## 10. Owner decisions

1. **Copyright holder** in NOTICE and the headers: person, company, or "Helena contributors".
2. **DCO or CLA** for contributions.
3. **gitleaks** installation, plus TruffleHog once (versions and sizes in the decision doc).
4. **Maintenance window** for the rename (about 10 minutes). Pause the agents beforehand.
5. **GitHub organisation and repository name** at publication; a trademark check for "Helena".
6. The Hermes patch: send it upstream as a PR under whose GitHub account.
7. Whether the native Debian install is a supported public path next to Docker (recommended:
   yes, as "advanced").

## 11. Open

- The repository codemod script: its data is in the map. Write it right before the rename
  window so it runs on the then-current tree.
- The `unzipper` override for `buffers`: it touches `bun.lock`, and xlsx import tests are
  needed.
- Agent-pool templates in English.
- Screenshots and a short video: after the UI work settles, from the demo crew.
- The Docker phase itself (§8), with the code prerequisites of §8.3 as its first tasks.
