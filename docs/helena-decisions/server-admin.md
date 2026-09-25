# Decision: Administrator → Server (disks and RAID, backup, power and fans, updates)

Status: accepted, 2026-09-24 · Branch: `hub/server-admin`

Owner, 2026-09-24: "ja, alles in Helena verwaltbar, ebenso wie der Update-Status und die
Lüftersteuerung". Helena shows and changes the machine it runs on: the RAID 1 and its disks,
the local backup, the power profile and the fans, and (with hub/update-center) the updates.
The web never gets root, and the API never runs a privileged command itself.

## 1. The pieces

```text
 web  Administrator → Server  (/god/server/{overview,disks,backup,power,updates})
      Start → "Dienste": ServerHealthLines (red/amber lines, or one quiet summary line)
        │  HTTPS/JSON, the owner's session; every change needs his interactive session
        ▼
 API  modules/server  (routes /god/server/*, cache of a few seconds)
      @helena/sdk registry `hostCapabilities` ← internal plugin `helena.server`
        │  Varlink (JSON + NUL) over /run/helena-hostd/hostd.sock, peer credentials
        ▼
 root helena-hostd  (Python 3 stdlib, socket-activated, fixed method list, audit log)
        ├─ md sysfs, lsblk -J, smartctl -j, findmnt, efibootmgr        (disks, RAID, boot)
        ├─ boot-repair (helena-boot-entries.service), esp-sync (apt hook), NVMe udev rule
        ├─ /sys/class/ec_su_axb35, powerprofilesctl, ryzenadj -i       (power, fans)
        ├─ systemctl start helena-backup*.service, restic --json       (backup)
        └─ events.json ← smartd run.d hook, mdadm PROGRAM hook, guard, backup jobs
 root helena-power-guard.service   boot restore + thermal guard (every 2 s)
 root helena-backup{,-maintenance,-restore-test}.{service,timer}   restic jobs
```

## 2. The root helper

| Candidate | Why not / why |
|---|---|
| **Cockpit** (LGPL-2.1; storage via udisks2, updates via PackageKit) | A second web app with its own login (PAM), its own look and its own sessions next to Helena's. The owner wants one tool. Its backends are the right idea (below). |
| **udisks2 + polkit over D-Bus** | The desktop standard for disks: MDRaid (`RequestSyncAction`), NVMe SMART. But no fans, no EC, no restic, no efibootmgr, so a helper is needed anyway; udisks2 is not installed (apt + OK), and a D-Bus client in Bun is another dependency. polkit rules per action would be a second policy language. |
| **sudoers entries + scripts** (how the owner's old DMS widget did it) | Every script is its own argument parser run as root from a shell; hard to audit, no typed protocol, no status. |
| **A spool folder + path unit** (hub/update-center's `helena-update`, `helena-hermes-update`) | Right for long, queued jobs (an apt upgrade). Too slow for reading temperatures every 5 s and for interactive changes. The update center keeps its helper; hostd does not take over updates. |
| **A socket-activated root service with a fixed method list** (like the isolation launcher) | **Chosen.** One small program, one audit trail, typed parameters, peer credentials. |

**Protocol: Varlink** (https://varlink.org), not a protocol of our own. It is what systemd uses
for its new services, it is two rules (a JSON object per message, ended by a NUL byte;
`{"method": "io.helena.hostd.X", "parameters": {…}}` → `{"parameters": …}` or
`{"error": "…", "parameters": …}`), and Debian 13 ships `varlinkctl`: `varlinkctl info`,
`introspect` and `call` work against the helper with no Helena code (verified on Kingston with
systemd 257). The helper implements `org.varlink.service.GetInfo`/`GetInterfaceDescription` and
the standard errors; every method answers `(result: object)`.

**Language: Python 3 standard library.** Debian ships it, the launcher and the update helpers
are Python, the tests run with `unittest`, nothing to build. Go or Rust would need a toolchain
(not installed; the owner's OK) and a build step in the installer.

**Security model.**
- Socket `root:helena-hostd 0660`; the API's user (`volition-plan`) is in the group, and the
  helper additionally checks the peer's uid against `callers` (SO_PEERCRED). Agents under
  isolation run as other users and cannot connect.
- A fixed list of 25 methods with typed parameters; an unknown method or parameter is refused
  before any handler runs. Every argument that reaches a command is validated (array and disk
  names against what the machine has, snapshot ids as hex, paths absolute without `.`/`..`,
  schedules from a fixed set, retention in bounds). Commands run without a shell, with a fixed
  PATH and `LC_ALL=C`.
- Writes into the kernel only under `/sys` (md `sync_action`, the EC's attributes), and into the
  EC only when the DMI board is `AXB35-02` (the driver itself does not check).
- Every change is written to `/var/lib/helena/hostd/audit.log` (and the journal): time, Unix
  caller, Helena actor (the owner's e-mail), method, parameters with secrets replaced by `…`.
- The API accepts changes only from the owner's interactive session in the app
  (`requireInteractiveOwner`: no API key, trusted origin), because they act as root.
- Units are hardened (`NoNewPrivileges`, `ProtectSystem`, `ProtectHome`, `PrivateTmp`, …);
  `/sys` stays writable for hostd and the guard (so no `ProtectKernelTunables`).

## 3. Disks and RAID

- **Arrays** from the kernel's md interface (`/sys/block/mdX/md/*`: `sync_action`,
  `sync_completed`, `sync_speed`, `degraded`, `mismatch_cnt`, `dev-*/state`), the same one
  mdcheck uses; names from `/dev/md/*`. A consistency check is `echo check > sync_action` on a
  healthy idle array (stopping writes `idle`, and only a check or repair is ever stopped, never a
  rebuild). Debian's monthly `mdcheck_start.timer` stays as it is.
- **Disks** from `lsblk -J` (models, serials, partition labels: `HELENA-RAID-A` → "Platte A"),
  **health** from `smartctl -j -a` (smartmontools 7.4, JSON). smartctl's exit status is a bit
  mask; bit 2 ("a command failed") is ignored (both NVMe drives here fail the self-test-log read
  and are healthy), bit 3 is "failing". Red: failing, critical warning, spare at or below its
  threshold. Amber: media errors, pending sectors, wear ≥ 90 %, temperature ≥ 70 °C. The short
  self-test is offered only where the disk has a self-test log (neither of the two here does).
- **ESPs**: both mounts compared by relative path, size and mtime (vfat's 2 s steps; the apt hook
  `/etc/apt/apt.conf.d/99helena-esp-sync` copies with `rsync -a --delete`, which keeps both).
- **Boot entries** from `efibootmgr`, mapped to disks by partition GUID. "Einmal von Reserve
  starten" sets `BootNext` to the entry labelled `Debian (Reserve)`; the restart is the owner's.
- **Events**: smartd's standard hook (`/etc/smartmontools/run.d/50helena`, called by Debian's
  `smartd-runner` with `SMARTD_*`) and mdadm's `PROGRAM` (in `/etc/mdadm/mdadm.conf.d/helena.conf`,
  so `mdadm.conf` is not touched; mdadm reads the `.d` folder after the file) append to a small
  event file. Unseen critical events are red on Start until marked seen. No mail is needed.
- **"Platte ersetzen"** is a guided runbook with the commands filled in from this machine
  (sgdisk `--replicate` + `--randomize-guids`, labels, mkfs.vfat + fstab + rsync of the ESP,
  `mdadm --add`, the firmware entry through `helena-hostd boot-repair`). Helena shows them;
  the owner runs them. Its first, folded section ("Erst prüfen: ist Platte X nur
  verschwunden?", open while a disk is missing) is the §3a runbook for a disk that only fell
  off the bus.

## 3a. Storage safeguards (after the 2026-09-25 incident)

Branch `hub/storage-resilience`. On 2026-09-25 at 16:21 the Samsung 990 PRO (FW 4B2QJXD7,
root port 00:03.1) dropped off the PCIe bus: `controller is down; will reset:
CSTS=0xffffffff, PCI_STATUS=0xffff`, the kernel's own hint `nvme_core.default_ps_max_latency_us=0
pcie_aspm=off pcie_port_pm=off`, then `Unable to change power state from D3cold to D0`. md
failed the member; the array ran on the Kingston. PCI remove/rescan, a secondary bus reset
and a warm reboot did not bring it back; the firmware did not enumerate it and rewrote the
"Debian" entry to `VenHw(99e275e7-75a0-4b37-a2e6-c5385e6c00cb)`, so the machine booted
"Debian (Reserve)". A poweroff and Wake-on-LAN brought it back with clean SMART; mdadm
re-added it from the bitmap in minutes. Afterwards GRUB had read `grub.cfg` from the stale
member (the boot lacked a parameter added after 16:21). The mdadm `PROGRAM` hook reported the
failure to hostd, but nobody was told out of band (no MTA).

**NVMe power (udev rule, not only the kernel command line).**

| Option | Decision |
|---|---|
| `nvme_core.default_ps_max_latency_us=0` on the GRUB command line | Kept (set live), but not enough alone: the boot that read a stale `grub.cfg` ran without it. |
| `options nvme_core default_ps_max_latency_us=0` in `/etc/modprobe.d` | Rejected for now: nvme_core loads from the initramfs, so it needs an `update-initramfs` per kernel; the udev rule below reaches the same without touching the initramfs. |
| **udev rule** (`60-helena-nvme.rules`, the standard place for per-device power policy, as TLP and powertop use it) | **Chosen.** `power/pm_qos_latency_tolerance_us=0` on each controller (the driver then disables APST: `nvme_set_latency_tolerance()` → `nvme_configure_apst()`); the attribute only exists once the controller is identified, so it is set again when the namespace block device appears, and the module default is set for controllers probed later. NVMe PCI functions (class `0x010802`): `d3cold_allowed=0`, `power/control=on`; every PCIe bridge above them: `power/control=on` (the root ports were `auto`). |
| `pcie_aspm=off` / `pcie_port_pm=off` on the command line | Not added: the firmware owns ASPM on this board (no `link/*aspm*` attributes, only `clkpm`), and `pcie_port_pm=off` is covered for these ports by the rule. |

**ESP copy (guarded, in the repo).** The hand-made apt hook ran `rsync -a --delete` whenever
both ESPs were mounted, even from a source that a dying disk could no longer read.

| Option | Decision |
|---|---|
| ESP on md RAID 1 with metadata 1.0 (superblock at the end, firmware sees FAT) | Rejected: the firmware and fwupd write to the ESP behind md's back, and a divergent mirror is then undetectable and unrepairable. |
| Ubuntu's `grub-multi-install` (`grub-efi/install_devices`) | Not in Debian 13 (checked: no `/usr/lib/grub/grub-multi-install`, no such debconf question). |
| systemd-boot / `bootctl` with two ESPs | Would replace shim+GRUB; out of scope. |
| **Guarded copy after every package change** (same `99helena-esp-sync` name, so the installer replaces the hand-made hook) | **Chosen.** Copies only when both are mounted vfat and different file systems (same source device or same root inode → skipped), the source has the loader and its `grub.cfg` (non-empty), and every source file reads back in full; then rsync must exit 0 and every copied file must hash like its source. Never `--delete` from a source that failed a check. The outcome (`esp-sync.json`) feeds the health lines `espSyncSkipped` (amber, only while the mirror may lack something: the source changed since the last verified copy or could not be read) and `espSyncFailed` (red); a change of the outcome is an event; it never fails apt. |

**Boot entry self-repair.** `efibootmgr` (the standard) is driven by `helena_host/boot.py`,
run at every boot by `helena-boot-entries.service` (oneshot after both ESP mounts,
`DefaultDependencies=no` so a missing disk's 90-s mount wait delays nothing) and by
`helena-hostd boot-repair [--dry-run]`. For each ESP that is mounted and whose disk is on the
bus: exactly one active entry with its label on that partition's GUID, starting the loader.
Rules: create and read back **before** deleting; delete a wrong entry only when its role has a
verified right one; never touch an ESP that is not mounted (a degraded boot changes nothing)
or an entry with the label pointing to another disk's partition that is not one of the ESPs
(another install; reported as `foreign`); order Debian, Debian (Reserve), the rest, only once
"Debian" is verified. `StorageStatus.bootEntries` reports each entry's state (`ok`, `missing`,
`noPartuuid` = rewritten by the firmware, `wrongDisk`, `wrongLoader`, `inactive`, `duplicate`,
`loaderMissing`, `unchecked`); the API shows amber lines until the next boot repairs them.
Both the copy and the repair only act where the layout is in use (the loader's folder is on
one of the ESPs), so an installation with another boot layout gets no lines from them.
"Platte ersetzen" now uses the same repair instead of hand-built efibootmgr commands.

**Boot layout: Debian's own `EFI/debian` (decided 2026-09-25 by the orchestrator, standard
path, fewer custom parts).** Debian 13's `grub-efi-amd64.postinst` runs `grub-install`
whenever `/boot/grub/x86_64-efi/core.efi` exists, and `shim-signed.postinst` whenever
`/boot/efi/EFI/debian` exists, both with the bootloader id from `GRUB_DISTRIBUTOR` (`debian`)
and, with `grub2/update_nvram=true`, an NVRAM write that puts a "debian" entry first. The RAID
was set up with `--bootloader-id=helena-raid`, a folder apt never updates.

| Option | Decision |
|---|---|
| Keep `EFI/helena-raid` and re-run `grub-install --bootloader-id=helena-raid` from a dpkg hook after GRUB/shim updates | Rejected: one more custom part to keep working, against the package's own path. |
| `GRUB_DISTRIBUTOR=helena-raid` | Rejected: changes the GRUB menu title and every other place the distributor appears. |
| **Entries on `EFI/debian`, apt keeps it current, NVRAM left to Helena** | **Chosen.** `helena-hostd boot-layout` (once, idempotent, dry run first): config `bootLoader` → `\EFI\debian\shimx64.efi`; debconf `grub2/update_nvram=false` (apt never adds its "debian" entry or reorders); `grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=debian --uefi-secure-boot --no-nvram`; a check that the result is Debian's signed shim/GRUB/MokManager (hashes of `/usr/lib/shim/*.signed`, `/usr/lib/grub/x86_64-efi-signed/grubx64.efi.signed`) and that `EFI/debian/grub.cfg` finds `/boot/grub` like the helena-raid stub (`search.fs_uuid <uuid> root mduuid/<array>`, prefix `/boot/grub`) — else the folder is moved aside and nothing else changes; the guarded ESP copy; the boot entry repair. Refuses while an array is degraded or rebuilding or an ESP is missing. |

The repair knows both loaders: the configured one and the old one (`legacyBootLoaders`, by
default the other of `\EFI\debian\shimx64.efi` / `\EFI\helena-raid\shimx64.efi`). An
entry on the right ESP that starts the old one is `oldLayout`: it keeps working (no health
line) and is moved (create, read back, delete; event "Starteinträge umgestellt", info) once
the configured loader has its shim and `grub.cfg` on that ESP. The ESP copy requires both
files in every loader folder found on either ESP, so it never deletes a loader the mirror
still starts. `EFI/helena-raid` stays as the fallback; **rollback** = `helena-hostd
boot-layout --rollback` (config override back to `\EFI\helena-raid\shimx64.efi`, entries
repaired back); **clean-up later** = remove `EFI/helena-raid` from both ESPs at once. The
current `EFI/helena-raid` binaries were byte-identical to Debian's signed images on
2026-09-25 (Secure Boot is off; Debian's `grub-install` installs the signed shim layout by
default when the signed packages are present, as the 2026-09-24 setup did without a flag).
Not changed: `grub2/force_efi_extra_removable` stays `false`, so the firmware's fallback path
`EFI/BOOT` keeps the files of 2026-09-24 (it is copied to the second ESP like everything else).

**Out of band alerting** (mail, push) is not built: the owner chooses the channel. The events
file and the red health lines are ready to be forwarded.

## 4. Backup

| Candidate | Decision |
|---|---|
| **restic** 0.18 (BSD-2; installed from Debian with the owner's OK) | **Chosen.** Encrypted, deduplicated, compressed (repository v2), JSON output, `copy` between repositories, `restore --verify`, S3/SFTP/rest backends. |
| BorgBackup | Good, but needs borg on the remote side for offsite, no S3; not installed. |
| Kopia (Apache-2.0) | Fine, not in Debian: a binary from GitHub (OK needed). |
| duplicity, Proxmox Backup client | Older model / needs a PBS server. |

- **Where**: a local repository on the RAID, `/var/backups/helena/restic` (root 0700), cache
  `/var/cache/helena-backup`. It protects against deletion and mistakes, not against losing the
  whole machine: the offsite target is the answer to that (below).
- **Password**: 32 random bytes (URL-safe base64) generated by `install.sh backup-init`, stored
  `root:root 0400` in `/etc/helena/backup/restic.password`, never logged, excluded from the
  backup itself. The owner sees it **until he confirms he wrote it down** (a card on the Backup
  tab: "Passwort anzeigen", copy, "Ich habe es notiert" → "Bestätigen"); after that the helper
  refuses to hand it out, and only root on the machine can read it. The reveal is a POST that
  needs the interactive session, answers `Cache-Control: no-store`, is audited without the
  value, and the web keeps it in component state only (no query cache). Showing it once, then
  never again, is the pattern of paper keys (Borg's `key export --paper`, Proxmox's encryption
  key download); a confirmation instead of "first view only" keeps a page reload from losing it.
- **Databases**: `pg_dump --format=custom --compress=0` of every database of the local cluster
  (test databases `*_test`, `*_test_*`, `*_dev` excluded) plus `pg_dumpall --globals-only`,
  written into a root-only staging folder that is part of the snapshot and removed afterwards.
  pg_dump is a consistent MVCC snapshot of a live database and restores into any newer
  PostgreSQL; uncompressed, unchanged tables stay byte-identical, so restic deduplicates them
  (a compressed dump changes completely every hour). `pg_basebackup` + WAL archiving (point in
  time) was rejected for now: it needs replication access and archive_command, and a restore
  test would need a second cluster. The live database files (`/var/lib/postgresql`) are not
  copied. Hermes' SQLite files are copied with SQLite's online backup API first (globs in the
  config), so a file mid-write still restores.
- **What**: `/etc`, `/root`, `/srv/volition` (vault, workspaces, source repositories with their
  untracked state), `/var/lib/volition` (Hermes profiles and state, project browser profiles),
  `/var/lib/helena*`, `/usr/local`, `/boot/efi`, `/var/backups/volition`, and the owner's home
  (Projekte, KI-Verläufe, Videos, ~/volition). Excluded: caches (`.cache`, CACHEDIR.TAG via
  `--exclude-caches`, browser caches), `node_modules`, `.next`, `__pycache__`, the agents'
  `~/agent-work` (92 GB of test clusters and clones), `/srv/volition/releases` and `trash`.
  First run ≈ 90 GB read; later runs add only changes.
- **When**: a systemd timer whose `OnCalendar=` the helper writes as a drop-in from the owner's
  choice (hourly at minute m, every 6 h, daily at hh:mm, off). Retention by `restic forget` after
  every run: 24 hourly, 7 daily, 4 weekly, 12 monthly (changeable). Weekly `prune` +
  `restic check --read-data-subset=5%`. Monthly restore test: 20 random files and the database
  dumps from the newest snapshot with `restore --verify`, the largest dump into a scratch
  database `helena_restore_test` with `pg_restore --exit-on-error`, its tables counted, dropped.
  A failed run, check or test is a red line on Start and an event.
- **Restores** never overwrite by default: a copy lands in a new folder, the owner's own files
  under `~/Wiederhergestellt/<time>` (owned by him; created with O_NOFOLLOW, so a planted link is
  refused), everything else under `/var/backups/helena/restores/<time>` (root only). "Am
  ursprünglichen Ort" needs the path typed again (API and helper both check), refuses a parent
  that is a link, and first moves what is there to `<path>.vor-wiederherstellung-<time>`.
  Restores run as transient units (`systemd-run`), so a helper restart does not cut them off.
- **Offsite (behind `HELENA_BACKUP_REMOTE=1`)**: a target abstraction in the settings (`kind`,
  `repository`, `enabled`, last copy); implemented kind **S3** (AWS, Backblaze B2, Hetzner Object
  Storage, Cloudflare R2, MinIO): after each run `restic copy` of the new snapshots into it (the
  target is initialised with `--copy-chunker-params`, the same password). The access key goes
  from the owner's form through the API to the helper, which keeps it root-only in
  `/etc/helena/backup/targets/<id>.env`; Helena's database never holds it. SFTP (Hetzner Storage
  Box) is not built: it needs a host key pinned per target. Moving the key into Zugänge waits
  for an S3 credential kind in hub/access-center.

## 5. Power and fans

The machine is a Bosgame M5 (Sixunited AXB35-02, Ryzen AI Max+ 395, "Strix Halo").

| Piece | Source (pinned) | Licence | Why |
|---|---|---|---|
| `ec_su_axb35` EC driver | cmetz/ec-su_axb35-linux @ `e483ec93deab514c66d3e5c9eeed98b6c17887b4` (2026-04-03) | GPL-2.0 | The only driver for this board's EC: fans (rpm, auto/fixed/curve, level 0–5), CPU temperature, APU power mode. No hwmon PWM exists (lm-sensors/fancontrol, it87/nct6775 do not reach this EC). |
| `ryzen_smu` | amkillam/ryzen_smu @ `0bb95d961664c7a0ac180f849fa16fe7da71922d` (2026-04-25, driver 0.1.7, "Added Strix Halo support") | GPL-2.0 | RyzenAdj needs it (≥ 0.1.7) to read the PM table; Debian's kernel blocks `/dev/mem` (STRICT_DEVMEM). |
| RyzenAdj | FlyGoat/RyzenAdj @ `527cacc5a8d53f54c259b75b3aba7e47d6bc464d` (2026-01-16, v0.17.0-17, `FAM_STRIXHALO`) | LGPL-3.0 | Reads the limits back (`ryzenadj -i`) and can set them; not packaged in Debian, built with cmake + libpci. |
| power-profiles-daemon 0.30 | Debian trixie | GPL-3.0 | The freedesktop standard the owner named: power-saver/balanced/performance over amd-pstate-epp's EPP. |

All three commits are the ones in the owner's clones under `/home/wilhelmpa/Projekte/Linux`
(built and used on this machine under Fedora in 2026-01). The installer takes the pinned tree
with `git archive <commit>` from those clones (`--from-clones`) or clones upstream and checks
the commit. Both modules are DKMS packages built for **every installed kernel** (6.12.107 and a
backports 7.1.8 side by side), with `linux-headers-amd64` so future kernels rebuild; a kernel
they do not build for is reported and keeps booting without fan control. A static review of
both sources found nothing that changed up to 7.1 (class_create with one argument, sysfs
attributes, kobjects, pci_driver, `ec_read`/`ec_write` still exported for the laptop drivers);
the build itself is the proof and happens in the install. Secure Boot is off on this machine;
with it on, DKMS would need its MOK key enrolled.

**Profiles** — one Helena profile sets three layers together; each is shown on its own:

| Helena | EC `apu/power_mode` ("BIOS") and its limits STAPM/fast/slow* | OS (ppd → EPP) | ryzenadj |
|---|---|---|---|
| Sparsam | quiet — 54 / 100 / 54 W | power-saver → `power` | none by default |
| Ausgewogen | balanced — 85 / 120 / 120 W | balanced → `balance_performance` | none by default |
| Leistung | performance — 120 / 140 / 120 W | performance → `performance` | none by default |

\* https://strixhalo.wiki/Guides/Sixunited_AXB35/Power_Mode_and_Fan_Control/ (2026-09-24). The
owner's old "Leistung" (ryzenadj 120/140/120 W) equals the EC's performance mode, so no override
is needed. Overrides can be configured per profile in `/etc/helena/hostd.json`
(`power.overrides`), are **never above the EC mode's own limits** (the helper refuses them), are
applied 1.5 s after the mode switch (a mode switch resets them), and the guard re-applies them
when a read-back shows they were reset (sleep, EC). The EC mode alone is the vendor-tested,
reversible default. Note: in power-saver, ppd may also lower the iGPU's clocks
(`amdgpu_dpm` action); if local models run on the iGPU in Sparsam, block that action with
`--block-action=amdgpu_dpm` in a ppd drop-in.

**Fans** — all three together: "Automatisch" (the EC's own firmware curve, `mode=auto`) or fixed
levels 1–5 (20–100 %). The driver's software `curve` mode is not offered. The installer's first
choice is **level 5** (owner: "alle Lüfter auf Maximum"). The choice persists in the helper's
settings; `helena-power-guard.service` applies profile and fans at boot as soon as the EC driver
is there (and again whenever the driver appears).

**Thermal guard** — the old setup ran the fans fixed at level 1 and the CPU reached 99 °C and
throttled. While the fans are fixed below 5 and the hotter of the EC's CPU sensor and k10temp's
Tctl stays ≥ 90 °C (70–95 settable) for 5 s, the guard sets level 5, records an event and shows
it; after two minutes below 80 °C the owner's level comes back. Without any temperature reading
for 30 s it assumes the worst. A lower level chosen while the guard holds is kept and applied
when it lets go. Without the EC driver the guard reports "not available" and looks again every
30 s (no error loop).

Prior art looked at: DAE51D/strix-halo-power (Plasma applet + D-Bus service + sudo helper, EC
power mode only, no fans, no licence stated), the owner's DMS widget and `strix-halo-profile`
wrapper (sudo), tuned (the owner measured ppd 6 % faster).

## 6. Memory

The firmware reserves 96 GiB of the 128 GB as VRAM (the owner's choice for local models); the OS
sees about 31 GiB. The overview shows it neutrally ("RAM fürs System 31 GB · GPU reserviert
96 GB"). Memory pressure is judged only from `MemAvailable` (< 10 %) and PSI (`some avg60` >
10 %), never from the split.

## 7. Updates

hub/update-center owns updates (its `UpdateSource` registry, its root helper `helena-update`,
approvals). The Server area only mounts its view as the "Updates" tab
(`apps/web/src/features/server/updatesTab.tsx`: `Body = UpdateCenterView`,
`Action = UpdateCheckAction` in the toolbar row); `/god/updates` redirects to
`/god/server/updates`, and the Administrator sidebar has one entry ("Server"). The tab needs no
host helper, so a container still shows Server with only Updates. hostd never applies updates.

## 8. Extension points

- `@helena/sdk` **`HostCapability`** (registry `hostCapabilities`, API): `id`, `label`, `area`
  (`overview`, `disks`, `backup`, `power`, `updates` or a plugin's own), `probe()` → available or
  why not (`no_helper`, `not_installed`, `unsupported`, `failed`), `health()` → lines
  (`ok`/`attention`/`critical`/`unknown`, a message code with values, or a plugin's text). The
  built-ins are the internal plugin `helena.server`. Without the helper (Docker) every built-in
  probe answers `no_helper`, the tabs disappear, and the sidebar hides "Server" unless the
  update center is there.
- UI slot **`server-section`** (`@helena/sdk` `ServerSectionSlot`; web registry
  `apps/web/src/extensions/serverSections.tsx`): a feature adds a section to a Server tab —
  meant first for hub/local-ai's GPU/NPU/VRAM/model status on the overview.

## 9. Not built / later

- Out-of-band alerts for critical events (a failed disk, a failed ESP copy): channel open.
- A "Starteinträge jetzt reparieren" button (hostd.service runs with `ProtectSystem=true`;
  efivars are writable, so a Varlink method would work; today the repair runs at boot).

- SFTP offsite targets; the S3 key in Zugänge (needs an access-center credential kind).
- A plugin's `server-section` as a sandboxed frame (only built-in components render).
- An MCP tool for agents to read the server's health (read-only) — no agent may change the host.
- Notifications beyond Start's red lines (the event list is the history).
