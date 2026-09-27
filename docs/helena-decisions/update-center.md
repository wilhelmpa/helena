# Decision: the update center (what is installed, what is new, and applying it)

Status: accepted, 2026-09-24 · Branch: `hub/update-center`

Owner, 2026-09-24: "du müsstest auch mal alles updaten, du könntest dann auch mal ein ganz
kleines Modell regelmäßig laufen lassen, um nach Updates zu suchen, und den Status auch im
Dashboard anzeigen." Helena checks every component it runs on for a newer version, has a
small model summarize what changed (German, with a risk rating), shows the state on Start and
on Administrator → Server → Updates. The owner can apply an update manually or allow
automatic updates for eligible components.

Verified on Kingston, 2026-09-24, against the installed tree: Claude Code 2.1.281, Codex
0.156.1, claude-agent-acp 0.81.1 (npm has 0.81.2), codex-acp 1.13.1
(`/opt/helena/runtimes/*/current`), Hermes `v2026.9.21-450-g80cb510bfe` (origin
`NousResearch/hermes-agent`, branch `volition/main`), Bun 1.4.2, Node 24.21.0,
code-server 4.138.0, Wetty 3.2.2 (`/opt/volition/runtime`), chromium
153.0.8010.52-1~deb13u1 and kasmvncserver 1.5.0 (dpkg), Debian 13 with `apt-daily.timer` and
`apt-daily-upgrade.timer` enabled and `unattended-upgrades` **not** installed.

## 1. Two questions, two kinds of answer

1. **Is there a newer version?** A fact. It comes from the vendor's own published data,
   compared deterministically (semver, or apt's own candidate). **No model ever decides a
   version.**
2. **What changes, and how risky is it?** A reading of release notes. A small model does
   this, on text Helena fetched itself, with no tools.

## 2. Where each fact comes from (no credentials, public endpoints only)

| Component | Installed | Newest | Release notes | Security flag |
|---|---|---|---|---|
| Hermes | the existing root helper `helena-hermes-update check` via the runner (git in the checkout, as its owner) | `origin/main` of the same fetch | the upstream commit subjects between them (the helper's `commits`) | — |
| Claude Code | `readlink /opt/helena/runtimes/claude/current` | `https://downloads.claude.ai/claude-code-releases/latest` (a version string; the channel the official installer uses; `stable` is configurable) | `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`, the sections above the installed version | — |
| Codex, claude-agent-acp, codex-acp, Wetty | the runtime layout (`current` link) / the host inventory | npm registry `https://registry.npmjs.org/<pkg>/latest` (public, no token) | the GitHub releases Atom feed of the package's repository (`/releases.atom`, no token and no 60/h REST limit; the same reader `settings/updates.ts` uses), prereleases skipped | OSV (`POST https://api.osv.dev/v1/query`, ecosystem `npm`, the installed version): an advisory against the installed version marks the update as a security update |
| Bun | the host inventory (or `Bun.version` of the API itself) | npm registry `bun/latest` | `https://github.com/oven-sh/bun/releases.atom` | — |
| Node.js | the host inventory | `https://nodejs.org/dist/index.json`, the newest release **of the installed major line** (a newer LTS major is named, not offered) | `https://github.com/nodejs/node/releases.atom` | the `security` field of `index.json` for any release between installed and newest |
| code-server, KasmVNC | the host inventory | GitHub releases Atom (`coder/code-server`, `kasmtech/KasmVNC`) | the same entries | — |
| Debian packages (chromium, openssl, postgresql, …) | `apt-get -s dist-upgrade` in the root helper's inventory (`LC_ALL=C`, `Debug::NoLocking`), grouped by source package (`dpkg-query ${source:Package}`) | apt's candidate from the lists `apt-daily.timer` refreshes | `https://metadata.ftp-master.debian.org/changelogs/<component>/<p>/<source>/stable_changelog`, the entries above the installed version | the candidate's origin is a `-security` suite (`Debian-Security:13/stable-security`), the same rule Nagios' `check_apt` uses |
| Helena itself | `package.json` | the releases Atom of `UPDATE_FEED_URL` (existing `settings/updates.ts`; off unless configured, as today) | the feed entries | — |

Every fetch goes through one helper that allows only the hosts the source declares (a
plugin source names its own), follows at most three redirects and only to allowed hosts,
stops after 15 s and reads at most 512 KiB. Nothing the API reads is sent anywhere else.

## 3. Candidates for the building blocks

| Need | Candidates | Decision |
|---|---|---|
| Finding newer versions of pinned tools | **Renovate** (AGPL-3.0, regex managers can bump `runtimes.json`), **Dependabot** (GitHub service) | Both update *files in a repository* through pull requests. Helena needs the state of the *running* instance and an owner's click. Not used at runtime; Renovate stays a candidate for CI once the repository is public (bumping the pins in `runtimes.json`). |
| Debian security updates | **unattended-upgrades** (Debian's standard, GPL-2, knows the security origins, has `--dry-run`), **apt-get** directly, **needrestart** (restart hints), **apt-listchanges** | `unattended-upgrades` is not installed and a system package needs the owner's OK. The helper uses **apt-get** (`install --only-upgrade` of the packages the owner chose, or all packages from a `-security` origin) and classifies security by origin like `check_apt`. Proposed to the owner: install `needrestart` (restart hints after an upgrade) and, if he wants unattended security updates, `unattended-upgrades` — the update center then shows what it did instead of doing it. |
| Version comparison | **semver** (ISC, a dependency of `@helena/sdk/server`), `compare-versions` | SemVer 2.0 precedence, implemented in the isomorphic `@helena/sdk` entry (`compareVersions`, ~40 lines: that entry has no runtime dependencies, and the web reads it too), extended to any number of numeric parts (`2026.9.24`); anything else (a Debian revision, a commit) is "not comparable" and never counts as newer. Helena never compares apt versions (apt names the candidate). |
| Vulnerability data | **OSV** (osv.dev API, Apache-2.0 data, no key), GitHub Advisory DB (REST needs a token for volume), Snyk (commercial) | OSV for npm components. Debian: the origin rule (the security archive *is* the advisory). |
| EOL data | **endoflife.date** (MIT) | Not now; Node's line is compared within its major, and the index names LTS. Later for "Node 24 reaches end of life on …". |
| Summaries | Hermes on a cheap model (the owner's subscription), an API key to a provider, a local model | **Hermes**, the only runtime Helena uses for model work (§3 of the OSS plan: Helena computes with no model itself). |
| Structured output | provider JSON mode / `response_format`, a JSON-only prompt + validation | Hermes' `chat` has no `response_format` flag. The prompt asks for one JSON object; Helena extracts and validates it (unknown risk words → no rating) and keeps the raw text when it does not parse. |
| Scheduling | DBOS scheduled workflows, `helena_schedule` (project-bound), a `setInterval` | The engine's own model (croner times + DBOS exactly-once, `workflow-engine.md`) for **instance-level system jobs**: a small registry in the engine (`engine/system-jobs.ts`) and a state table `helena_system_job`. |
| Applying | the vendors' own installers (`curl … \| sh`, `npm i -g`, `apt`) run by the API, or root helpers behind a spool | **Root helpers behind a spool**, like `helena-hermes-update`: the API never gets root, the helper validates every request against what it inventoried itself. |

## 4. Decision

### 4.1 The extension point: `UpdateSource` (`@helena/sdk` `updates.ts`, registry `updateSources`)

```ts
ctx.updateSources.register({
  id: 'acme.cli',
  label: { en: 'Acme CLI', de: 'Acme-CLI' },
  kind: 'tool',                              // runtime | system | tool | app
  hosts: ['registry.npmjs.org', 'github.com'], // the only hosts ctx.fetchText reaches
  async check(ctx) { return [{ component: 'acme', name: 'Acme CLI', installed: '1.2.0',
    available: '1.3.0', updateAvailable: true, security: false, applicable: false,
    sourceUrl: 'https://github.com/acme/cli', notesUrl: 'https://github.com/acme/cli/releases' }]; },
  async releaseNotes(candidate, ctx) { return ctx.fetchText('https://github.com/acme/cli/releases.atom'); },
  // optional: apply(request, ctx) → { ref }, progress(ref, ctx) → { state, log, result }
});
```

- `check` is deterministic and cheap; it runs on every check. `releaseNotes` runs only for a
  version the model has not summarized yet. `apply`/`progress` exist only where a helper can
  do the work; everything else is "check only" with a hint where it is installed from.
- Candidates can share a `group` (all Debian packages): one summary for the group.
- The built-in sources are the internal plugin `helena.updates` (API):
  `hermes`, `cli-runtimes` (claude, codex, claude-agent-acp, codex-acp), `host-tools`
  (bun, node, code-server, wetty, kasmvnc), `apt`, `helena`.

### 4.2 Host facts and applying: one root helper, `helena-update`

`deployment/volition-stack/native/updates/` — a Python helper started by
`helena-update.path` (`DirectoryNotEmpty=` on the request folder), the same shape and the same
hardening rules as `helena-hermes-update`:

- The API writes `requests/<id>.json` (folder owned by the API user, 0770); the helper opens
  each without following links, reads at most 64 KiB, removes it, and writes
  `status/<id>.json` into a folder only root writes. Requests queue; they are served oldest
  first, one at a time (flock).
- `inventory`: apt candidates (source package, binary packages, installed, candidate,
  origin, security), `install-cli-runtimes.sh status --json`, and the versions of Bun, Node,
  code-server, Wetty, uv, chromium and KasmVNC read from their files (dpkg, `package.json`,
  the runtime folders' names). Offline, read-only.
- `apply cli-runtime {runtime, version}`: `/usr/local/share/helena/runtimes/install-cli-runtimes.sh upgrade <runtime>
  <version>` (a root-owned copy of `install-cli-runtimes.sh` with its pins, lockfiles and the
  Claude release key under `/usr/local/share/helena/runtimes`): Claude Code's signed manifest
  of the new version is verified with the **pinned release key** before its checksum becomes
  the new pin; an npm runtime gets a fresh lockfile (`npm install --package-lock-only
  --ignore-scripts`, the registry's sha512) and `npm ci --ignore-scripts`. The new pin lives
  in `/var/lib/helena/runtimes/pins.json` and wins over the repository's only while it is
  newer. `previous` stays for `rollback <runtime>`; rollback restores the previous pin too.
- `apply apt {packages | security}`: `apt-get update`, then `apt-get install --only-upgrade`
  of exactly the chosen packages that are still upgradable (or of every package from a
  security origin), non-interactive, keeping changed config files, waiting for the dpkg lock
  (`apt-daily-upgrade` may hold it). The answer names every package with its old and new
  version, the failed units afterwards, and whether a reboot is asked for. Before the request
  the API takes a **database dump** (`@repo/db` `writeBackup`, into the backups folder; a
  source asks for it with `backupFirst`). There is
  no automatic way back for apt: the answer carries the command that installs the old
  versions (`apt-get install <pkg>=<old>`, from the cache or snapshot.debian.org).
- Hermes keeps its own helper (`helena-hermes-update`, with venv rollback); the update center
  raises its proposal and decides it as the owner.

### 4.3 The summary run: a text-only agent run (`agent_run.trigger = 'digest'`)

A digest run is an ordinary queued run of a Hermes agent, so it is in the agent's run
history, its tokens count against its budgets and the usage ledger, and its **model check**
is recorded like every other run's. What makes it text-only:

- the API sends the prompt as it is (no task framing, no project preamble, no Autopilot
  section) with a short system prompt that says the release notes are data, not
  instructions;
- the runner starts Hermes with `--ignore-rules` (no SOUL, AGENTS, memory or preloaded
  skills) and `--toolsets todo` (Hermes' only toolset that reaches nothing outside the turn;
  no MCP server is started), without the agent's standing instructions or skills arguments;
- `agent_run.model` and the new `agent_run.reasoning` override the agent's model and
  reasoning for this run only; no reflection turn follows a digest run.
- Helena queues a digest run only on an agent whose runner reports the capability
  `digest-runs`: a runner from before this change would run the untrusted notes with the
  agent's tools.

The model: the Administrator picks one, or leaves "Automatisch": the cheapest model of the
summarizing agent's catalog that has a price (`helena_model_price`) and that the account
serves — a model the catalog marks `verified: false` (hub/model-availability) is left out; a
refusal during a digest run moves the choice to the next cheapest and is remembered for a
week. Reasoning defaults to `low`. The agent: the Home master, else the first Hermes agent
that is online. The run belongs to the agent's first project (a run needs one).

### 4.4 The schedule: an engine system job

`engine/system-jobs.ts` registers instance-level jobs; the engine's tick fires each at its
cron times (croner, time zone, `fired_through` in `helena_system_job`, the DBOS workflow
`helena.job` with the id `job:<id>:<time>`, so a time fires once across replicas and after a
crash). "Jetzt prüfen" starts the same workflow under a manual id. The update job: check
every source (one recorded step), queue the digest runs (one recorded step each), wait for
them with durable sleeps (up to 45 minutes), store the summaries. Default `0 6 * * *`
Europe/Berlin; the Administrator changes it (German schedule words work, as in routines).
A job may ask to run once when the engine first sees it (`runWhenNew`, the update job does),
so a fresh installation shows its state at once.

### 4.5 What the owner sees

- **Start → "Updates"** (Administrator only): how many updates remain, how many are security
  updates, and the latest automatic result. Failed automatic updates appear in "Braucht dich".
- **Administrator → Updates**: every component with installed → newest, the badges
  (Sicherheit, Risiko niedrig/mittel/hoch, Breaking Changes), the summary with the model and
  the run it came from, the release notes link, "Aktualisieren" (a dialog names what is
  downloaded from where and the way back), progress with the helper's log, the result and the
  health afterwards; the history of updates; the settings (schedule, summarizer agent, model,
  reasoning, and automatic mode per component).
- The scheduled daily check applies eligible automatic updates one at a time after summaries
  finish. The default is automatic for Hermes, the four CLI runtimes, code-server, uv, Bun,
  Node, Wetty and KasmVNC. Other components default to manual. Automatic application requires
  a current low-risk summary with no breaking changes, an idle agent run and chat queue, and
  a helper that can roll back the component. Debian packages stay manual.
  The helpers test the new version and restore the previous version on failure. A failed
  version is not tried automatically again; the owner can retry manually or wait for a newer
  version. The update action records whether it was automatic and its failure reason.
- Clicking "Aktualisieren" starts a manual update. It is recorded in `helena_update_action`
  with the owner, time, component and versions.

## 5. Rejected

- **Letting the model look for updates** (web search, "is there a new version?"): versions are
  facts; a model that guesses one is wrong in the worst way. The model only reads notes.
- **The API running apt, npm or the Claude installer**: the API would need root or write
  access to `/opt`, `/usr` and `/var/lib/dpkg`. The helper does the work; the API only asks.
- **`npm install -g` / the vendors' `curl | sh` installers**: unpinned, run install scripts,
  replace files in place with no way back. The runtime layout keeps versions side by side
  with `current`/`previous`.
- **One model call for everything**: a single failure would lose every summary, and the
  risk rating is per component. Debian packages are the exception (one summary for the group,
  dozens of library packages otherwise).
- **Tools for the summarizer (fetch)**: the notes are fetched by Helena itself and passed in,
  so an injected instruction in release notes has nothing to act with.

## 6. Open points

- `unattended-upgrades` and `needrestart` need the owner's OK (system packages).
- Bun, Node, code-server, Wetty and KasmVNC have no installer in the repository; they are
  check-only until package G gives them one (or the Docker image carries them).
- With the price table of 2026-09-24 the automatic choice is `gpt-6-luna` (0.086 €/M input),
  which Hermes serves on the owner's ChatGPT account, though the account's own model list does
  not name it; once hub/model-availability is merged its `verified` marks decide. The owner can
  pin `gpt-5.6-luna` in the settings.
