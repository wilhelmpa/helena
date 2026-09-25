"""Moving the firmware entries onto Debian's own loader folder, EFI/debian (and back).

The RAID was set up on 2026-09-24 with its loader in EFI/helena-raid (`grub-install
--bootloader-id=helena-raid`). apt never updates that folder: Debian's grub-efi-amd64 and
shim-signed postinst scripts run grub-install for EFI/<GRUB_DISTRIBUTOR> (EFI/debian), and
with debconf grub2/update_nvram=true they also add their own "debian" entry at the front of
the boot order. `helena-hostd boot-layout` moves the machine onto that standard path once
(idempotent; `--dry-run` first):

1. the config names \\EFI\\debian\\shimx64.efi (the default; a rollback's override goes);
2. debconf grub2/update_nvram=false: apt keeps EFI/debian current and leaves NVRAM alone;
3. `grub-install --target=x86_64-efi --efi-directory=<first ESP> --bootloader-id=debian
   --uefi-secure-boot --no-nvram`, unless EFI/debian already checks out. It has to hold
   Debian's signed shim, GRUB and MokManager, and a grub.cfg that finds /boot/grub's file
   system like the helena-raid stub does (`search.fs_uuid <uuid> root mduuid/<array>`);
   otherwise the folder is moved aside (EFI/debian-failed-<time>), so no entry ever points
   at it, and nothing else changes;
4. the guarded ESP copy onto the second ESP (esp.py);
5. the boot entry repair (boot.py): both entries move to EFI/debian, created and read back
   before the old ones go.

EFI/helena-raid stays as a fallback (remove it later from both ESPs at once). `--rollback`
points the config at EFI/helena-raid and repairs the entries back (debconf stays false).
Both refuse while an array is degraded or rebuilding, or an ESP is not mounted or its disk is
not on the bus."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shutil
import time

from . import audit, boot, esp, storage
from .common import Host, HostError, clip
from .config import Config, write_storage_override

SIGNED = (
    ('shimx64.efi', '/usr/lib/shim/shimx64.efi.signed'),
    ('grubx64.efi', '/usr/lib/grub/x86_64-efi-signed/grubx64.efi.signed'),
    ('mmx64.efi', '/usr/lib/shim/mmx64.efi.signed'),
)
DEBCONF_PACKAGE = 'grub-efi-amd64'
DEBCONF_QUESTION = 'grub2/update_nvram'
DEBIAN_FOLDER = 'EFI/debian'


def _sha256(path: str) -> str | None:
    try:
        digest = hashlib.sha256()
        with open(path, 'rb') as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b''):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


# ── Checks ───────────────────────────────────────────────────────────────────────────────

def preflight(host: Host, config: Config) -> list[dict]:
    """Refuses unless both ESPs are mounted vfat on disks that are on the bus and no array is
    degraded or rebuilding. Returns the ESPs' partitions (main first)."""
    if not host.exists('/sys/firmware/efi') or not host.which('efibootmgr'):
        raise HostError('NotSupported', 'this machine has no EFI boot manager')
    mounts = list(config.storage.get('espMounts') or [])[:2]
    if len(mounts) < 2:
        raise HostError('NotSupported', 'this machine has no mirrored EFI partitions')
    for array in storage.read_arrays(host):
        if array['degraded'] > 0:
            raise HostError('NotAllowed', f"the mirror {array['name']} is degraded")
        if array['syncAction'] in ('recover', 'resync', 'reshape'):
            raise HostError('NotAllowed', f"the mirror {array['name']} is rebuilding")
    devices = storage.lsblk(host)
    found = []
    for mount in mounts:
        mounted = esp._mounted(host, mount)
        if not mounted or mounted.get('fstype') != 'vfat':
            raise HostError('NotAllowed', f'{mount} is not mounted')
        partition = boot.esp_partition(host, mount, devices)
        if partition is None:
            raise HostError('NotAllowed', f'the disk of {mount} is not on the bus')
        found.append({'mount': mount, **partition})
    return found


def root_filesystem(host: Host, devices: list[dict]) -> dict | None:
    """The file system that holds /boot/grub (what the ESP's grub.cfg has to find), with the
    md array's UUID when it is on one."""
    findmnt = host.which('findmnt')
    if not findmnt:
        return None
    result = host.run([findmnt, '-J', '-n', '-o', 'TARGET,SOURCE,UUID', '-T', '/boot/grub'], timeout=10)
    try:
        found = (json.loads(result.stdout).get('filesystems') or [None])[0] if result.returncode == 0 else None
    except ValueError:
        found = None
    if not found or not found.get('uuid'):
        return None
    source = found.get('source') or ''
    array_uuid = None
    if source.startswith('/dev/md'):
        # /dev/md127 (or /dev/md/<name> → ../md127): its members carry the array's UUID.
        names = {os.path.basename(source), os.path.basename(os.path.realpath(host.path(source)))}
        for device in devices:
            for part in boot._walk(device):
                if part.get('fstype') == 'linux_raid_member' and any(
                        child.get('kname') in names for child in part.get('children') or []):
                    array_uuid = (part.get('uuid') or '').replace('-', '').lower() or None
    return {'target': found.get('target') or '/', 'source': source, 'uuid': found['uuid'].lower(),
            'md': source.startswith('/dev/md'), 'arrayUuid': array_uuid}


def check_grub_cfg(text: str | None, root: dict | None) -> str | None:
    """None when the stub finds the root the way the helena-raid one does; else what is wrong."""
    if not text:
        return 'grub.cfg is missing'
    if not root:
        return 'the file system of /boot/grub is unknown'
    search = next((line.split() for line in text.splitlines() if line.strip().startswith('search')), None)
    if not search or search[0] != 'search.fs_uuid' or len(search) < 3 or search[1].lower() != root['uuid'] \
            or search[2] != 'root':
        return 'grub.cfg does not search the root file system by its UUID'
    hints = [hint.lower() for hint in search[3:]]
    if root['md']:
        wanted = f"mduuid/{root['arrayUuid']}" if root.get('arrayUuid') else 'mduuid/'
        if not any(hint.startswith(wanted) for hint in hints):
            return 'grub.cfg has no mduuid hint for the RAID'
    prefix = '/' + os.path.relpath('/boot/grub', root['target'])
    if f"set prefix=($root)'{prefix}'" not in text:
        return 'grub.cfg sets another prefix'
    if 'configfile $prefix/grub.cfg' not in text:
        return 'grub.cfg does not load the grub.cfg of /boot/grub'
    return None


def check_debian_folder(host: Host, mount: str, devices: list[dict]) -> str | None:
    """None when EFI/debian on `mount` holds Debian's signed images and a good grub.cfg."""
    base = os.path.join(host.path(mount), DEBIAN_FOLDER)
    for name, signed in SIGNED:
        installed = _sha256(os.path.join(base, name))
        if installed is None:
            return f'{DEBIAN_FOLDER}/{name} is missing'
        expected = _sha256(host.path(signed))
        if expected is None:
            return f'{signed} is missing (grub-efi-amd64-signed, shim-signed)'
        if installed != expected:
            return f"{DEBIAN_FOLDER}/{name} is not Debian's signed image"
    return check_grub_cfg(host.read(os.path.join(mount, DEBIAN_FOLDER, 'grub.cfg')), root_filesystem(host, devices))


def debconf_value(host: Host) -> str | None:
    """grub2/update_nvram as debconf holds it: 'true', 'false', '' (unset) or None (no debconf)."""
    tool = host.which('debconf-show')
    if not tool:
        return None
    result = host.run([tool, DEBCONF_PACKAGE], timeout=30)
    for line in result.stdout.splitlines():
        match = re.match(r'^[\s*]*grub2/update_nvram:\s*(\S*)', line)
        if match:
            return match.group(1)
    return None


# ── The change ───────────────────────────────────────────────────────────────────────────

def _preview_config(config: Config, loader: str) -> Config:
    data = copy.deepcopy(config.data)
    data['storage']['bootLoader'] = loader
    data['storage']['legacyBootLoaders'] = None
    return Config(data, config.path)


def _roles(repaired: dict) -> list[dict]:
    return [{'label': check['label'], 'state': check['state'], 'number': check['number']}
            for check in repaired.get('roles') or []]


def migrate(host: Host, config: Config, *, dry_run: bool = False, log=lambda message: None,
            actor: str = 'console') -> dict:
    esps = preflight(host, config)
    main = esps[0]['mount']
    devices = storage.lsblk(host)
    steps: list[dict] = []
    result: dict = {'dryRun': dry_run, 'to': boot.DEBIAN_LOADER, 'steps': steps, 'ok': True}

    def done(ok: bool, error: str | None = None, step: str | None = None) -> dict:
        result['ok'] = ok
        if error:
            result.update(error=error, failedStep=step)
            log(f'boot-layout: {step}: {error}')
        if not dry_run:
            audit.append(config.state_dir, {
                'at': audit.now_iso(host), 'caller': 'root', 'actor': actor, 'method': 'BootLayout',
                'params': {'to': 'debian'}, 'ok': ok, 'steps': steps, **({'error': error} if error else {}),
            }, log)
        return result

    # 1. The config names Debian's loader.
    storage_config = config.storage
    if (boot.normalize_loader(storage_config.get('bootLoader')) != boot.normalize_loader(boot.DEBIAN_LOADER)
            or storage_config.get('legacyBootLoaders') is not None):
        steps.append({'step': 'config', 'set': {'bootLoader': boot.DEBIAN_LOADER}})
        if not dry_run:
            write_storage_override(config, {'bootLoader': None, 'legacyBootLoaders': None})
    else:
        steps.append({'step': 'config', 'already': True})

    # 2. apt keeps EFI/debian current without touching the firmware's entries.
    value = debconf_value(host)
    if value is None:
        return done(False, 'debconf is not available', 'debconf')
    if value == 'false':
        steps.append({'step': 'debconf', 'already': True})
    else:
        steps.append({'step': 'debconf', 'was': value, 'set': 'false'})
        if not dry_run:
            tool = host.which('debconf-set-selections')
            outcome = host.run([tool], input=f'{DEBCONF_PACKAGE} {DEBCONF_QUESTION} boolean false\n',
                               timeout=30) if tool else None
            if outcome is None or outcome.returncode != 0 or debconf_value(host) != 'false':
                return done(False, 'debconf-set-selections did not take grub2/update_nvram=false', 'debconf')

    # 3. Debian's own folder on the first ESP, checked.
    problem = check_debian_folder(host, main, devices)
    if problem is None:
        steps.append({'step': 'grubInstall', 'already': True})
    else:
        grub_install = host.which('grub-install')
        if not grub_install:
            return done(False, 'grub-install is not installed', 'grubInstall')
        argv = [grub_install, '--target=x86_64-efi', f'--efi-directory={main}', '--bootloader-id=debian',
                '--uefi-secure-boot', '--no-nvram']
        steps.append({'step': 'grubInstall', 'because': problem, 'argv': argv})
        if not dry_run:
            installed = host.run(argv, timeout=600)
            log(f'boot-layout: grub-install exited {installed.returncode}')
            problem = None if installed.returncode == 0 else f'grub-install exited {installed.returncode}: ' \
                                                              f'{clip(installed.stderr, 300)}'
            problem = problem or check_debian_folder(host, main, devices)
            if problem:
                aside = _move_aside(host, main)
                return done(False, problem + (f'; moved to {aside}' if aside else ''), 'grubInstall')

    # 4. The same onto the second ESP (guarded, verified).
    if dry_run:
        steps.append({'step': 'copy', 'from': main, 'to': esps[1]['mount']})
    else:
        copied = esp.sync(host, config, log=log, trigger='boot-layout')
        steps.append({'step': 'copy', 'state': copied['state'], 'reason': copied.get('reason')})
        if copied['state'] != 'ok':
            return done(False, f"the ESP copy ended {copied['state']} ({copied.get('reason')})", 'copy')

    # 5. Both entries onto EFI/debian.
    preview = config if not dry_run else _preview_config(config, boot.DEBIAN_LOADER)
    repaired = boot.repair(host, preview, dry_run=dry_run, log=log, actor=f'boot-layout ({actor})')
    steps.append({'step': 'bootRepair', 'actions': repaired['actions'], 'entries': _roles(repaired)})
    if dry_run:
        result['note'] = ('the entries move once EFI/debian is on both ESPs (after steps 3 and 4); '
                          'this dry run shows them as they are now')
        return done(True)
    if not repaired['ok'] or any(check['state'] != 'ok' for check in repaired['roles']):
        return done(False, 'the boot entries are not both on EFI/debian: '
                    + ', '.join(f"{r['label']} {r['state']}" for r in _roles(repaired)), 'bootRepair')
    return done(True)


def rollback(host: Host, config: Config, *, dry_run: bool = False, log=lambda message: None,
             actor: str = 'console') -> dict:
    """Entries back to EFI/helena-raid (which the layout change kept), config override set."""
    esps = preflight(host, config)
    for found in esps:
        if not boot.loader_complete(host, found['mount'], boot.HELENA_RAID_LOADER):
            raise HostError('NotAllowed', f"EFI/helena-raid is not complete on {found['mount']}")
    steps: list[dict] = [{'step': 'config', 'set': {'bootLoader': boot.HELENA_RAID_LOADER}}]
    if not dry_run:
        write_storage_override(config, {'bootLoader': boot.HELENA_RAID_LOADER, 'legacyBootLoaders': None})
    preview = config if not dry_run else _preview_config(config, boot.HELENA_RAID_LOADER)
    repaired = boot.repair(host, preview, dry_run=dry_run, log=log, actor=f'boot-layout rollback ({actor})')
    steps.append({'step': 'bootRepair', 'actions': repaired['actions'], 'entries': _roles(repaired)})
    ok = dry_run or (repaired['ok'] and all(check['state'] == 'ok' for check in repaired['roles']))
    result = {'dryRun': dry_run, 'to': boot.HELENA_RAID_LOADER, 'steps': steps, 'ok': ok}
    if not ok:
        result['error'] = 'the boot entries are not both on EFI/helena-raid'
    if not dry_run:
        audit.append(config.state_dir, {
            'at': audit.now_iso(host), 'caller': 'root', 'actor': actor, 'method': 'BootLayout',
            'params': {'to': 'helena-raid'}, 'ok': ok, 'steps': steps,
        }, log)
    return result


def _move_aside(host: Host, mount: str) -> str | None:
    """A folder that failed its check must never become a boot target (the repair at the
    next boot moves the entries to any complete EFI/debian): rename it, or remove it when it
    cannot be renamed. Nothing points at it yet."""
    folder = os.path.join(host.path(mount), DEBIAN_FOLDER)
    if not os.path.isdir(folder):
        return None
    stamp = time.strftime('%Y%m%d%H%M%S', time.gmtime(host.now()))
    for attempt in range(100):
        name = f"{DEBIAN_FOLDER}-failed-{stamp}" + (f'-{attempt}' if attempt else '')
        if os.path.exists(os.path.join(host.path(mount), name)):
            continue
        try:
            os.rename(folder, os.path.join(host.path(mount), name))
            return os.path.join(mount, name)
        except OSError:
            break
    shutil.rmtree(folder, ignore_errors=True)
    return None if os.path.isdir(folder) else f'{mount}/{DEBIAN_FOLDER} (removed)'
