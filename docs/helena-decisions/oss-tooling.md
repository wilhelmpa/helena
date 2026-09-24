# Decision: tooling for the open-source release

Package G ("Open-Source-fertig"), per the rule "Standards statt Eigenbau" (§3b of the Helena
OSS plan): for each building block, the established options were compared on maturity,
maintenance, adoption, license and fit, and the rejected ones are listed with the reason.
Nothing here is installed yet. Every binary tool below needs the owner's OK before it is
downloaded (§3b rule 4); the choices are made so that the day-to-day checks run without one.

Status: proposed 2026-09-24, hub/oss-packaging.

## 1. Third-party license list from the lockfiles

**Decision: `bun pm licenses --json`, plus a thin policy layer (`scripts/helena-licenses.ts`).**

Bun 1.4 ships a license reader: `bun pm licenses --json [--prod]` lists every installed
package of `bun.lock`, grouped by its declared license. The script adds what Bun does not
have: the AGPL policy of §3b (allowed / notice / review / forbidden), SPDX expressions
(`OR` takes the best alternative, `AND` the worst part), the `package-lock.json` files of the
Node services outside the workspace (a v3 lockfile carries each license), a Markdown report
(`docs/oss/THIRD-PARTY-LICENSES.md`) and a `--check` mode for CI (exit 1 on a forbidden
license, 2 on an unreviewed runtime one). It is a few hundred lines, has tests, and needs no
new dependency.

First run (2026-09-24, 1328 packages): 1302 allowed, 5 notices, 1 to review.

| Package | License | What to do |
|---|---|---|
| `@img/sharp-libvips-*` 1.3.3 | LGPL-3.0-or-later | Allowed: a separate shared library the user can replace. Name it in NOTICE. |
| `caniuse-lite` | CC-BY-4.0 | Allowed: build-time data. Keep the credit. |
| `inter-ui` 4.1.1 | OFL-1.1 | Allowed: the UI font. It must not be sold on its own. |
| `buffers` 0.1.1 | none declared | **Blocking.** Its upstream repository is gone, so no license can be shown. It comes in through `exceljs → unzipper 0.10 → binary`. unzipper 0.12 no longer depends on `binary`. Fix: `"overrides": { "exceljs>unzipper": "0.12.3" }`, then test the xlsx import and the vault text extraction. |

Rejected:

| Option | License | Why not |
|---|---|---|
| `license-checker` / `license-checker-rseidelsohn` | BSD-3-Clause | Walks `node_modules` the npm way and misses Bun's `.bun/` store layout. The original is unmaintained; the fork is thinly maintained. |
| OWASP **cdxgen** | Apache-2.0 | Strong CycloneDX SBOM generator, but a large dependency tree. Its support for the text `bun.lock` could not be confirmed. Reconsider for image SBOMs. |
| **Syft** (Anchore) | Apache-2.0 | The best SBOM tool for images, but a Go binary (needs an OK). It becomes the SBOM step of the image build in CI (`anchore/sbom-action`, runs on GitHub's runner) once there is an image. |
| ORT (OSS Review Toolkit) | Apache-2.0 | The most thorough compliance pipeline, but it runs on the JVM, needs heavy setup and is built for large organisations. |
| ScanCode Toolkit | Apache-2.0 | File-level license detection in sources. Too slow and too noisy for every CI run. Worth one run before 1.0 over the vendored parts (e.g. `security-images/gosu`), if those stay. |

Later, for Helena's own files: the **REUSE** specification (FSFE) with SPDX headers
(`SPDX-License-Identifier: AGPL-3.0-only`) makes each file's license machine-readable. The
`fsfe/reuse-action` runs in CI with nothing installed locally. This is optional and not
needed for 1.0.

## 2. Secret scanning

**Decision: gitleaks as the main scanner.** It runs in three places: a lefthook pre-commit
step, CI, and a one-off scan of the full private history before the public cut. A second,
private rule file detects private data (names, host names, LAN addresses, mail addresses,
project keys). Before the first publication, TruffleHog runs once as a second opinion. After
publication, GitHub secret scanning with push protection is switched on.

| Option | License | Strengths | Weaknesses | Role |
|---|---|---|---|---|
| **gitleaks** | MIT | Single Go binary, fast on full history, regex rules in TOML (our own `hel_`/`itp_` key formats), SARIF output, `--redact` so reports never print the secret | Matches shapes only, not live credentials | **Main scanner** |
| TruffleHog OSS | AGPL-3.0 | Checks whether a found credential is live, 800+ detectors, also scans images and S3 | Checking a key means sending it to its provider; heavier; license fine for a tool we only run | One pre-publication pass, without verification unless the owner allows it |
| detect-secrets (Yelp) | Apache-2.0 | Baseline-file workflow | Python, less active; the baseline file itself needs care | Rejected |
| GitHub secret scanning + push protection | service | Free for public repos, blocks pushes server-side | Only after publication | Switch on at publication |
| ggshield (GitGuardian) | MIT client, commercial service | Very good detection | Sends content to a SaaS | Rejected |

What the owner has to OK: the gitleaks binary (current 8.x release from its GitHub releases,
checksum-verified, about 7 MB) on the Mac and on Kingston. TruffleHog, optionally, for the
one-off pass.

Findings in the *private* history must be **rotated**, not only kept out of the public tree.
The private clones (Mac, Kingston, agent clones) still hold them, and a fresh public history
does not remove what already exists.

## 3. Versioning and releases

**Decision: keep release-please (Apache-2.0).** It is configured already
(`release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release.yml`),
and our commit messages already follow Conventional Commits (`pr-title.yml` enforces them on
PRs). It keeps an open release PR that a person merges, which suits "publication only with
the owner's OK".

| Option | License | Model | Fit |
|---|---|---|---|
| **release-please** | Apache-2.0 | Conventional commits → release PR → tag + GitHub release + CHANGELOG | Already set up; one product version plus the image; a human merges; manifest mode handles several packages |
| Changesets | MIT | Each PR adds a changeset file; a bot bumps and publishes packages independently | Best for many npm packages with their own versions. Worth reconsidering when `@helena/sdk` and `@helena/runner` are published on their own schedule |
| semantic-release | MIT | Fully automatic release on every merge | No review step before a release; weaker monorepo support |
| release-it | MIT | Interactive local releases | Manual, not CI-first |

Scheme:
- SemVer for the product and the image. Tags `vX.Y.Z`. Image tags `X.Y.Z`, `X.Y`, `X`, `latest`, plus `edge` from `main`.
- Until 1.0 (release criteria §5 of the OSS plan): `1.0.0-rc.N` pre-releases during the battle test. The first public release is `1.0.0`.
- `@helena/sdk` gets its own SemVer line (manifest mode), because plugins declare the SDK range they support (`engines.helena` in `helena.plugin.json`).
- Only the latest minor gets security fixes until there are users who need more.
- The upstream CHANGELOG stays in the private repository as history. The public repository starts a new `CHANGELOG.md` at 1.0.0 that links to the upstream project for everything before the fork.

## 4. Community health files

**Decision: the full GitHub community profile set, written fresh for Helena.**

GitHub recognises `README`, `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `SUPPORT.md`, `.github/FUNDING.yml`, issue forms under
`.github/ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`, discussion forms under
`.github/DISCUSSION_TEMPLATE/`, and `CODEOWNERS`. Drafts are in `docs/oss/`; they move to the
repository root at the public cut.

| File | Choice |
|---|---|
| Code of Conduct | Contributor Covenant 2.1 (the text upstream uses). Change the contact from the upstream address to Helena's. |
| Contributions | **DCO** (Developer Certificate of Origin 1.1, `Signed-off-by:`, checked by a small workflow), instead of the upstream ICLA. The ICLA grants rights to the upstream author and must go either way. DCO is the lightweight standard (Linux, CNCF). A CLA only makes sense if the owner wants to be able to relicense later (e.g. dual licensing); **owner decision**. |
| Security | GitHub private vulnerability reporting, a response window, the supported-versions table, and the self-hosting hardening notes. |
| Support | Discussions for questions, issues for bugs, no private support promise. |
| Issue and PR forms | The upstream YAML forms, adapted: runtime (Hermes / Claude Code / Codex), install type, logs checklist. |
| CODEOWNERS | The owner's GitHub handle or team, set at publication. |
| Funding | None at launch (the upstream wallet addresses and referral links are removed). |

Supply-chain hygiene in the same step, all as GitHub Actions with nothing installed locally:
- OpenSSF Scorecard (Apache-2.0).
- Dependabot for npm, GitHub Actions and Docker base images.
- Actions pinned by commit SHA, with least-privilege `permissions:`.
- CodeQL for TypeScript (the workflow exists already).

## 5. Fresh public history

**Decision: a new repository with one root commit, built from an export of the release tree.
The private history is not rewritten.**

The owner asked for a fresh history. `git archive` of the release commit is filtered by the
public manifest (the core/private classification in `docs/helena-oss-packaging.md`) and
committed once as "Helena 1.0.0". It is checked by the license check, gitleaks with the
public and the private rule file, and the test suite. It then becomes a new repository.

Rejected: rewriting the existing history with **git-filter-repo** or **BFG Repo-Cleaner**.
Both are good tools, but the result keeps 1,000+ commits of private context: owner names in
commit messages, host names, paths and the upstream fork's history. Every missed item would
become public. A single root commit has nothing to miss beyond the tree itself, and the tree
is what the scanners check.

## 6. CI

**Decision: GitHub Actions**, since the public repository lives on GitHub. The drafts are in
`docs/oss/ci/`; they are written but never pushed. They move to `.github/workflows/` at the
cut. Jobs:
- `ci.yml`: format, lint, typecheck, unit tests, the API suite against a Postgres service container, the rename-kit tests, `helena-licenses --check`, gitleaks.
- `release.yml`: release-please.
- `images.yml`: multi-arch image build with BuildKit SBOM + provenance attestations, pushed to GHCR on tags. Filled in at the Docker phase ("Docker machen wir als Letztes").
- `scorecard.yml`, `codeql.yml`, `dco.yml`.

Rejected: keeping the upstream workflows as they are. They publish `ghcr.io/croffasia/itsaplan-*`, run the CLA bot for the upstream owner, and move a `release` branch for Coolify.
