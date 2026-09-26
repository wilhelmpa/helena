# Codex owner-terminal update acceptance

Verified on 2026-09-26. This concerns Helena's Codex CLI, including Home,
"Helena weiterentwickeln", and the two local Qwen terminal presets.

## Runtime and update contract

All Codex presets start `/usr/local/bin/codex`. The Update Center inventories
`/opt/helena/runtimes/codex/current` and updates that runtime through the existing
root-owned `install-cli-runtimes.sh upgrade codex <version>` helper. The installer
checks the staged CLI's version, retains the previous version and switches the
managed links. No second user-local installation is needed.

The read-only inventory found managed Codex **0.157.1** and the owner's legacy
`~/.local/bin/codex` at **0.156.1**; sanitized `--version` calls confirmed both.
The deployed owner shell explicitly selected the legacy path. Both terminal
services run as `wilhelmpa`. The prepared local Qwen launcher selected the same
legacy path. The official [OpenAI changelog](https://learn.chatgpt.com/docs/changelog)
lists Codex CLI 0.157.1 for 2026-09-26, distributed as `@openai/codex@0.157.1`.

The npm `latest` reader and semver comparison already compare the managed
version. Checks fetch fresh inventory; completed applies trigger a fresh check.
No separate cache or version-comparison defect was established. A current
managed version correctly has no update button. The launcher correction makes
that same version the one newly opened Codex terminals execute.

UID, working directory, `HOME`, inherited cloud `CODEX_HOME`, login state and
resume behavior remain unchanged. Local Qwen tabs retain their separate
`~/.local/state/helena-owner-terminal/<kind>-<name>/codex` state. No credentials
or history are copied, removed or migrated. The legacy user-local package is
left intact. A manually typed `codex` in an arbitrary login shell still follows
that shell's PATH; this does not change the owner's shell configuration.

Existing tmux sessions and their running Codex processes keep their existing
binary version until the process exits. Reattaching does not upgrade or restart
them. New processes use the managed version. Never kill a working conversation
to make its displayed version match the update inventory.

## Root acceptance after the shared gate and deployment

1. Integrate and deploy through the ordinary release process. Do not restart
   `helena-owner-tmux.service`, remove the user-local package or rewrite the
   owner's Codex configuration. Managed 0.157.1 is already installed on the
   inspected host; this correction requires no model/package download.
2. As the ordinary owner Unix account, inspect the managed binary without
   reading any login directory:

   ```sh
   readlink -f /usr/local/bin/codex
   proof_home=$(mktemp -d)
   trap 'rmdir "$proof_home" 2>/dev/null || true' EXIT
   env -i HOME="$proof_home" CODEX_HOME="$proof_home" \
     PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/codex --version
   ```

   Expect the managed runtime path and `codex-cli 0.157.1` on this inventory.
   Codex may create files in the synthetic directory; retain that directory for
   normal fixture cleanup if `rmdir` reports it is not empty. Do not inspect or
   use the owner's real Codex home for this version probe.
3. In **Administrator → Updates** (`/god/updates`), inspect the **Codex CLI** row.
   The authenticated read route is `GET /god/update-center`; identify
   `source=cli-runtimes`, `component=codex`. If a check is needed, the existing
   UI check uses `POST /god/update-center/check`. That check contacts upstream
   sources and may generate configured summaries. A future newer version is
   applied through the existing confirmation and
   `POST /god/update-center/items/:itemId/apply`, then followed through
   `GET /god/update-center/actions/:actionId`.
4. Open a **new** Home Codex tab and a **new** "Helena weiterentwickeln" Codex tab
   through their normal presets. Confirm the CLI's visible startup version,
   appropriate working directory and existing resume behavior. Keep existing
   tabs attached; they must not restart. An idle old CLI can be exited normally
   and reopened when the owner wants the newer process version.
5. When the separate local-terminal feature and model readiness are accepted,
   repeat the new-tab version check for both local Qwen presets. Their private
   history and signed inference grant must remain separate from the owner's
   cloud login. This change does not load a model or claim a new inference proof.

## Regression evidence

- The real shell executed with private tmux/CLI fixtures reproduces the old
  0.156.1 result after the managed link switches to 0.157.1. The corrected shell
  follows that link for Home and development while preserving resume, CWD,
  `HOME`, `CODEX_HOME` and a synthetic history marker.
- Existing-session fixtures attach without executing a new CLI. Missing managed
  binaries fail without falling back to the unmanaged older copy.
- Both local Qwen kinds use the managed binary and preserve per-tab history and
  environment-only capabilities. The original launcher fails both assertions.
- Private Linux checks: **3 Python owner-launcher tests, 19 native Node tests,
  13 existing fake-runtime installer tests**, all passing. Installer tests use
  artificial packages and cover install, exact-version upgrade, link switch,
  rollback, integrity rejection and retaining upgraded pins. No real package
  download, install, provider call or service restart was performed.
- Independent source review: R1 approved the bounded launcher changes. Actual
  browser-terminal acceptance remains a Root deployment check.
