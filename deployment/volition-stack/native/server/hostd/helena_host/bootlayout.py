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

The firmware's own removable-path entry ("UEFI OS", EFI/BOOT/BOOTX64.EFI) can win over our
entries (the AXB35 rewrites BootOrder at every boot), so EFI/BOOT has to start the same
binaries: the change also sets debconf grub2/force_efi_extra_removable=true (apt refreshes
EFI/BOOT with every GRUB/shim update) and installs with --force-extra-removable. Debian's
grub-install then puts shim as BOOTX64.EFI, grubx64.efi and mmx64.efi there; fbx64.efi only
when it writes NVRAM, which --no-nvram rules out (shim would run it and add entries), and no
grub.cfg, so the stub from EFI/debian is copied next to them. A leftover fbx64.efi is removed.

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
# What the layout needs from apt's grub-install (grub-efi-amd64 and shim-signed postinst).
DEBCONF_WANTED = {'grub2/update_nvram': 'false', 'grub2/force_efi_extra_removable': 'true'}
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


def debconf_values(host: Host) -> dict[str, str] | None:
    """grub-efi-amd64's debconf answers ('true', 'false', '' when unset); None without debconf."""
    tool = host.which('debconf-show')
    if not tool:
        return None
    result = host.run([tool, DEBCONF_PACKAGE], timeout=30)
    values = {}
    for line in result.stdout.splitlines():
        match = re.match(r'^[\s*]*(grub2/[\w-]+):\s*(\S*)', line)
        if match:
            values[match.group(1)] = match.group(2)
    return values


def debconf_value(host: Host, question: str = 'grub2/update_nvram') -> str | None:
    values = debconf_values(host)
    return None if values is None else values.get(question, '')


# ── The firmware's removable-media path (EFI/BOOT) ───────────────────────────────────────

def _loader_folder(host: Host, mount: str, config_storage: dict) -> str | None:
    """The folder whose binaries EFI/BOOT has to match: the configured loader's when it is
    complete on this ESP, else the first complete old one (before the change)."""
    current, legacy = boot.loaders(config_storage)
    for loader in (current, *legacy):
        if boot.loader_complete(host, mount, loader):
            return os.path.dirname(boot.loader_relative(loader))
    return None


def removable_state(host: Host, mount: str, config_storage: dict, root: dict | None) -> dict:
    """EFI/BOOT on one ESP, the first problem found: `missing` (no shim there), `differs`
    (not the loader folder's shim/GRUB/MokManager), `fallback` (fbx64.efi present), `stub`
    (its grub.cfg would not find the root); else `ok`, or `unknown` (no complete loader
    folder to compare with)."""
    names = boot.removable_names(config_storage.get('bootLoader') or boot.DEBIAN_LOADER)
    base = os.path.join(host.path(mount), boot.REMOVABLE_FOLDER)
    state = {'mount': mount, 'state': 'unknown', 'detail': None}
    folder = _loader_folder(host, mount, config_storage)
    if names is None or folder is None:
        return state
    if not os.path.isfile(os.path.join(base, names['shim'])):
        return {**state, 'state': 'missing', 'detail': f"{boot.REMOVABLE_FOLDER}/{names['shim']}"}
    arch = names['grub'][len('grub'):-len('.efi')]
    for removable, original in ((names['shim'], f'shim{arch}.efi'), (names['grub'], names['grub']),
                                (names['mm'], names['mm'])):
        theirs = _sha256(os.path.join(host.path(mount), folder, original))
        if theirs is not None and _sha256(os.path.join(base, removable)) != theirs:
            return {**state, 'state': 'differs', 'detail': f'{boot.REMOVABLE_FOLDER}/{removable}'}
    if os.path.exists(os.path.join(base, names['fallback'])):
        return {**state, 'state': 'fallback', 'detail': f"{boot.REMOVABLE_FOLDER}/{names['fallback']}"}
    if check_grub_cfg(host.read(os.path.join(mount, boot.REMOVABLE_FOLDER, 'grub.cfg')), root):
        return {**state, 'state': 'stub', 'detail': f'{boot.REMOVABLE_FOLDER}/grub.cfg'}
    return {**state, 'state': 'ok'}


def removable_check(host: Host, config_storage: dict, devices: list[dict]) -> list[dict]:
    """EFI/BOOT on every mounted ESP of the layout, for StorageStatus (esp.removable)."""
    if not boot.layout_in_use(host, config_storage):
        return []
    root = root_filesystem(host, devices)
    return [removable_state(host, mount, config_storage, root)
            for mount in list(config_storage.get('espMounts') or [])[:2] if esp._mounted(host, mount)]


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

    # 2. apt keeps EFI/debian and EFI/BOOT current without touching the firmware's entries.
    values = debconf_values(host)
    if values is None:
        return done(False, 'debconf is not available', 'debconf')
    change = {question: wanted for question, wanted in DEBCONF_WANTED.items() if values.get(question) != wanted}
    if not change:
        steps.append({'step': 'debconf', 'already': True})
    else:
        steps.append({'step': 'debconf', 'was': {q: values.get(q, '') for q in change}, 'set': change})
        if not dry_run:
            tool = host.which('debconf-set-selections')
            lines = ''.join(f'{DEBCONF_PACKAGE} {q} boolean {v}\n' for q, v in change.items())
            outcome = host.run([tool], input=lines, timeout=30) if tool else None
            after = debconf_values(host) or {}
            if outcome is None or outcome.returncode != 0 or any(after.get(q) != v for q, v in change.items()):
                return done(False, 'debconf-set-selections did not take ' + ', '.join(
                    f'{q}={v}' for q, v in change.items()), 'debconf')

    # 3. Debian's own folder and the removable path on the first ESP, checked.
    root = root_filesystem(host, devices)
    debian_config = {**storage_config, 'bootLoader': boot.DEBIAN_LOADER, 'legacyBootLoaders': None}
    problem = check_debian_folder(host, main, devices)
    removable = removable_state(host, main, debian_config, root) if problem is None else None
    if problem is None and removable['state'] not in ('missing', 'differs'):
        steps.append({'step': 'grubInstall', 'already': True})
    else:
        grub_install = host.which('grub-install')
        if not grub_install:
            return done(False, 'grub-install is not installed', 'grubInstall')
        argv = [grub_install, '--target=x86_64-efi', f'--efi-directory={main}', '--bootloader-id=debian',
                '--uefi-secure-boot', '--force-extra-removable', '--no-nvram']
        steps.append({'step': 'grubInstall', 'because': problem or f"{removable['detail']} {removable['state']}",
                      'argv': argv})
        if not dry_run:
            installed = host.run(argv, timeout=600)
            log(f'boot-layout: grub-install exited {installed.returncode}')
            problem = None if installed.returncode == 0 else f'grub-install exited {installed.returncode}: ' \
                                                              f'{clip(installed.stderr, 300)}'
            problem = problem or check_debian_folder(host, main, devices)
            if problem:
                aside = _move_aside(host, main)
                return done(False, problem + (f'; moved to {aside}' if aside else ''), 'grubInstall')

    # 3b. EFI/BOOT: no shim fallback (it would write NVRAM entries), and the stub next to GRUB.
    names = boot.removable_names(boot.DEBIAN_LOADER)
    base = os.path.join(host.path(main), boot.REMOVABLE_FOLDER)
    fallback = os.path.join(base, names['fallback'])
    stub = os.path.join(base, 'grub.cfg')
    fixes = []
    if os.path.exists(fallback):
        fixes.append(f"remove {boot.REMOVABLE_FOLDER}/{names['fallback']}")
        if not dry_run:
            os.unlink(fallback)
    if check_grub_cfg(host.read(os.path.join(main, boot.REMOVABLE_FOLDER, 'grub.cfg')), root):
        fixes.append(f'write {boot.REMOVABLE_FOLDER}/grub.cfg from {DEBIAN_FOLDER}/grub.cfg')
        if not dry_run and os.path.isdir(base):
            shutil.copyfile(os.path.join(host.path(main), DEBIAN_FOLDER, 'grub.cfg'), stub)
    steps.append({'step': 'removablePath', **({'fix': fixes} if fixes else {'already': True})})
    if not dry_run:
        removable = removable_state(host, main, debian_config, root)
        if removable['state'] != 'ok':
            return done(False, f"{removable['detail']}: {removable['state']} after the install", 'removablePath')

    # 4. The same onto the second ESP (guarded, verified).
    if dry_run:
        steps.append({'step': 'copy', 'from': main, 'to': esps[1]['mount']})
    else:
        copied = esp.sync(host, config, log=log, trigger='boot-layout')
        steps.append({'step': 'copy', 'state': copied['state'], 'reason': copied.get('reason')})
        if copied['state'] != 'ok':
            return done(False, f"the ESP copy ended {copied['state']} ({copied.get('reason')})", 'copy')
        mirrored = removable_state(host, esps[1]['mount'], debian_config, root)
        if mirrored['state'] != 'ok':
            return done(False, f"{esps[1]['mount']}/{mirrored['detail']}: {mirrored['state']}", 'copy')

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
