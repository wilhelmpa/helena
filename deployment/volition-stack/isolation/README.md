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

Not reachable, whatever the agent runs: other projects' files and profiles, `/etc/volition`, the
runner's descriptors and keys, browser profiles, CDP and noVNC ports, code-server, the Hermes
dashboard, Mastra, Postgres, Redis, D-Bus, the LAN and the host itself. The unit has a network
namespace of its own (`PrivateNetwork=yes`): its loopback is not the host's.

## Pieces

| File | Runs as | Does |
|---|---|---|
| `launcher.py` | root, socket `/run/volition-agent-launcher/launch.sock` (0660 `root:volition-launcher`) | the only way to start an agent unit. Accepts `volition-hermes` alone (socket mode and `SO_PEERCRED`). A request names a project, a runtime of `launcher.json`, a profile of that project and a directory in its workspace; every unit property is fixed in the code. Also creates and removes project users (`ensure-project-user`, `remove-project-user`), runs the project terminal and writes a project's browser state as the browser user. |
| `sandbox.py` | the project user, first program of each unit | reads the caller's variables from stdin (never unit properties, which D-Bus shows to every local user), opens the loopback forwarders, links the shared Hermes config and the approval guard into the profile, then execs the runtime. |
| `egress.py` | `volition-egress`, socket `/run/volition-agents/egress.sock` (0660 `root:volition-agents`) | HTTP `CONNECT` and forward proxy. The project comes from the peer's Unix user, agent and run from its unit's cgroup. Resolves names itself, refuses a name with any non-public address, connects to the address it checked (no rebinding), ports 80/443, 465/587/993 with the mail role, the project's mode and lists from Plan. Reports host, port, decision and bytes per unit to Plan, never content. |
| `plan_proxy.py` | dynamic user, socket `/run/volition-agents/plan.sock` | one request per connection to `127.0.0.1:3000`, head rebuilt from a strict parse, an allowlist of headers (no cookie, no forwarding header), body reframed (`Content-Length` or `chunked`, never both), `X-Volition-Agent-Project` / `X-Volition-Agent-Unit` set. |
| `migrate.py` | root, from `native/isolation.sh` | walks every tree through directory descriptors, follows no link, leaves hard-linked files alone (reported): an agent that ran as the runner user could have planted either. |
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
- The global Hermes `config.yaml`, `auth.json`, `.env` and `.codex` get a read entry for
  `volition-agents` and are bound read-only (design §3, phase 1: an agent can read these model
  credentials; phase 2 moves them into the egress proxy).
- Home gets `profiles/home` (a copy of the Home agent's state in the global home, databases
  through SQLite's backup) and `/srv/volition/workspaces/home`.
- Browser state (`/var/lib/volition/project-browser`) belongs to `volition-browser`; Chromium,
  KasmVNC and the router run as that user through the drop-in `systemd/browser-user.conf`,
  which `isolation.sh` installs in the step that hands the state over (the units themselves keep
  `volition-hermes`, so a deploy alone never leaves them unable to read their state).

## Network modes (Helena: project settings → agent network)

`open` (internet, deny list applies), `allowlist` (only the listed domains, deny list still
applies), `blocked` (no internet). One agent can have a mode of its own. Private, loopback,
link-local, CGNAT, multicast, ULA, IPv4-mapped, NAT64, 6to4, Teredo and the host's own addresses
are refused in every mode. The model endpoints in `egress.json` stay reachable in every mode.

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
code and units; nothing is installed or switched on by a deploy.

## Proofs

`proof/harness.py` runs design §6 on Kingston in a test environment of its own (users `vpt-*`,
group `vpt-agents`, data below `/srv/vpt-test`, sockets below `/run/vpt-*`, units `vpt-*`), built
from these unit files and `launcher.json`; the live paths stay hidden in the test units as in
production. `proof/plan-api.sh` runs a Plan API of the checkout against a test database.

```sh
proof/plan-api.sh start && proof/plan-api.sh seed
sudo python3 proof/harness.py setup --source deployment/volition-stack/isolation
sudo python3 proof/harness.py start
sudo python3 proof/harness.py prove            # or --only 1,2,…
sudo python3 proof/harness.py teardown --users --all
```

Unit tests without root: `python3 -m unittest discover -s tests` (also run by the integration
suite, `integration/test/isolation-python.test.mjs`).
