# Credentials as environment variables for agents (hub/agent-env)

Decision, 2026-09-25. Owner: "beide Projekte brauchen Wrangler, Verve auch D1-Zugriff". Agents must be
able to run CLIs that sign in through environment variables, first of all Cloudflare **wrangler**
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). The token lives only in Helena's credential store
(Zugänge) and is handed out per grant. It is never in a repository, a prompt, a profile file or a
transcript.

The same branch fixes "Repo in Bereichsordner klonen" under agent isolation (§8).

## 1. What the standard is

Environment variables are how CLIs take a credential in automation. Wrangler documents
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for CI. `gh`, `vercel`, `flyctl`, `aws`, `npm`
and `docker` work the same way. The established tools that hand such values to processes agree on
three rules:

| Tool | How the value gets in | What it does against leaks |
|---|---|---|
| **GitHub Actions** secrets and variables | Per job, into the step's environment | Secrets are masked in the log. **Variables** are a second, plain kind for values that are not secret. |
| **1Password `op run`**, **Doppler `doppler run`**, **Infisical `infisical run`** | Into the child process's environment for one command | `op run` masks the values in the child's stdout/stderr. |
| **Cloudflare Workers** `vars` and `secrets` | Into the Worker's environment | Two kinds again: plain vars and write-only secrets. |
| **systemd credentials** (`LoadCredential=`) | Files in `$CREDENTIALS_DIRECTORY` | Private to the unit. A CLI still needs a wrapper that turns the file into a variable. |

What Helena takes from them:

- The value goes into **one command's environment**, for one run or chat answer.
- Every place that shows the command's output **masks the exact value**.
- There are **two kinds**: write-only secrets, and plain variables such as an account ID. A plain
  value is not masked, because hiding every account ID would make the output unreadable.

## 2. Options for Helena

| Option | Verdict |
|---|---|
| **Process environment, delivered per claimed work** (like `op run`) | **Chosen.** The runner already hands SSH keys and MCP secrets out per claim. The isolation launcher already passes variables on the unit's stdin header rather than as `--setenv` (launcher.py `stream`), so no other local user can read them from D-Bus. |
| `.env` / `.dev.vars` file in the workspace | Rejected. It would sit on disk in a git working tree. |
| `wrangler login` (OAuth, refresh token in `~/.config/.wrangler`) | Rejected. It needs an interactive browser, and the token would sit on disk in the profile. |
| Cloudflare's MCP servers | Rejected for this job. Deploying still needs the full wrangler CLI. An MCP server can already take a secret from Zugänge (`mcpSecretServers`). |
| A secret-manager service (Vault, Infisical, Doppler) | Rejected. It adds another service; Hermes + Postgres stay the only runtime dependencies (OSS plan §3b). |
| systemd credentials in the agent unit | Rejected. `SetCredential=` on a transient unit shows the value in the unit definition. The CLI would still need a wrapper to turn the file into a variable. |

## 3. Data model

- **`api_key` and `secret`** get an optional readable field `envName`, stored in
  `integration_credential.redacted`. The value stays encrypted and write-only.
- **New kind `variable`**: a value that is not secret (`CLOUDFLARE_ACCOUNT_ID`,
  `WRANGLER_SEND_METRICS=false`). Its value is stored readable and returned by the API. Its
  `envName` is required. It has no secret fields and is never masked.
- **Name rules** (`apps/api/src/modules/agents/credentials/env.ts`):
  - The name must match `^[A-Z_][A-Z0-9_]{0,63}$`.
  - **Refused exactly:** `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `PWD`, `OLDPWD`, `TMPDIR`,
    `TMP`, `TEMP`, `TERM`, `LANG`, `LANGUAGE`, `TZ`, `IFS`, `ENV`, `CDPATH`, `GLOBIGNORE`, `PS1`–`PS4`,
    `PROMPT_COMMAND`, `MAIL*`, `HOSTNAME`, `HOSTALIASES`, `SHLVL`, `EDITOR`, `VISUAL`, `PAGER`,
    `BROWSER`, the proxy variables, `SSL_CERT_*`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`,
    `CREDENTIALS_DIRECTORY`, `NOTIFY_SOCKET`, `INVOCATION_ID`, `JOURNAL_STREAM`, `DBUS_*`, `DISPLAY`,
    `XAUTHORITY`, `WAYLAND_DISPLAY`, `AGENT_ISOLATION`, `BU_CDP_URL`, `GNUPGHOME`, `LOCPATH`,
    `NLSPATH`, `RES_OPTIONS`, `LOCALDOMAIN`, the Java/Ruby/Perl option variables.
  - **Refused prefixes:**

    | Group | Prefixes |
    |---|---|
    | Loader and interpreters | `LD_`, `DYLD_`, `PYTHON`, `NODE_`, `BUN_`, `DENO_`, `BASH_`, `GCONV_`, `MALLOC_`, `GLIBC_`, `OPENSSL_`, `KRB5` |
    | Package managers | `NPM_CONFIG_`, `UV_`, `PIP_` |
    | git and ssh (`GIT_SSH_COMMAND` carries the SSH keys) | `GIT_`, `SSH_` |
    | Locale and session | `LC_`, `XDG_`, `SYSTEMD_`, `LISTEN_` |
    | Helena, the runner and the sandbox | `ITSAPLAN_`, `HELENA_`, `VOLITION_`, `HERMES_`, `TERMINAL_`, `BROWSER_` |
    | The runtimes' own logins and settings | `CLAUDE_`, `CODEX_`, `ANTHROPIC_`, `OPENAI_` |
  - The runner applies a shorter mirror of this list (`packages/runner/src/agent-env.ts`), so an
    older or wrong server cannot set a name the runner or the launcher sets itself.
- **One name per scope.** One team-wide credential, and one per project, may use a name. The
  partial unique index `integration_credential_env_name_uq` on
  `(team_id, coalesce(project_id,0), redacted->>'envName')` enforces it, in **migration 0186**. The
  API answers 409 with the credential that already has the name.
- **Grants:** the one grant system (`grants.ts`), exactly as for SSH keys: a grant to a project
  (every agent working there) or to one agent.

## 4. Delivery

- **Runner routes:** `GET /agent-runs/:runId/env` and `GET /agent-chats/:messageId/env`.
  - They answer only for work the calling agent's runner holds under a live lease (`claimedWork`),
    with `Cache-Control: private, no-store`.
  - The answer is `{ variables: [{ id, label, name, value, secret, updatedAt }] }`.
  - Each delivered credential is written to `integration_credential_use` as `delivered`, with purpose
    `env NAME`.
- **Which project the work is in:** a run's own project; for a chat answer, the chat thread's
  project. A chat on Start has no project.
- **One credential per name**, the most specific one:
  1. the credential of the work's project;
  2. a credential granted to the agent by name;
  3. a team-wide credential.

  Two that fit equally well are both left out and logged as `denied` ("another credential sets the
  same variable for this work"). Example: the Home agent in a Start chat, with VOL's and VERVE's
  token both granted through their projects, gets neither token. Which account a command runs
  against must never be a guess.
- **Runner (`packages/runner/src/cli.ts` `envDelivery`, `agent-env.ts`):**
  - Before each run and chat answer, next to the SSH keys, the runner merges the variables into
    `RunSettings.env`. The runner's and the adapter's own variables win.
  - It records the names and the secret values in `RunSettings.delivered` (a new @helena/sdk field).
  - Digest runs and workspace jobs get no variables.
  - A delivery that fails is logged and the work runs without the variables, as for SSH keys.
- **Unisolated:** the variables go into the spawned command's environment (`childEnv`).
- **Isolated:** they go into the launch request's `env`. The launcher writes them on the unit's
  stdin header, never as `--setenv`. The sandbox execs the runtime with them.
  - Nothing is written to a file.
  - `/proc/<pid>/environ` of the unit is readable only by the project's own user.
  - The unit has `ProtectProc=invisible`.

### How each runtime passes them to its tools

| Runtime | Mechanism | What Helena does |
|---|---|---|
| **Hermes** | The terminal tool inherits the Hermes process environment. It filters only Hermes' own provider/tool credential names (`tools/environments/local_env_policy.py`). `CLOUDFLARE_*` passes. Its session keeps a **shell snapshot** (`export -p`) in `get_temp_dir()`: `TERMINAL_TEMP_DIR`, else `$TMPDIR`, else **`$HERMES_HOME/cache/terminal`**, which is the profile and would persist. | New `CliCommand.scratchDirEnv` (SDK). The Hermes preset names `TERMINAL_TEMP_DIR`. Isolated: `/tmp`, the unit's PrivateTmp, removed with the unit. Unisolated: a fresh 0700 `mkdtemp` under the runner's tmp, removed when the command ends. |
| **Claude Code** | The Bash tool inherits the process environment. Its shell snapshot (`~/.claude/shell-snapshots`) holds functions, shell options, aliases and `export PATH` only (checked in the 2.1.282 binary), no other variables. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is off. | Nothing extra. |
| **Codex** | `shell_environment_policy` drops every variable whose name contains KEY, SECRET or TOKEN from its shell commands by default (`ignore_default_excludes`). `CLOUDFLARE_API_TOKEN` would be dropped. | New `RuntimeTaskSettings.toolEnv` (SDK), with the delivered names and the names present. The Codex preset adds `-c shell_environment_policy.ignore_default_excludes=true` and `-c shell_environment_policy.exclude=[…]`, which lists every other KEY/SECRET/TOKEN name in the command's environment (Helena's own key, MCP secrets). Names only; a value never reaches a command line. |

**Known limit:** Hermes' terminal always strips the names on its own blocklist, and
`env_passthrough` cannot re-allow them (GHSA-rhgp-j443-p4rf). Examples are `GH_TOKEN`,
`GITHUB_TOKEN`, `VERCEL_TOKEN` and `HASS_TOKEN`. A credential with such a name reaches Claude Code
and Codex agents, but not a Hermes agent's shell. Use another name, or a Claude/Codex agent for
that CLI.

**The agent learns the names** through `list_connections` (MCP), which now lists
`environment: [{ name, label, secret }]`. The tool description says to use `$NAME` and never to
print a secret one.

## 5. Masking (redaction)

- **One implementation:** `SecretMask` / `SecretStream` in `@helena/sdk`
  (`packages/sdk/src/secret-mask.ts`).
  - Exact values of 8 characters or more are replaced by `[redacted]`.
  - A value that contains another is masked whole.
  - The stream variant holds back any ending that could still become a secret, so a token split
    across two deltas is masked too.
- **Runner:**
  - `AnswerStream` takes the mask of the work: the runner's key, the MCP secrets and the
    delivered secret values.
  - Text and reasoning deltas go through the holdback. It is released at every tool call and at
    the end, so the order of the events is kept.
  - Tool arguments, tool results and `RUN_ERROR` are masked whole.
  - A run's reported output and error are masked. The chat's error is masked.
  - The run timeline also keeps the existing secretlint pass.
- **API (defense in depth, and for later reads):** `teamSecretMask(teamId)` holds the values of
  every API key, secret, runtime login and web-login password of the team. It is cached for
  30 seconds and dropped at once when a credential is created, changed or deleted. It is applied
  before anything a runner reports is stored:
  - run result and reflection (`/agent-runs/:id/result`, `/reflection`);
  - run timeline events;
  - chat events and chat result;
  - runtime request answers (transcripts, logs, sessions);
  - `/agent-runtime/status` (memory proposals and learned skills are text the agent wrote).

  So a transcript read a week later from a Hermes `state.db` is masked too, although the runner
  has long forgotten the value.
- **Not covered:** the model provider sees what the agent's commands print, as with any
  environment-variable credential. The value also stays in the runtime's own session store in the
  profile (Hermes `state.db`, Claude and Codex JSONL) if the agent printed it. That store is private
  to the project user, and Helena masks it whenever it reads it.

## 6. Interface

- **Zugänge → API key / Secret:** a switch "Als Umgebungsvariable an Agenten geben" and the
  variable name. Typing becomes capitals and underscores (`CredentialEnvFields.tsx`).
- **New kind "Variable":** name and value, the value shown in the list as `NAME=value`.
- **The credential row** shows `$NAME` and whom it is granted to (project keys, agent names)
  next to the grant count.
- **Agent editor:** section "Umgebungsvariablen" (`AgentEnvironmentSection`), names only, with
  where each comes from.
- **Project settings:** section "Umgebungsvariablen" (`/project/KEY/settings/environment`), the
  same list for the project's agents.
- **List endpoint:** `GET /teams/:teamId/agent-environment?agentId=|projectId=`. It needs the
  team's `integrations.read` and returns names only.
- **Locales:** all 10, German first.

## 7. Tooling for wrangler

- **node, npm, npx:** `/usr/local/bin/{node,npm,npx}` point to `/opt/volition/runtime/node`
  (v24.21.0). The tree is world-readable and executable, and the units' `PATH` has
  `/usr/local/bin`.
- **npm cache:** `$HOME/.npm`. In every isolated unit `$HOME` is the agent's profile, which is
  writable and private to the project user. npx keeps wrangler there between runs, so each run does
  not download it again.
- **Proxy:** the sandbox sets `HTTPS_PROXY`, `npm_config_proxy`, `npm_config_https_proxy` and
  `NODE_USE_ENV_PROXY=1`. npm, Node's fetch and wrangler (undici) all go through the egress proxy.
- **Egress:** a project in mode **open** (the default) reaches every public host on 80/443, and
  nothing needs to change. For a project in **allowlist** mode (Projekt → Einstellungen →
  Agenten-Netzwerk), add:

  | Host | Why |
  |---|---|
  | `registry.npmjs.org` | npx downloads wrangler and its esbuild/workerd packages |
  | `api.cloudflare.com` | every wrangler API call (whoami, d1, pages, deploy) |
  | `sparrow.cloudflare.com` | wrangler's metrics; better turned off with the plain variable `WRANGLER_SEND_METRICS=false` |
  | `workers.dev`, `pages.dev`, `volition.one` (covers `v1-cart-suite.volition.one`) | only to check a deployment with curl |
  | `ssh.github.com` (port 443) | git over SSH to GitHub (§8) |

  The repository's `egress.json` holds only the model hosts, which bypass every project list.
  Cloudflare does not belong there, so no repository file changes.
- **Recommended plain variables:**
  - `CLOUDFLARE_ACCOUNT_ID=42a48d019d819276f79d3cf42750689b`, granted to VOL and VERVE;
  - `WRANGLER_SEND_METRICS=false`.

## 8. Clone into an area folder under isolation (runs 90/91, 2026-09-25)

**What went wrong:**
1. `startClone` took the lowest agent id among the project's members, which is the Home agent.
2. The runner resolved the folder against its own cwd (`/srv/volition/workspaces/home`).
3. The runner spawned `git` itself as `volition-hermes`, which cannot read the project user's key
   (EACCES).
4. Even as the right user, an isolated unit has no port 22: the egress proxy opens 80 and 443
   only.

**Fix:**
- **Choosing the agent (`clone.ts`):** the project's coordinator first, then an agent that works
  in that project alone, then one of several projects, the Home agent last. The owner can still
  name the agent.
- **The job names its project:** `{ op, url, folder, name, credentialId, slug, workspace }`, where
  `workspace` is the project's code root (`projectRoot(key,'code')`). The runner resolves the
  folder against it (`jobWorkspace`):
  - an isolated runner whose slug is not the job's refuses ("This agent works in home; the clone
    belongs to vol");
  - an unisolated one accepts only if its cwd is inside that workspace, or holds it.
- **Isolated:** the clone runs through the profile helper (`op: 'workspace-job'`, up to 30 min)
  in the project's unit, as the project user:
  - the files belong to `vp-<slug>` and get the workspace's group and ACL through the unit's
    `UMask=0007`;
  - the network is the project's egress.
- **SSH (`ssh.ts`):** with the keys, the runner writes into the key directory:
  - `known_hosts.pinned`: GitHub's three published host keys. The fingerprints were checked
    against api.github.com/meta and ssh-keyscan of github.com:22 and ssh.github.com:443.
  - `ssh_config`: `github.com` → `ssh.github.com:443` with `HostKeyAlias github.com`, and a
    `ProxyCommand` for every host.
  - `proxy-connect.py`: standard library only. It sends `CONNECT` to the environment's
    `https_proxy`, or connects directly where there is none.

  **Agents' `GIT_SSH_COMMAND`:**
  - pinned keys as `GlobalKnownHostsFile`;
  - `accept-new` only for hosts that are not pinned.

  **A clone (`cloneSshEnv`):**
  - `StrictHostKeyChecking=yes`, so an unpinned host is refused, never learnt;
  - a `known_hosts` in a private temporary directory, removed afterwards;
  - only the job's own key, because GitHub takes the first key it knows and refuses another
    repository's deploy key for this one.
- A failed clone removes the half-made target.
- **Left over from runs 90/91 (orchestrator):** the empty directory
  `/srv/volition/workspaces/home/homepage`, owned by the runner or `vp-home`.

## 9. Tests

- **@helena/sdk:** `secret-mask.test.ts`, 5 tests.
- **Runner:** 345 pass, 0 fail. New tests:
  - `agent-env.test.ts`: delivery filter, precedence, Codex arguments, the variable in a real
    child's environment and not in its arguments, the Hermes scratch dir created 0700 and removed,
    the isolated launch header carrying the variable and `TERMINAL_TEMP_DIR=/tmp`, and the stream
    masking a token split across flushes, tool results and errors;
  - `ssh.test.ts`: pinned fingerprints, the `ssh -G` view of the config, the proxy command through
    a CONNECT proxy and directly, strict clone ssh with the job's own key, where a clone lands,
    and the half-made target removed.
- **API:** `credentials/…/env.test.ts`, 8 tests:
  - names and the deny list;
  - resolution, including the ambiguous case;
  - storing, the 409 on a duplicate name, moving a credential into a scope where the name is taken;
  - delivery of a claimed run, and 404/403 for anyone else;
  - the audit log;
  - project vs team vs agent precedence in runs and chats;
  - the listing and `list_connections`;
  - masking of run output/error, timeline, chat content/events/error and transcripts, including a
    rotated value at once.

  `connectors.test.ts` gained a test for the clone's agent choice and job. Suites credentials,
  connectors, run-timeline, chat, runtime-requests and runner: 175 pass, 0 fail.
- **Web:** form tests for the switch, the name, the variable kind and reading back. The web suites
  of teams/utils: 199 pass. `tsc -p apps/web` is clean; eslint and prettier are clean on every
  changed file.
- **Isolation harness:** new proof group **E** (`proof/proof_agent_env.py`, `harness.py prove
  --only E`). It needs root, so the orchestrator runs it. It checks:
  - the variable reaches the command;
  - it is not in `systemctl show` of the unit, as seen by an unrelated user;
  - it is not on any command line;
  - `/proc/<pid>/environ` is unreadable for `vpt-beta` and `vpt-other`;
  - the clone job runs as `vpt-alpha` through `file://`, and the files belong to `vpt-alpha`;
  - a job naming beta's workspace fails from alpha's unit;
  - ssh keys and pinned host keys are written as the project user;
  - `ssh … -T git@github.com` through the test egress answers "Permission denied (publickey)", not
    a host key failure.

## Proof (live, run by the orchestrator)

Order: in-flight check first (`agent_run` pending = 0 and `agent_chat_message` streaming = 0), then
merge and deploy back to back.

1. **Trial merge and full test.** Merge `hub/agent-env` onto `hub/merge-check`, then run
   `~/agent-work/full-test.sh hub/merge-check`. The migration is **0186_helena_agent_env** (one
   partial unique index). Renumber it if the hub took 0186 meanwhile.
2. **Isolation proof.** In `~/agent-work/plan-isolation-reprove-live.sh`, fetch the trial branch
   instead of live, build the runner bundle as that script does, then run `prove --only E` (and
   the full `prove` if time allows).
3. **Merge live and deploy.** Run `git merge --ff-only`, then `deploy.sh`. It runs the migration,
   builds web/API and must rebuild `packages/runner/dist/cli.js`. The profile helper runs that same
   file from the live checkout (launcher.json `fixedArgs`).
   - Check the bundle: `grep -c 'agent-runs/.*/env' packages/runner/dist/cli.js` must be ≥ 1, and
     `grep -c 'workspace-job' …` ≥ 1.
   - Restart `volition-hermes-runner` (after the in-flight check).
   - **Unchanged, nothing to install:** launcher, egress, sandbox, launcher.json and the catalog
     script.
4. **Check each project's network mode.** Open Projekt → Einstellungen → Agenten-Netzwerk for VOL
   and VERVE. In mode "open" nothing is needed. In allowlist mode add the hosts from §7.
5. **Owner, in Zugänge.** Nobody else ever sees the tokens.
   - API key **"Cloudflare VERVE"**: limited to VERVE, "Als Umgebungsvariable an Agenten geben" →
     `CLOUDFLARE_API_TOKEN`, granted to project VERVE.
   - API key **"Cloudflare VOL"**: limited to VOL, `CLOUDFLARE_API_TOKEN`, granted to project VOL.
   - Variable **"Cloudflare-Konto"**: `CLOUDFLARE_ACCOUNT_ID` = `42a48d019d819276f79d3cf42750689b`,
     whole team, granted to projects VOL and VERVE.
   - Recommended, a variable `WRANGLER_SEND_METRICS` = `false`, granted to VOL and VERVE.
   - Check: Projekt VERVE → Einstellungen → Umgebungsvariablen lists `CLOUDFLARE_ACCOUNT_ID` and
     `CLOUDFLARE_API_TOKEN (geheim)`. So does the agent editor of the VERVE coordinator.
6. **VERVE run.** Create a task for the VERVE coordinator (or Coder VERVE): "Führe im Projektordner
   `printenv CLOUDFLARE_API_TOKEN | wc -c`, `npx --yes wrangler whoami` und
   `npx --yes wrangler d1 list` aus und berichte die Ausgabe. Gib den Token nie aus."
   - **Expected:**
     - the length is > 1;
     - `whoami` names the account 42a48d01…;
     - `d1 list` lists `v1_cartsuite`.
   - The audit log of "Cloudflare VERVE" shows `delivered · env CLOUDFLARE_API_TOKEN` for the run.
7. **VOL run.** The same with `npx --yes wrangler pages project list`. Expected: the project
   `volition`.
8. **Nothing left behind.**
   - `ksql.sh`: `select count(*) from agent_run where output ~ 'CLOUDFLARE_API_TOKEN=[^\[]'` must be
     0. Do the same for `agent_run_event.payload::text` and `agent_chat_event.payload::text`.
   - `sudo grep -rls 'CLOUDFLARE_API_TOKEN=' /var/lib/volition/hermes/profiles/vol*/cache
     /var/lib/volition/hermes/profiles/verve*/cache` must list nothing (no Hermes shell snapshot in
     the profile).
   - `sudo grep -c CLOUDFLARE /proc/<runner pid>/cmdline` must be 0.
   - Open the session in Helena (agent → Sitzungen). The transcript shows `[redacted]` wherever
     the agent printed the token, if it did.
9. **Clone, after deploy.**
   - `POST /teams/1/credentials/1/clone` with `{projectId: 5, areaId: 1, url:
     "git@github.com:wilhelmpa/homepage.git"}`.
   - `POST /teams/1/credentials/42/clone` with `{projectId: 6, areaId: 2, url:
     "git@github.com:wilhelmpa/v1-cart-suite.git"}`.
   - **Expected:**
     - each run goes to the project's coordinator;
     - the target is `/srv/volition/workspaces/projects/vol/homepage/homepage` and
       `…/projects/verve/dev/v1-cart-suite`;
     - `stat -c %U` gives `vp-vol` / `vp-verve`;
     - the workspace's `.git/info/exclude` holds the new path;
     - `git -C <target> log -1` works as the project user.
   - Before that, remove the leftover `/srv/volition/workspaces/home/homepage`.

## Not verified here

- The live runs of §Proof 2 and 6–9. They need root, the owner's tokens and a deploy.
- Codex 0.156 accepting the legacy `exclude` key together with `ignore_default_excludes` from
  `-c`. The binary lists both fields; its error text only forbids mixing them with the newer
  `filters`.
- The test harness egress lets `ssh.github.com:443` through, as proof E assumes.
