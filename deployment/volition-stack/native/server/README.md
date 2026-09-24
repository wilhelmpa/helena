# helena-hostd: Helena's host helper

Administrator → Server shows and changes the machine Helena runs on: disks and RAID, backups,
power and fans. The web never gets root and the API never runs a privileged command itself.
It asks `helena-hostd`, a small root service with a fixed list of operations.
Decision and alternatives: `docs/helena-decisions/server-admin.md`.

## Pieces

| Path (installed) | What |
|---|---|
| `/usr/local/lib/helena/hostd/helena-hostd` | the helper: `serve`, `guard`, `backup …`, `event …`, `call …` |
| `/run/helena-hostd/hostd.sock` | Varlink socket (`helena-hostd.socket`), root:helena-hostd 0660 |
| `/etc/helena/hostd.json` | config: callers (the API's user), backup paths, owner home, SQLite globs |
| `/var/lib/helena/hostd/` | settings the owner changes in Helena, guard state, events, audit log, backup history |
| `helena-power-guard.service` | restores the fan and power choice at boot, raises fixed-low fans when the CPU is hot |
| `helena-backup{,-maintenance,-restore-test}.{service,timer}` | restic backup (schedule from Helena), weekly prune + check, monthly restore test |
| `/etc/smartmontools/run.d/50helena`, `/etc/mdadm/mdadm.conf.d/helena.conf` | smartd and mdadm report events to Helena |
| `/var/backups/helena/restic` | the local repository; password `/etc/helena/backup/restic.password` (root, 0400) |

## Protocol

[Varlink](https://varlink.org) (JSON + NUL over the Unix socket), systemd's own IPC. The API's
client is `apps/api/src/modules/server/hostd.ts`. As root on the console:

```sh
varlinkctl info /run/helena-hostd/hostd.sock
varlinkctl introspect /run/helena-hostd/hostd.sock io.helena.hostd
varlinkctl call /run/helena-hostd/hostd.sock io.helena.hostd.StorageStatus '{}'
```

Only root and the users in `callers` may connect (peer credentials). Every method checks its
parameters against a fixed schema; unknown parameters are refused. Changes are written to
`/var/lib/helena/hostd/audit.log` and the journal, never with a secret.

## Install (orchestrator)

```sh
sudo ./install.sh --owner wilhelmpa install     # helper, units, hooks; then restart the API
sudo ./install.sh backup-init                    # password + repository + timers
sudo systemctl start helena-backup.service       # the first backup (long: every folder once)
sudo fans/install-fan-control.sh --from-clones /home/wilhelmpa/Projekte/Linux install
```

Rollback: `sudo fans/install-fan-control.sh uninstall` (fans back to auto, modules and
ryzenadj removed), `sudo ./install.sh uninstall` (keeps the repository and its password).

## Tests

```sh
python3 -m unittest discover -s deployment/volition-stack/native/server/tests -v
```
