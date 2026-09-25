# The agents' runtime code is readable for every agent

Status: decided 2026-09-26 (hub/anthropic-hermes). Trigger: from 2026-09-25 23:47 (the owner's
new Claude login) every Hermes agent on a Claude model failed at start with Hermes' bare
`credentials or agent init failed`, chats and runs alike, while the ChatGPT (openai-codex)
models ran in the same isolated setup.

## 1. What happened

Not the login. The token keeper's view (`/var/lib/helena-token-keeper/view/hermes/auth.json`)
held two valid `anthropic` OAuth rows in the form Hermes reads (checked by structure only: key
names, labels, expiries, no values), the model `claude-sonnet-5` is in the account's model list,
and no egress event was ever logged for the failing agent: it never reached the network.

A replica of the isolated unit (the launcher's exact sandbox properties, a proof user, the live
Hermes code bound read-only at its live paths, fake tokens in the view's structure) failed the
same way and showed the reason Helena never saw:

    Hermes couldn't start the model connection: [Errno 13] Permission denied:
    '/srv/volition/source/hermes/.venv/lib/python3.13/site-packages/docstring_parser/__init__…

- Hermes' venv (`/var/lib/volition/hermes/venv`, `<source>/.venv` links to it) held all 14 files
  of `docstring_parser` 0.18.0 as `root:root 0600`, plus about 1,070 bytecode caches
  (`__pycache__`, 0700/0600). Installed by uv (`INSTALLER`) on 2026-09-23; uv links files from
  its cache and keeps the cache's modes, so an entry unpacked under umask 077 (the runner's
  `UMask=0077`, or Hermes' own lazy installer `pm.ensure_import` running as the runner) comes out
  owner-only. The venv was later given to root (2026-09-25 00:09), the modes stayed.
- An isolated agent runs as its project user (`vp-<slug>`); the unit binds the venv read-only,
  and a bind keeps the files' modes. The `anthropic` SDK imports `docstring_parser`
  (`anthropic/lib/tools/_beta_functions.py`); Hermes builds the Anthropic client in
  `agent/agent_init.py:767` (`build_anthropic_client` → `_require_sdk`,
  `agent/anthropic_adapter.py:461`), the import raised `PermissionError`, and `_init_agent`
  (`hermes_cli/cli_agent_setup_mixin.py:739`) printed the reason through its console, on
  **stdout**, before `cli_single_query.py:494` wrote the bare result line. The OpenAI SDK imports
  nothing unreadable (its unreadable bytecode caches only make Python compile the source), so
  the ChatGPT models ran.
- The runner's stream-json reader dropped every non-JSON stdout line
  (`packages/runner/src/execute.ts`, `HermesResultReader.end`), so Helena showed only
  "credentials or agent init failed", and the dead Claude login of 2026-09-24 hid the rest.

## 2. Decision

| Block | Decision | Rejected |
|---|---|---|
| What must be readable | `launcher.json` names the runtimes' shared code: `sharedCode` = Hermes' venv, its Python, its `bin`, its uv tools. Code only, never a secret, the same for every project (`isolation_common._shared_code` refuses `/`, top-level system directories and anything below `/etc`, `/boot`, `/proc`, `/sys`, `/dev`) | deriving it from every runtime's `readOnly` paths (they include the Hermes checkout, owned and managed by its user, and `config.yaml`/`.env`, which are read through an ACL, not by everyone) |
| Check and repair | `isolation/runtime_modes.py check|repair`: walks by file descriptor, follows no link, opens only unreadable entries (go+rX, go-w, chmod's semantics), a multi-linked file only when root owns it, nothing of another owner. `check` fails only on source files; unreadable bytecode caches are harmless (measured: the same import time, ~2 s) | a POSIX default ACL for `volition-agents` on the trees (uv links files from its cache, and an existing inode keeps its mode, so the ACL never reaches them); running every writer with umask 022 (the runner's `UMask=0077` protects its own secrets, and a cache written earlier keeps its modes); an idmapped or `uid=`-mapped bind (no such option for a bind; an overlay per unit is far more machinery than a chmod) |
| When it runs | `isolation.sh install|sync|apply` and the new `isolation.sh open-code`, which `deploy.sh` runs on **every** deploy (no restart, nothing installed); `helena-hermes-update` opens the venv after each install and each rollback (before its smoke test) | only when the isolation code changes (deploy.sh's `sync` condition): a Hermes update through the update center installs into the venv without a deploy |
| Seeing it | the hourly audit's new check `files.agent_code` (group files, high): `fail` with the count and the tree when a source file is closed to the agents; Administrator → Sicherheit → Server-Härtung and, as a failed high check, "Braucht dich" | only `isolation.sh status` (nobody runs it unprompted) |
| Saying why a start failed | the runner keeps what Hermes printed on stdout outside the protocol (its last 1,200 characters) and puts it into the error of a failed run: `credentials or agent init failed` + Hermes' own sentence, within the 500-character error | a Hermes patch that prints the reason on stderr or into the result line (a local patch carried through every update; Helena treats Hermes as an external dependency) |

## 3. Proof

- Replica, fresh copy of the live venv: before the repair the exact live failure; after
  `runtime_modes.py repair` (1,085 entries opened) the turn starts on
  `anthropic/claude-sonnet-5` (the replica has no network, so it stops at the connection).
- `runtime_modes.py check` against the live trees (read-only, as root, 0.5 s): venv 1,085 of
  13,470 unreadable, 14 of them source files (`docstring_parser`); Python 21 bytecode caches;
  `bin` and the uv tools readable. The audit from the branch: `fail high files.agent_code 14
  file(s) in /var/lib/volition/hermes/venv only their owner reads`.
- Inside the unit Claude Code's version is detected (2.1.282, `/usr/local/bin/claude`), so the
  OAuth user agent is current, and `claude-sonnet-5` is in the account's model list.

## 4. Live steps (orchestrator)

1. Now, without a deploy (no restart; the next run reads the new modes):
   `ssh helena-ops@kingston-server.local 'sudo chmod -R go+rX,go-w /var/lib/volition/hermes/venv'`
   (the venv is root's alone, so a plain recursive chmod is safe there; GNU chmod does not
   follow links while recursing). Then a Claude chat on agent 35.
2. Merge + deploy as usual. `deploy.sh` runs `isolation.sh sync` (isolation files changed:
   installs `runtime_modes.py` and the new `launcher.json`, repairs, try-restarts the launcher,
   egress and Plan socket units: check in-flight work first) and `open-code`. Install the
   update helper again: `sudo deployment/volition-stack/native/hermes-update/install.sh`
   (deploy.sh does not). The next audit run (hourly, or `sudo systemctl start
   helena-security-audit.service`) shows `files.agent_code` passed.
3. `sudo deployment/volition-stack/native/isolation.sh status` ends with `runtime code: …
   readable` for each tree.

## 5. Open

- Hermes' lazy installer (`pm.ensure_import`) can still write into the runner-owned trees
  (Python, `bin`, uv tools) with the runner's umask; the next deploy opens them again and the
  audit names them in between. The venv is root's and no longer writable by the runner.
- Upstream idea for Hermes: print an agent-init failure on stderr in quiet/stream-json mode (as
  `_ensure_runtime_credentials` already does), or carry it in the result line's `error`.
