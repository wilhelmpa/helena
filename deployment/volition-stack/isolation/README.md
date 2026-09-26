# Agent isolation

Design: `docs/volition-design-agent-isolation.md` (owner's repository). With `AGENT_ISOLATION=on`
every agent of a project runs as the project's own Unix user (`vp-<slug>`, Home as `vp-home`) in a
transient systemd unit that can reach only what its project gives it:

| Reachable | How |
|---|---|
| its workspace, its own profile, its vault folder (Home: its folder, every project's read-only) | bind mounts, everything else of `/srv/volition`, `/var/lib/volition` and `/run` is an empty read-only tmpfs |
| the Plan API with its own key | `127.0.0.1:3000` in the unit → `plan.sock` → Plan, which accepts only a key of an agent of that project |
| the internet | `127.0.0.1:3128` in the unit → `egress.sock` → public addresses only, per the project's network mode |
| its model | the model endpoints in `egress.json`, in every mode |
| the browser gateway | `/run/volition-agents/browser/gateway.sock` in the unit (where the MCP shim `helena-browser-mcp` looks) → that project's own directory `/run/volition-browser/gateway/<slug>/` (Home: `home/`; directory 0750 and socket 0660, group `volition-agents`), bound read-only with `-` (a project without a browser starts all the same, without one). The directory, not the socket, is bound, so a router restart that recreates the socket is seen at once. Per project, not shared: the router (one `net.Server` per project) knows the caller's project from the socket that accepted the connection, so no peer-cred lookup is needed (see `volition-design-browser-gateway.md` §3; proof test `B`) |

Not reachable, whatever the agent runs: other projects' files and profiles, `/etc/volition`, the
runner's descriptors and keys, browser profiles, CDP and noVNC ports, code-server, the Hermes
dashboard, Postgres, Redis, D-Bus, the LAN and the host itself. The unit has a network
namespace of its own (`PrivateNetwork=yes`): its loopback is not the host's.

## Pieces

| File | Runs as | Does |
|---|---|---|
| `launcher.py` | root, socket `/run/volition-agent-launcher/launch.sock` (0660 `root:volition-launcher`) | the only way to start an agent unit. Accepts `volition-hermes` alone (socket mode and `SO_PEERCRED`). A request names a project, a runtime of `launcher.json`, a profile of that project and a directory in its workspace; every unit property is fixed in the code. Also creates and removes project users (`ensure-project-user`, `remove-project-user`), runs the project terminal and writes a project's browser state as the browser user. |
| `sandbox.py` | the project user, first program of each unit | reads the caller's variables from stdin (never unit properties, which D-Bus shows to every local user), opens the loopback forwarders, links the shared Hermes config and the approval guard into the profile, then execs the runtime. |
| `egress.py` | `volition-egress`, socket `/run/volition-agents/egress.sock` (0660 `root:volition-agents`) | HTTP `CONNECT` and forward proxy. The project comes from the peer's Unix user, agent and run from its unit's cgroup. Resolves names itself, refuses a name with any non-public address, connects to the address it checked (no rebinding), ports 80/443, 465/587/993 with the mail role, the project's mode and lists from Plan. Reports host, port, decision and bytes per unit to Plan, never content. |
| `plan_proxy.py` | dynamic user, socket `/run/volition-agents/plan.sock` | one request per connection to `127.0.0.1:3000`, head rebuilt from a strict parse, an allowlist of headers (no cookie, no forwarding header), body reframed (`Content-Length` or `chunked`, never both), `X-Volition-Agent-Project` / `X-Volition-Agent-Unit` set. |
| `migrate.py` | root, from `native/isolation.sh` | walks every tree through directory descriptors, follows no link, leaves hard-linked files alone (reported): an agent that ran as the runner user could have planted either. |
| `runtime_modes.py` | root, from `native/isolation.sh`, the audit | checks that every agent can read the runtimes' shared code (`sharedCode`) and opens what is closed: by file descriptor, no link followed, a multi-linked file only when root owns it. |
| `launch_client.py` | caller | CLI of the protocol (provisioning from the shell, the terminal, the proofs). |
| `packages/runner/src/isolation.ts` | `volition-hermes` | the runner's client: runs, chat answers and the `profile-helper` (policy files, inventory, web-login vault) go through the launcher, so the runner never opens a file in an agent-writable profile. |

## Protocol

One JSON line (`{"v":1,"op":…}`), then frames: 1 byte kind, 4 bytes big-endian length, payload.
Caller → launcher: `0x01` stdin, `0x02` stdin end, `0x03` resize (`{"rows","cols"}`), `0x04` stop.
Launcher → caller: `0x10` accepted (`{"unit"}`), `0x11` stdout, `0x12` stderr, `0x13` exit
(`{"code"}`), `0x14` error (`{"error","message"}`), `0x15` result. Closing the connection stops
the unit: `KillSignal=SIGINT`, `SIGKILL` after `stopGraceSec`. A field the operation does not
have (a property, a user) is refused.

## Sandbox of every agent unit

`User=vp-<slug>`, `PrivateNetwork`, `PrivateTmp`, `PrivateDevices`, `PrivateIPC`,
`ProtectSystem=strict`, `ProtectHome`, `ProtectKernel*`, `ProtectControlGroups`, `ProtectClock`,
`ProtectHostname`, `ProtectProc=invisible`, `NoNewPrivileges`, empty `CapabilityBoundingSet`,
`RestrictSUIDSGID`, `RestrictNamespaces`, `RestrictRealtime`, `LockPersonality`,
`SystemCallFilter=@system-service`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`,
`TemporaryFileSystem=` over `/run`, `/dev/shm`, `/var/lib/volition`, `/srv/volition` (and the
launcher's and egress's state), `InaccessiblePaths=` for `/etc/volition`, `/var/lib/postgresql`,
`/var/lib/redis`, `/var/backups`, `/var/log`, `MemoryMax`, `CPUQuota`, `TasksMax`,
`RuntimeMaxSec` from `launcher.json` (the runner may shorten `RuntimeMaxSec`, never lengthen it).

## Files and users

- `vp-<slug>` (UID from `uidRange`, never given out twice: `/var/lib/volition-agent-launcher/uids.json`)
  owns its workspace and its profiles; its workspace has ACLs for the runner (`rwx`) and the
  readers group `volition` (`r-x`, the Files page), with defaults. Profiles are the project's
  alone. Vault folders keep their owner and group; the project user and `vp-home` get ACL entries.
- The global Hermes `config.yaml` and `.env` get a read entry for `volition-agents` and are
  bound read-only. The model logins are not: the token keeper (`../native/token-keeper`,
  `docs/helena-decisions/token-keeper.md`) renews them outside the sandbox and writes views
  without refresh tokens, which the launcher binds where Hermes and the Codex CLI look
  (`/var/lib/volition/hermes/auth.json`, `{home}/.codex`); a Hermes run without them is refused.
  An agent can still read the access tokens it uses (design §3, phase 1; phase 2 moves them
  into the egress proxy), never spend a refresh token.
- A bind target in the profile (`{home}/.codex`) is prepared by the launcher before every unit:
  created as the agent (0700) when missing — systemd would create it as `root:root 0755`, and it
  is also a Codex agent's own `CODEX_HOME`, which the agent then could not write (2026-09-25:
  `codex login --device-auth` → EACCES) —, and an empty root-owned one is given back to the agent
  (0700). A non-empty one or one owned by someone else is left as it is and logged; a link or a
  non-directory there stops the unit. The profile helper of a Claude Code or Codex agent (the
  runner sends `agentRuntime`) gets no login views at all: it works in the agent's own profile,
  and the Hermes views over `.codex` would hide the agent's own login and answer with the shared
  ChatGPT one (`cli-files`, the limits of a `runtime-request`). Nothing binds over `.claude`.
- The runtimes' code (`launcher.json` `sharedCode`: Hermes' venv, its Python, its `bin`, its uv
  tools) is bound read-only, and a bind keeps the files' modes: a file there only its owner may
  read fails every agent that imports it (2026-09-25: the anthropic SDK's `docstring_parser`,
  root 0600, stopped every agent on a Claude model at "credentials or agent init failed").
  `runtime_modes.py` checks the trees and opens what is closed (go+rX, go-w; by file
  descriptor, no link followed). Setuid/setgid files are skipped and reported; `isolation.sh` runs it on install, sync, apply and
  `open-code` (every deploy), the Hermes update helper after each install, the hourly audit
  reports it (`files.agent_code`). `docs/helena-decisions/agent-runtime-code.md`.
- Home gets `profiles/home` (a copy of the Home agent's state in the global home, databases
  through SQLite's backup, copied with the runner's privileges) and `/srv/volition/workspaces/home`.
- Browser state (`/var/lib/volition/project-browser`) belongs to `volition-browser`; Chromium and
  KasmVNC run as that user through the drop-in `systemd/browser-user.conf`, the router through
  `systemd/browser-router.conf` (also in `volition-agents`, so it can hand its gateway sockets
  to that group), both installed by `isolation.sh` in the step that hands the state over (the
  units themselves keep `volition-hermes`, so a deploy alone never leaves them unable to read
  their state). `rollback` removes both drop-ins.

## Network modes (Helena: project settings → agent network)

`open` (internet, deny list applies), `allowlist` (only the listed domains, deny list still
applies), `blocked` (no internet). One agent can have a mode of its own. Private, loopback,
link-local, CGNAT, multicast, ULA, IPv4-mapped, NAT64, 6to4, Teredo and the host's own addresses
are refused in every mode. Unknown projects and invalid modes are blocked. A connection whose
agent identity is unavailable receives the strictest configured project or agent mode. The model
endpoints in `egress.json` stay reachable in every mode. Port 443 tunnels require a bounded TLS
ClientHello with a server name matching the CONNECT hostname; missing, mismatched and encrypted
server names are refused before TLS bytes reach the destination.

## Why not `IPAddressDeny=`

`IPAddressDeny=`, `IPAddressAllow=`, `RestrictNetworkInterfaces=` and `SocketBindDeny=` need
cgroup BPF, which this nspawn container does not have. Measured on Kingston: a unit with
`IPAddressDeny=any`, `RestrictNetworkInterfaces=lo` and `SocketBindDeny=any` still binds and
fetches `http://example.com`. They are no longer used. What protects the loopback services now
is the agents' own network namespace; the browser units bind to `127.0.0.1` only.

## Operating it

```sh
sudo deployment/volition-stack/native/isolation.sh apply --dry-run   # every change, none made
sudo deployment/volition-stack/native/isolation.sh apply             # install, migrate, switch on
sudo deployment/volition-stack/native/isolation.sh status
sudo deployment/volition-stack/native/isolation.sh rollback          # one runner user again
```

`deploy.sh` runs `isolation.sh sync` when these files change: an installed isolation gets the new
code and units; nothing is installed or switched on by a deploy. On every deploy it runs
`isolation.sh open-code`, which only opens the agents' runtime code to them again (no restart);
`status` ends with what the agents cannot read of it.

## Proofs

`proof/harness.py` runs design §6 on Kingston in a test environment of its own (users `vpt-*`,
group `vpt-agents`, data below `/srv/vpt-test`, sockets below `/run/vpt-*`, units `vpt-*`), built
from these unit files and `launcher.json`; the live paths stay hidden in the test units as in
production. `proof/plan-api.sh` runs a Plan API of the checkout against a test database, as the
ordinary user. The proof launchers use a private network namespace and dedicated preview state
paths; their nftables updates cannot touch the live preview firewall.

Only the harness needs root. wilhelmpa's sudo asks for a password (since 2026-09-25), so root work
goes through the `helena-ops` account from the Mac. `proof/reprove.sh` splits a run at that point. The root part runs from an approved snapshot
at `/opt/helena-proof`, with every ancestor and file owned by root and not writable by group or
others. Stage the reviewed `isolation/`, `integration/`, `native/terminal/`, `native/systemd/`
and `packages/runner/dist/` trees at their repository-relative paths there
through the operator account before invoking root. Never execute a script from a user-writable
checkout as root. The harness validates its source tree and accesses owner files through `runuser`:

```sh
R=/home/wilhelmpa/agent-work/plan-isolation/deployment/volition-stack/isolation/proof
ssh wilhelmpa@kingston-server.local "$R/reprove.sh prepare"               # bundle, Postgres, API, seed
ssh helena-ops@kingston-server.local "sudo /opt/helena-proof/deployment/volition-stack/isolation/proof/reprove.sh root --only E"   # teardown, setup, start, prove
ssh wilhelmpa@kingston-server.local "$R/reprove.sh finish"                # API and Postgres stopped
```

The harness steps one by one, as root:

```sh
sudo python3 -I /opt/helena-proof/deployment/volition-stack/isolation/proof/harness.py setup --source /opt/helena-proof/deployment/volition-stack/isolation
sudo python3 -I /opt/helena-proof/deployment/volition-stack/isolation/proof/harness.py start
sudo python3 -I /opt/helena-proof/deployment/volition-stack/isolation/proof/harness.py prove            # or --only 1,2,…  (E: delivered variables and the clone job)
sudo python3 -I /opt/helena-proof/deployment/volition-stack/isolation/proof/harness.py teardown --users --all
```

The `launcher.json` the harness writes is the shipped one with the test paths put in;
`tests/test_isolation.py` (`ProofConfigTest`) checks it passes the launcher's own validation, so a
field added to the shipped file cannot break the test launcher unnoticed.

Unit tests without root: `python3 -m unittest discover -s tests` (also run by the integration
suite, `integration/test/isolation-python.test.mjs`).


Port 443 validates TLS ClientHello SNI against the CONNECT host. The sole protocol exception
is GitHub's documented `ssh.github.com:443` endpoint, which requires a bounded SSH-2.0
identification line. It retains project/agent policy, DNS and public-address checks; the
runner supplies pinned GitHub SSH host keys. See
[GitHub's SSH-over-443 documentation](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port).

The synthetic ALPHA proof project explicitly enables Autopilot level 3 before queuing its
workspace-write run. Missing agent identity still uses the strictest project/agent network
policy. Fixture repositories are initialized inside their project sandbox, keeping parent
workspace permissions intact. Installed Codex code and its platform package are resolved from
`/usr/local/bin/codex`, verified as root-owned and non-writable, then copied into the proof
runtime. CLI refusal checks kill the entire test launch-client process group and drain output
with a deadline; an upstream timeout remains a failed proof, never a successful auth refusal.
