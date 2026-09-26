# Persistent project previews

## Standards and boundary

Helena uses existing systemd transient services for lifecycle and sandboxing. Each preview is
independent of agent runs and the runner process. The existing framed launcher protocol is the
privileged extension point; the Helena API registers project-scoped tools and UI controls over it.
No package or system dependency is added.

- [systemd-run](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html) and
  [transient properties](https://github.com/systemd/systemd/blob/main/docs/TRANSIENT-SETTINGS.md)
  cover independent service ownership, process cleanup, resource limits and namespaces. systemd
  is actively maintained, native to the supported Debian deployment, and LGPL-2.1-or-later.
- [nftables socket cgroupv2](https://www.netfilter.org/projects/nftables/manpage.html) distinguishes
  project browser units which share a Unix UID. nftables is the deployment's existing firewall,
  maintained by Netfilter, GPL-2.0-compatible, and requires no library linkage into Helena.
- Python's standard library provides bounded byte forwarding and HTTP readiness probes. This
  layer joins existing project isolation with systemd; it is not a replacement HTTP framework.
- Existing Playwright/Patchright context routing and Helena's policy service allow only the
  runtime-owned `http://127.0.0.1:<assigned-port>` origins. Generic local-address access remains
  off; configured blocklists win. Redirect and subresource checks use the same project scope.
  Runtime origins refresh for an owner-created preview in an existing gateway session.

PM2 and a container per preview add process managers/dependencies while duplicating systemd.
`systemd-socket-proxyd` forwards bytes but does not provide readiness, bounded application logs,
project metadata and idle lifetime. Raw background commands remain tied to the agent unit and
cannot provide the requested lifetime. These alternatives are not used.

## Runtime

`preview-start`, `preview-status`, `preview-logs` and `preview-stop` extend the launcher's version-1
JSON-line request and framed JSON-result protocol. Only the existing runner caller, root and the
API service can reach it; the API identity is restricted to the four preview operations.

Start accepts `{slug, name?, cwd?, command?, idleTimeoutSec?}`. Names default to `main`.
Directories are workspace-relative and cannot traverse symlinks or escape the workspace. An
omitted directory finds one supported app within three levels, including the existing nested VOL
clone; multiple matches require a directory. Commands resolve to installed local Astro, Vite or
Next binaries, with constrained framework flags. `npm run dev` and `bun run dev` resolve the local
dev script. Shell commands, installation, arbitrary environment variables and caller-selected
host/port/unit properties are refused.

Each project has eight concurrent slots in ports 24000–31199, derived from the existing isolated
UID range 58000–58899. Stopped slots are reusable; old named entries remain stopped and cannot
inherit a replacement's status or logs. No development files are removed.

The service `helena-preview-<slug>--<name>.service` runs as the project user with the existing
agent sandbox, including `PrivateNetwork=yes`, filesystem boundaries and no capabilities.
Limits are 4 GiB RAM, 200% CPU and 512 tasks. A Python supervisor starts the local development
binary, waits for an HTTP 2xx/3xx response for up to 60 seconds and records bounded, redacted logs.
It stops after four idle hours by default (configurable 60 seconds–24 hours). HTTP/WebSocket
traffic refreshes activity. Stop and startup failure terminate the process group; systemd owns
the full control group. Project removal stops previews before releasing the workspace/user.

The application's loopback listener is exported through its own Unix socket. Agent units bind
only their project socket directory and forward its eight assigned ports inside their private
network. New previews are reachable in the same agent turn. A launcher proxy publishes only
`127.0.0.1` on the host; it preserves WebSocket upgrades and frames for HMR.
Before forwarding bytes, the host proxy checks the connected Unix peer's kernel-reported UID
against the project account. Replacing a project-owned socket path or symlinking it to another
service cannot make the privileged proxy forward to a different identity.

The separate nftables table `inet helena_previews` rejects LAN traffic to the entire range and
allows loopback traffic from root/nginx or the matching project's Chromium cgroup. It grants no
shared-browser-UID exception. A five-second reconciliation checks cgroup inode changes, refreshes
rules after browser recreation and restores host listeners after a launcher restart. Failure to
configure the firewall closes host listeners. Dev services retain their private namespaces.

State is root-owned under `/var/lib/helena-previews`; project-owned runtime sockets and bounded
status/log snapshots are under `/run/helena-previews/<slug>/<port>`. Supervisor heartbeats prevent
dead services from appearing running. Logs are capped at 200 lines, 1000 characters per line and
220 kB serialized, with common credential forms redacted. No agent login/environment secrets are
passed to a preview unit. Metadata persists across launcher restarts; automatic boot restart is
not enabled. After a machine reboot previews are stopped until started in Helena.

## Deployment and live proof

The orchestrator merges API/UI, gateway and runtime branches into one tested candidate.
`native/isolation.sh sync` installs the three Python modules, grants `volition-plan` launcher
socket group access, refreshes the launcher's AF_INET permission and restarts its service.
Deploy restarts the API to pick up the group. No migration, package installation or extra timer
is needed. The existing in-flight gate must precede deployment because agent forwarders are
materialized when a new agent unit starts.

Live acceptance requires:

1. Start VOL's installed Astro app through Helena. Verify an HTTP-ready result, panel state,
   rendering in its project browser and HMR after an authorized reversible file edit.
2. End the starting agent turn and restart the runner in an idle window; the service remains
   running and the next agent/browser can fetch and screenshot it.
3. Inspect the exact Chromium cgroup ACL. VOL may connect; VERVE's browser/agent and a LAN
   client cannot. Recreate a browser unit and confirm the ACL refreshes without a broad rule.
4. Exercise another project's installed app, UI/tool stop, short idle expiry and log failures.
5. Re-run the existing hardening audit. Keep the generic local-address setting disabled.

Focused tests cover command/directory refusal, exact cgroup/port rules, cgroup recreation,
readiness, actual child lifetime and idle cleanup, failed startup, bounded/redacted logs and
byte-preserving WebSocket forwarding. Privileged unit/nft proofs belong to the orchestrator's
live acceptance and are not replaced by these unprivileged tests.
