# Host tools in Helena's Update Center

2026-09-26 · owner remaining item 7b. No package was downloaded or installed while
implementing this change. The owner's existing Update Center confirmation starts it.

## Contract and sources

The existing root-owned `helena-update` accepts `host-tool` with **only** `tool` and an
exact stable `version` (and spool id/action). It rejects arbitrary URLs, commands, paths,
units, missing installed tools, downgrades and Node major migrations. Inventory advertises
`hostToolApply`; Helena offers Apply only when the installed helper reports that capability.
Old helpers remain readable. The API has no root privileges or new dependency.

| Tool | Pinned artifact and integrity | Activation |
| --- | --- | --- |
| code-server | Official `coder/code-server` release archive, exact tag/name/platform, GitHub asset SHA-256 and size | Stable `/usr/local/bin/code-server` → parallel version; editor only |
| Bun | Official `oven-sh/bun` release ZIP, exact `bun-v…` tag/platform, GitHub asset SHA-256 and size | Bun/bunx share one version pointer; API and worker |
| Node.js | Exact official `nodejs.org/dist/v…` archive and entry in HTTPS `SHASUMS256.txt` | node/npm/npx share one version pointer; web, provisioning, terminal and browser router |
| Wetty | Exact official npm manifest `dist.integrity`; fresh lockfile with registry HTTPS SHA-512 for every dependency; `npm ci --ignore-scripts` | Terminal router only |
| KasmVNC | Official `kasmtech/KasmVNC` release Debian archive matching Debian codename/architecture, GitHub asset SHA-256 and size | Extract beside dpkg install, no maintainer scripts or `/usr` replacement; own Kasm display and paired Chromium units |

The digests are obtained from **TLS-authenticated official metadata**, not independently
verified publisher signatures. Missing digests fail closed; an integrity hash computed
from the downloaded bytes alone is never accepted. Metadata requests were checked against
official endpoints: code-server 4.138.0, Bun 1.4.2, KasmVNC 1.5.0 and Wetty 3.2.2.
GitHub's release metadata needs its JSON Accept header (binary Accept returns HTTP 415).

Primary references:

- [GitHub release asset API and digest field](https://docs.github.com/en/rest/releases/assets)
- [code-server standalone archive contract](https://github.com/coder/code-server/blob/main/docs/install.md)
- [Bun installation and platform archives](https://bun.sh/docs/installation)
- [Node official release manifests](https://nodejs.org/download/release/)
- [KasmVNC package distribution](https://github.com/kasmtech/KasmVNC)
- [npm ci and ignore-scripts](https://docs.npmjs.com/cli/v11/commands/npm-ci/)
- [node-pty native build requirements](https://github.com/microsoft/node-pty#dependencies)

The installed Wetty uses node-pty 1.1.0; that package has no Linux prebuild. Its verified
source is compiled explicitly with existing npm/node-gyp, local Node headers, make, g++
and Python, as nobody with no new privileges. No lifecycle script is enabled and no tool
or header is installed automatically. Missing tools fail before activation. A real PTY
spawn tests the native ABI and spawn helper. Node updates run the same check against the
installed Wetty before switching. All prepared binaries are smoke-tested unprivileged.

## Boundaries and rollback

- `/opt/helena/host-tools/<tool>/<version>` keeps each prepared installation. `current`
  switches with atomic rename; `previous` and first-adoption legacy link metadata remain.
  Existing regular files are never overwritten. Package modes are made readable but only
  root-writable; escaping links, device files, archive traversal and duplicate members fail.
- Only declared official HTTPS hosts may receive artifact requests, including redirects;
  no inherited proxy, credentials or npm user configuration. Downloads, extraction, command
  execution and readiness have bounded sizes/times. Logs identify steps and failures without
  echoing arbitrary vendor scripts, credential configuration or signed redirect queries.
- Local PostgreSQL peer authentication checks pending/running agent runs and pending/streaming
  chat turns before downloads. A second transaction takes SHARE locks on both queue tables
  during switch/restart/smoke/rollback; new work waits instead of racing the restart. Busy or
  unavailable database means defer with a visible error, no forced interruption.
- Only active affected Helena units restart. Stopped services stay stopped. The Hermes
  runner uses `/usr/bin/node`, so it is unaffected by updating `/usr/local/bin/node`.
  Independent running development previews keep their current processes.
- KasmVNC installs `Xkasmvnc`, not `Xvnc`; dpkg normally creates that alternative. The managed
  version supplies its own Xvnc link and a dedicated unit drop-in using the matching web
  assets. A display restart also disconnects that project's Chromium; its paired unit is
  included explicitly, with systemd ordering. Profiles and other projects' files stay intact.
- On a failed switch, restart or smoke check, all original links/drop-in content are restored,
  the same affected units restart and their health is checked. A failed rollback is reported
  as requiring an operator check; it is never labelled success. Uncatchable host/process
  failure mid-activation still requires operator reconciliation of retained links/versions.

## Hermes and deployment

`deploy.sh` refreshes the installed Hermes helper using `install.sh --refresh`, which copies
only helper code: no fetch, package install, login, service restart or release-track change.
The scoped offline-check parts of `cbd7fcaa` and `1c06acb0` are reused: CLI `--offline` and
the Update Center's god-only `/god/update-center/hermes/refresh-local` reconcile cached Git
refs through the existing runner spool. Offline metadata does not suppress the next online
scheduled check. The unrelated LAN and display-label changes were not imported.

## Verification

Kingston fixture validation: 31 host-tool helper tests, 14 Hermes helper tests,
18 API integration tests and 4 runner update tests passed. API, runner and SDK
typechecks and lint passed; changed files pass formatting and diff checks.
KasmVNC activation includes only already-running paired browser units; a stopped
Chromium remains stopped. The seven existing host-tool entrypoints are symlinks,
so the guarded first-adoption path matches this installation. These are preparation
results; no host package was downloaded, installed or upgraded during validation.

## Acceptance

Offline fixture tests cover source/digest validation, safe archives, parallel activation,
busy gates, rollback of all original links, exact unit sets, helper capability gating and
API failure visibility. No root, network artifacts, package installation or live mutation
is needed to run these tests.

After normal gated deployment: read helper inventory and Helena's Update Center to verify
the five Apply capabilities; verify installed helper content and refresh-local behavior.
An actual package update requires the owner's Apply click. At that point verify its recorded
source/target, old/new executable, affected unit health, UI error/result, and retained previous
version. For Wetty open a project terminal; for KasmVNC check existing project tabs and CDP;
for code-server open an existing project file. Deploying this code alone updates no tools.
