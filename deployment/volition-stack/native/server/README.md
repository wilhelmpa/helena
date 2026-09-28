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
| `/etc/udev/rules.d/60-helena-nvme.rules` + `helena-nvme-pm` | NVMe disks stay awake: APST off, no D3cold, no runtime suspend of the disk or its root port |
| `/etc/apt/apt.conf.d/99helena-esp-sync` + `helena-esp-sync` | after every package change the second ESP gets the first one's content, guarded and verified |
| `helena-boot-entries.service` | at every boot: the firmware entries "Debian" / "Debian (Reserve)" point at their ESPs (`helena-hostd boot-repair`) |
| `helena-hostd boot-layout` (`install.sh boot-layout`) | once: the entries onto Debian's own `EFI/debian`, which apt keeps current (`--rollback`: back to `EFI/helena-raid`) |

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

## Memory guards

`memory-guards.sh` is an explicit installer step for systemd resource controls. It protects
`system.slice` (11G), `lemond.service` (7G), the API, web, worker and Hermes runner (512M each),
and PostgreSQL 17 (1G) with `MemoryLow`. It limits the development account's `user-UID.slice`
with `MemoryHigh=12G` and `MemoryMax=15G`; the UID is resolved from `HELENA_DEV_USER` (default
`wilhelmpa`). The existing `lemond.service` `MemoryHigh=11G` and `MemoryMax=12G` remain in force.
The controls protect local AI under memory pressure and cap development workloads.

```sh
./install.sh --dry-run --owner wilhelmpa memory-guards
sudo ./install.sh --owner wilhelmpa memory-guards
./memory-guards.sh check
```

`apply` uses persistent `systemctl set-property` values and changes only mismatches. It installs
the check at `/usr/local/libexec/helena-memory-guards` for `hardening/audit.sh`, which reports
`sys.memory_guards` as a warning when the step is absent or a value differs. Run this step after
the named services exist. Override values with `HELENA_MEMORY_SYSTEM_LOW`,
`HELENA_MEMORY_LEMOND_LOW`, `HELENA_MEMORY_SERVICE_LOW`, `HELENA_MEMORY_POSTGRES_LOW`,
`HELENA_MEMORY_DEV_HIGH`, `HELENA_MEMORY_DEV_MAX`, or the PostgreSQL unit with
`HELENA_POSTGRES_UNIT`. Use the same overrides for `check` and for the hourly audit service if
the installed values differ from the defaults.

## Storage safeguards

Added after 2026-09-25, when the Samsung of the RAID fell off the PCIe bus. Decision and
alternatives: `docs/helena-decisions/server-admin.md` §3a.

- **NVMe power** (`hooks/60-helena-nvme.rules`): the controller's latency tolerance 0 (APST
  off; also the `nvme_core` default, for a controller probed again after a rescan), the NVMe
  PCI function `d3cold_allowed=0` and `power/control=on`, and `power/control=on` on every PCIe
  bridge above it. Independent of the kernel command line (a boot that read a stale
  `grub.cfg` ran without `nvme_core.default_ps_max_latency_us=0`). ASPM stays with the
  firmware (these devices have no `link/*aspm*` attributes). Check:
  `cat /sys/class/nvme/nvme*/power/pm_qos_latency_tolerance_us` (0),
  `cat /sys/bus/pci/devices/*/d3cold_allowed` of the NVMe functions (0).
- **ESP copy** (`esp.py`, run by apt's `DPkg::Post-Invoke`): copies `/boot/efi` onto
  `/boot/efi2` only when both are mounted vfat file systems (not the same one), the source has
  `shimx64.efi` and `grub.cfg` in every loader folder of the layout found on either ESP
  (`EFI/debian`, and `EFI/helena-raid` while it exists), and every file of it reads back in
  full; then
  `rsync -a --delete --modify-window=1` must exit 0 and every copied file must hash like its
  source. Anything else leaves the mirror alone. The outcome is in
  `/var/lib/helena/hostd/esp-sync.json` (Server → Platten & RAID: amber "skipped" while the
  mirror may lack something, red "failed"); a change of it is an event. By hand:
  `sudo /usr/local/lib/helena/hostd/helena-esp-sync [--dry-run]`.
- **Boot entry repair** (`boot.py`, `helena-boot-entries.service` at every boot, or
  `sudo /usr/local/lib/helena/hostd/helena-hostd boot-repair [--dry-run]`): for each ESP that
  is mounted and whose disk is on the bus, exactly one active entry with its label ("Debian"
  for the first, "Debian (Reserve)" for the second, config `mainBootLabel`/`reserveBootLabel`)
  on that partition's GUID, starting `bootLoader` (default `\EFI\debian\shimx64.efi`). A
  missing, `VenHw(…)`-rewritten, wrong-disk or wrong-loader entry is replaced: the new one is
  created and read back **before** the wrong one is deleted. An entry still starting the old
  layout (`\EFI\helena-raid\shimx64.efi`, config `legacyBootLoaders`) keeps working and is
  moved once `EFI/debian` has its shim and `grub.cfg` on that ESP (event "Starteinträge
  umgestellt"). An ESP that is not mounted is left alone,
  and so is an entry with the label that belongs to another install on another disk. The
  boot order becomes Debian, Debian (Reserve), then the rest, once "Debian" is verified.
  Every change goes to the audit log, the journal and the events.
- The ESP copy and the boot entry repair stay silent on a machine without this layout (both
  ESP mounts in `/etc/fstab` and a known loader folder on one of them): another boot layout is
  not theirs to judge.

## Boot layout: onto Debian's EFI/debian (once)

The RAID was set up with its loader in `EFI/helena-raid`, which apt never updates: Debian's
`grub-efi-amd64` and `shim-signed` postinst scripts run `grub-install` for `EFI/debian`, and
with debconf `grub2/update_nvram=true` they add their own "debian" entry at the front of the
boot order. `helena-hostd boot-layout` (`bootlayout.py`) moves the machine onto the standard
path: config `bootLoader` = `\EFI\debian\shimx64.efi`, debconf `grub2/update_nvram=false` and
`grub2/force_efi_extra_removable=true`, `grub-install --target=x86_64-efi
--efi-directory=/boot/efi --bootloader-id=debian --uefi-secure-boot --force-extra-removable
--no-nvram` (skipped when `EFI/debian` and `EFI/BOOT` already check out), a check that
`EFI/debian` holds Debian's signed shim/GRUB/MokManager and a `grub.cfg` that finds `/boot/grub`
like the old stub (`search.fs_uuid <root uuid> root mduuid/<array uuid>`, prefix `/boot/grub`;
otherwise the folder is moved to `EFI/debian-failed-<time>` and nothing else changes), the
removable path `EFI/BOOT` made equal to it (below), the guarded ESP copy, and the boot entry
repair. It refuses while an array is degraded or rebuilding, or an ESP is not mounted or its disk
not on the bus. Idempotent.

**The removable path `EFI/BOOT`.** The AXB35 firmware rewrites BootOrder at every boot and, in the
reboot test of 2026-09-25, started its own "UEFI OS" entry (`\EFI\BOOT\BOOTX64.EFI` on the second
ESP) although "Debian" and "Debian (Reserve)" came first. So `EFI/BOOT` must start the same
binaries: with `force_efi_extra_removable=true` apt's `grub-install` refreshes it at every GRUB or
shim update. Debian's `grub-install --force-extra-removable` (patch
`grub-install-removable-shim.patch`) writes shim as `BOOTX64.EFI`, `grubx64.efi` and `mmx64.efi`
there; `fbx64.efi` only when it may write NVRAM, so never with `--no-nvram` (shim would run it and
create entries of its own); and no `grub.cfg`, so `boot-layout` copies the stub from `EFI/debian`
(it changes only with the root file system's UUID). A leftover `fbx64.efi` is removed. The Disks tab
shows an amber line (`espRemovableStale`) when `EFI/BOOT` on an ESP would start other binaries than
the loader folder, holds `fbx64.efi`, or has a stub that does not find the root; the ESP copy
refuses a source without `BOOTX64.EFI`, `grubx64.efi` and `grub.cfg` there.

**The order the firmware leaves.** `helena-boot-entries.service` logs it at every boot
(`boot-repair: firmware order was …; booted …`) and keeps the last 100 in
`/var/lib/helena/hostd/boot-history.json` (`bootCurrent`, `firmwareOrder`, the order afterwards),
then puts Debian, Debian (Reserve) first again:
`sudo python3 -c 'import json; [print(e["at"], e["bootCurrent"], ",".join(e["firmwareOrder"])) for e in json.load(open("/var/lib/helena/hostd/boot-history.json"))]'`.

```sh
cd /srv/volition/source/plan/deployment/volition-stack/native/server
sudo ./install.sh --dry-run boot-layout      # steps it would take, the entries as they are now
sudo ./install.sh boot-layout                # the change; restarts helena-hostd afterwards
sudo efibootmgr                              # Debian / Debian (Reserve) → \EFI\debian\shimx64.efi, first
sudo debconf-show grub-efi-amd64 | grep update_nvram     # false
sudo diff -r /boot/efi/EFI/debian /boot/efi2/EFI/debian  # no output
sudo cat /boot/efi/EFI/debian/grub.cfg       # search.fs_uuid <root> root mduuid/<array>
sudo debconf-show grub-efi-amd64 | grep force_efi_extra_removable   # true
sudo sh -c 'cd /boot/efi/EFI && cmp BOOT/BOOTX64.EFI debian/shimx64.efi && cmp BOOT/grubx64.efi debian/grubx64.efi && cmp BOOT/grub.cfg debian/grub.cfg && ! ls BOOT/fbx64.efi'
sudo diff -r /boot/efi/EFI/BOOT /boot/efi2/EFI/BOOT       # no output
# then the reboot test: both entries once each (Server → "Einmal von Reserve starten" for the second)
```

**Rollback** (entries back to `EFI/helena-raid`, which stays untouched): `sudo ./install.sh
--rollback boot-layout` (dry run with `--dry-run`). It writes `storage.bootLoader =
\EFI\helena-raid\shimx64.efi` into `/etc/helena/hostd.json`, so the repair at every boot keeps
them there; debconf stays `false`. `boot-layout` without `--rollback` moves them again.

**Later clean-up** (after some weeks on `EFI/debian`, no rollback wanted any more): remove the
old folder from **both** ESPs at once — the ESP copy refuses to delete a loader folder the
mirror still has but the source lost:
`sudo rm -r /boot/efi/EFI/helena-raid /boot/efi2/EFI/helena-raid`.

## Runbook: a disk falls off the bus

**Symptoms.** The journal shows `nvme nvmeX: controller is down; will reset:
CSTS=0xffffffff, PCI_STATUS=0xffff`, `Does your device have a faulty power saving mode
enabled?` and `Unable to change power state from D3cold to D0, device inaccessible`. The
mirror runs on one disk (`cat /proc/mdstat`: `[_U]` or `[U_]`), mdadm reported `Fail`, the
disk is missing from `lsblk`, its ESP is not mounted. Helena shows the RAID red and the
events "Platte ausgefallen" / "Spiegel unvollständig".

**Do not** install kernel or GRUB updates while the mirror is degraded if it can wait: the
ESP copy is skipped, and `grub-install` may write into an unmounted `/boot/efi` directory.
Do not reboot to "try again": a warm reboot usually does not bring the disk back (on the
AXB35 the firmware did not even enumerate it, and it rewrote the "Debian" entry to
`VenHw(99e275e7-…)`). Do not rescan PCI or reset the bus: it did not help.

**Recover** (the Server tab's "Platte ersetzen" → "Erst prüfen: ist Platte X nur
verschwunden?" has the same steps with this machine's names):

1. Shut down cleanly: `sudo systemctl poweroff`.
2. Power on: the power button, or Wake-on-LAN from any machine on the LAN (the NIC's
   profile has `802-3-ethernet.wake-on-lan magic`; the MAC is in `ip link` /
   `nmcli -g GENERAL.HWADDR device show <nic>`):

   ```sh
   wakeonlan AA:BB:CC:DD:EE:FF          # Debian/Ubuntu: apt install wakeonlan; macOS: brew install wakeonlan
   ```

   ```python
   import socket
   mac = bytes.fromhex('AA:BB:CC:DD:EE:FF'.replace(':', ''))
   with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
       s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
       s.sendto(b'\xff' * 6 + mac * 16, ('255.255.255.255', 9))
   ```
3. Check SMART: `sudo smartctl -a /dev/$(lsblk -dno PKNAME /dev/disk/by-partlabel/HELENA-EFI-A)`
   (the letter of the disk that was gone). Media errors 0, an empty error log, critical
   warning 0: the disk is fine.
4. Back into the mirror: mdadm usually re-adds it at boot and, with the internal bitmap,
   catches up in minutes. Otherwise
   `sudo mdadm --manage /dev/md/helena-root --re-add /dev/disk/by-partlabel/HELENA-RAID-A`.
   **Wait for `[UU]` before the next reboot:** until the member is in sync, GRUB may read
   `/boot/grub/grub.cfg` from the stale member (seen on 2026-09-25: the boot missed a kernel
   parameter added after the disk fell off).
5. ESP and boot entry (the entries start `\EFI\debian\shimx64.efi` after the layout change):
   `mountpoint -q /boot/efi || { sudo fsck.vfat -a
   /dev/disk/by-partlabel/HELENA-EFI-A && sudo mount /boot/efi; }`, then
   `sudo /usr/local/lib/helena/hostd/helena-hostd boot-repair --dry-run`, read it, run it
   without `--dry-run`, and catch up the ESP copy with
   `sudo /usr/local/lib/helena/hostd/helena-esp-sync`. (At the next boot
   `helena-boot-entries.service` would repair the entry by itself.)

**Replace the disk** ("Platte ersetzen" in the same dialog) when SMART shows media errors,
entries in the error log, a critical warning or the spare below its threshold, or when it
falls off again after these safeguards.

## Install (orchestrator)

```sh
sudo ./install.sh --dry-run --owner wilhelmpa install   # what it would do
sudo ./install.sh --owner wilhelmpa install     # helper, units, hooks; then restart the API
sudo /usr/local/lib/helena/hostd/helena-hostd boot-repair --dry-run   # should list no actions
sudo /usr/local/lib/helena/hostd/helena-esp-sync --dry-run            # should say "ready"
sudo ./install.sh --dry-run boot-layout && sudo ./install.sh boot-layout   # once: onto EFI/debian
sudo ./install.sh backup-init                    # password + repository + timers
sudo systemctl start helena-backup.service       # the first backup (long: every folder once)
sudo fans/install-fan-control.sh --from-clones /home/wilhelmpa/Projekte/Linux install
sudo ./swap.sh --dry-run apply && sudo ./swap.sh apply   # 32 GB /helena.swap + zswap (zstd)
```

Swap: the OS gets ~31 GB (the rest is the GPU's). A `next build` (~10 GB), the local
models and agent test stacks together outgrow that, and with the Debian installer's 8 GB
swap file the machine thrashed (memory pressure 95 %, 2026-09-26). `swap.sh` keeps one
32 GB file on the RAID root and zswap in front of it; it retires other swap files in
fstab, so run it when the machine is not busy.

Rollback: `sudo fans/install-fan-control.sh uninstall` (fans back to auto, modules and
ryzenadj removed), `sudo ./install.sh uninstall` (keeps the repository and its password).

## Tests

```sh
python3 -m unittest discover -s deployment/volition-stack/native/server/tests -v
```
