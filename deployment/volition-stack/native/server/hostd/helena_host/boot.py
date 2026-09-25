"""The firmware's boot entries of the RAID's two EFI system partitions: "Debian" starts the
shim on the first disk's ESP, "Debian (Reserve)" the same shim on the second disk's.

When a disk is missing at boot, some firmware (the AXB35's AMI BIOS among them) rewrites the
entry that pointed to it into `VenHw(…)` and never writes it back; the machine then boots from
the reserve entry and, once the disk returns, no entry points to it any more. `check()` judges
both entries against the partitions that are mounted now; `repair()` (run at every boot by
helena-boot-entries.service, and by `helena-hostd boot-repair` on the console) makes each
right: exactly one active entry per label, on its ESP's partition GUID, starting the loader.

Rules, because a mistake here can leave a machine that does not boot:
- An ESP that is not mounted, or whose disk is not on the bus, is left alone: its entry is
  neither created nor deleted (a degraded boot changes nothing).
- The right entry is created and read back before any wrong one is deleted; a wrong entry is
  only deleted when its role has a verified right one.
- Only entries with one of the two labels are ever touched, and of those never one that
  points to a partition of another disk on this machine that is not one of the two ESPs (an
  install of its own that happens to share the name); it is reported instead.
- The boot order becomes main, reserve, then the rest as it was, and only once the main
  entry is verified.
- An entry that starts a loader of the other known layout (`\\EFI\\helena-raid\\…` while
  the config names Debian's `\\EFI\\debian\\…`, or the reverse after a rollback) on the
  right ESP is the "old layout": it is moved to the configured loader once that loader is
  complete on that ESP (shim and grub.cfg), and left alone until then.
"""

from __future__ import annotations

import os
import re

from . import audit, events, storage
from .common import Host, HostError, atomic_write_json, clip, file_lock, json_load_file

ROLES = ('main', 'reserve')
# Worst first: what `check()` reports when a role has no right entry.
PROBLEMS = ('noPartuuid', 'wrongDisk', 'wrongLoader', 'inactive', 'oldLayout')
# The loaders this layout knows: Debian's own folder (apt keeps it current) and the folder
# the RAID was set up with on 2026-09-24. The config names one; the other is the old layout.
DEBIAN_LOADER = '\\EFI\\debian\\shimx64.efi'
HELENA_RAID_LOADER = '\\EFI\\helena-raid\\shimx64.efi'
KNOWN_LOADERS = (DEBIAN_LOADER, HELENA_RAID_LOADER)
KNAME = re.compile(r'^[a-z0-9]{2,32}$')
NUMBER = re.compile(r'^[0-9A-F]{4}$')


def normalize_loader(path: str | None) -> str:
    """Firmware paths compare case-insensitively (FAT), with either slash."""
    return (path or '').replace('/', '\\').lower()


def loader_relative(loader: str) -> str:
    """\\EFI\\helena-raid\\shimx64.efi → EFI/helena-raid/shimx64.efi (a path on the ESP)."""
    return loader.replace('\\', '/').lstrip('/')


# ── Where the ESPs are ───────────────────────────────────────────────────────────────────

def _walk(device: dict):
    yield device
    for child in device.get('children') or []:
        yield from _walk(child)


def present_partuuids(devices: list[dict]) -> set[str]:
    """Every partition GUID on a disk that is on the bus now."""
    found = set()
    for device in devices:
        for part in _walk(device):
            if part.get('partuuid'):
                found.add(part['partuuid'].lower())
    return found


def esp_partition(host: Host, mount: str, devices: list[dict]) -> dict | None:
    """The partition mounted at `mount`, from lsblk: so only while its disk is on the bus.
    None when nothing is mounted there, the disk is gone, or it is no GPT partition."""
    for device in devices:
        if device.get('type') != 'disk':
            continue
        for part in _walk(device):
            if part is device or part.get('type') != 'part':
                continue
            if mount not in (part.get('mountpoints') or []):
                continue
            kname = part.get('kname') or ''
            disk = device.get('kname') or ''
            number = host.read_int(f'/sys/class/block/{kname}/partition')
            if not part.get('partuuid') or number is None or not KNAME.match(kname) or not KNAME.match(disk):
                return None
            return {
                'kname': kname,
                'disk': disk,
                'partition': number,
                'partuuid': part['partuuid'].lower(),
                'fstype': part.get('fstype'),
            }
    return None


def loaders(config_storage: dict) -> tuple[str, list[str]]:
    """The configured loader and the old-layout ones (config `legacyBootLoaders`, by default
    the other known loader)."""
    current = config_storage.get('bootLoader') or DEBIAN_LOADER
    legacy = config_storage.get('legacyBootLoaders')
    if legacy is None:
        legacy = [loader for loader in KNOWN_LOADERS if normalize_loader(loader) != normalize_loader(current)]
    return current, [loader for loader in legacy if normalize_loader(loader) != normalize_loader(current)]


def loader_files(loader: str) -> list[str]:
    """What a loader needs on its ESP to start: the shim and the grub.cfg next to it (the
    stub that finds the root file system)."""
    relative = loader_relative(loader)
    return [relative, os.path.join(os.path.dirname(relative), 'grub.cfg')]


REMOVABLE_FOLDER = 'EFI/BOOT'


def removable_names(loader: str) -> dict | None:
    """The firmware's removable-media path for a shim loader (\\EFI\\debian\\shimx64.efi):
    shim as BOOTX64.EFI, grubx64.efi, mmx64.efi next to it, and the shim fallback fbx64.efi,
    which must NOT be there (shim would run it and write NVRAM entries of its own). None for
    a loader that is not a shim."""
    match = re.match(r'^shim(\w+)\.efi$', os.path.basename(loader_relative(loader)), re.IGNORECASE)
    if not match:
        return None
    arch = match.group(1).lower()
    return {'shim': f'BOOT{arch.upper()}.EFI', 'grub': f'grub{arch}.efi', 'mm': f'mm{arch}.efi',
            'fallback': f'fb{arch}.efi'}


def loader_complete(host: Host, mount: str, loader: str) -> bool:
    try:
        return all(os.path.getsize(os.path.join(host.path(mount), relative)) > 0
                   for relative in loader_files(loader))
    except OSError:
        return False


def _fstab_mounts(host: Host) -> set[str]:
    mounts = set()
    for line in (host.read('/etc/fstab') or '').splitlines():
        fields = line.split()
        if len(fields) >= 2 and not fields[0].startswith('#'):
            mounts.add(fields[1])
    return mounts


def layout_in_use(host: Host, config_storage: dict) -> bool:
    """Whether this machine boots the mirrored way at all: both ESP mounts are in /etc/fstab
    and one of them holds a known loader's folder. A machine with another layout (one ESP
    with Debian's usual entry) gets no boot entry lines, no repair and no ESP copy."""
    mounts = list(config_storage.get('espMounts') or [])[:2]
    if len(mounts) < 2 or not set(mounts) <= _fstab_mounts(host):
        return False
    current, legacy = loaders(config_storage)
    folders = {os.path.dirname(loader_relative(loader)) for loader in (current, *legacy)}
    return any(os.path.isdir(os.path.join(host.path(mount), folder)) for mount in mounts for folder in folders)


def layout(host: Host, config_storage: dict, devices: list[dict]) -> list[dict]:
    """The roles of this machine: which label belongs to which mount, where that mount's
    partition is now (None when it is not there), and which loaders are complete on it."""
    mounts = list(config_storage.get('espMounts') or [])[:2]
    labels = [config_storage.get('mainBootLabel') or 'Debian',
              config_storage.get('reserveBootLabel') or 'Debian (Reserve)']
    current, legacy = loaders(config_storage)
    roles = []
    for index, mount in enumerate(mounts):
        esp = esp_partition(host, mount, devices)
        roles.append({
            'role': ROLES[index],
            'label': labels[index],
            'mount': mount,
            'esp': esp,
            'loaderPresent': esp is not None and loader_complete(host, mount, current),
            'legacyPresent': {normalize_loader(loader) for loader in legacy
                              if esp is not None and loader_complete(host, mount, loader)},
        })
    return roles


# ── Judging the entries ──────────────────────────────────────────────────────────────────

def classify(entry: dict, esp: dict, loader: str, others: set[str], legacy: tuple[str, ...] = ()) -> str:
    """One entry against the ESP its label belongs to. `others`: partition GUIDs on this
    machine that are not one of the ESPs (an entry there is someone else's). `legacy`: the
    old layout's loaders (an entry starting one of them is `oldLayout`)."""
    if not entry.get('partuuid'):
        return 'noPartuuid'
    if entry['partuuid'] != esp['partuuid']:
        return 'foreign' if entry['partuuid'] in others else 'wrongDisk'
    started = normalize_loader(entry.get('loader'))
    if started != normalize_loader(loader):
        return 'oldLayout' if started in {normalize_loader(item) for item in legacy} else 'wrongLoader'
    if not entry.get('active'):
        return 'inactive'
    return 'ok'


def _rank(entries: list[dict], order: list[str]) -> list[dict]:
    position = {number: index for index, number in enumerate(order)}
    return sorted(entries, key=lambda entry: (position.get(entry['number'], len(order)), entry['number']))


def plan(boot: dict, roles: list[dict], loader: str, present: set[str], legacy: tuple[str, ...] = ()) -> dict:
    """What `repair()` would do: per role its state and the entry it keeps, and the actions
    (create, activate, delete, order) in the order they run."""
    ours = {role['esp']['partuuid'] for role in roles if role['esp']}
    others = present - ours
    order = list(boot.get('order') or [])
    checks: list[dict] = []
    actions: list[dict] = []
    for role in roles:
        same = [entry for entry in boot['entries'] if entry['label'] == role['label']]
        esp = role['esp']
        check = {
            'role': role['role'],
            'label': role['label'],
            'mount': role['mount'],
            'espPresent': esp is not None,
            'partuuid': esp['partuuid'] if esp else None,
            'number': None,
            'state': 'missing',
            'entries': [entry['number'] for entry in same],
            'foreign': [],
        }
        checks.append(check)
        if esp is None:
            # Nothing to compare with: judge the entries alone and change nothing.
            usable = [entry for entry in same if entry.get('partuuid') and entry.get('active')
                      and normalize_loader(entry.get('loader')) == normalize_loader(loader)]
            if usable:
                check.update(state='unchecked', number=_rank(usable, order)[0]['number'])
            elif same:
                check.update(state='noPartuuid' if all(not e.get('partuuid') for e in same) else 'unchecked',
                             number=_rank(same, order)[0]['number'])
            continue
        states = {entry['number']: classify(entry, esp, loader, others, legacy) for entry in same}
        if not role['loaderPresent']:
            # An entry for a loader that is not on the ESP would not start: never create one.
            # An old-layout entry whose loader is still complete there keeps working: leave it.
            old = [entry for entry in same if states[entry['number']] == 'oldLayout' and entry.get('active')
                   and normalize_loader(entry.get('loader')) in role.get('legacyPresent', set())]
            if old:
                check.update(state='oldLayout', number=_rank(old, order)[0]['number'])
            else:
                check['state'] = 'loaderMissing'
                if same:
                    check['number'] = _rank(same, order)[0]['number']
            continue
        good = [entry for entry in same if states[entry['number']] == 'ok']
        inactive = [entry for entry in same if states[entry['number']] == 'inactive']
        keep = (_rank(good, order) or _rank(inactive, order) or [None])[0]
        wrong = [entry for entry in same
                 if entry is not keep and states[entry['number']] != 'foreign']
        check['foreign'] = [entry['number'] for entry in same if states[entry['number']] == 'foreign']
        if keep is None:
            problems = [states[entry['number']] for entry in wrong]
            check['state'] = next((p for p in PROBLEMS if p in problems), 'missing')
            actions.append({'op': 'create', 'role': role['role'], 'label': role['label'],
                            'disk': esp['disk'], 'partition': esp['partition'], 'partuuid': esp['partuuid']})
        elif states[keep['number']] == 'inactive':
            check.update(state='inactive', number=keep['number'])
            actions.append({'op': 'activate', 'role': role['role'], 'number': keep['number']})
        else:
            check.update(state='duplicate' if wrong else 'ok', number=keep['number'])
        for entry in wrong:
            reason = states[entry['number']]
            actions.append({'op': 'delete', 'role': role['role'], 'number': entry['number'],
                            'reason': 'duplicate' if reason in ('ok', 'inactive') else reason})
    return {'roles': checks, 'actions': actions}


def desired_order(order: list[str], numbers: list[str], existing: set[str]) -> list[str]:
    """main, reserve, then the rest as it was (without entries that no longer exist)."""
    front = [number for number in numbers if number in existing]
    rest = [number for number in order if number not in front and number in existing]
    return front + rest


def check(host: Host, config_storage: dict, boot: dict | None, devices: list[dict]) -> list[dict]:
    """The state of both entries for StorageStatus (bootEntries): ok, missing, noPartuuid
    (the firmware rewrote it), wrongDisk, wrongLoader, inactive, duplicate, loaderMissing, or
    unchecked (its ESP is not there to compare with)."""
    if not boot or 'entries' not in boot or not layout_in_use(host, config_storage):
        return []
    roles = layout(host, config_storage, devices)
    loader, legacy = loaders(config_storage)
    return plan(boot, roles, loader, present_partuuids(devices), tuple(legacy))['roles']


# ── Repairing them ───────────────────────────────────────────────────────────────────────

def _read(host: Host, efibootmgr: str) -> dict:
    result = host.run([efibootmgr], timeout=15)
    if result.returncode != 0:
        raise HostError('CommandFailed', 'efibootmgr could not read the boot entries')
    return storage.parse_efibootmgr(result.stdout)


def repair(host: Host, config, *, dry_run: bool = False, log=lambda message: None,
           actor: str = 'boot-repair') -> dict:
    """Makes both entries right (see the module's rules). Returns the plan with the outcome
    of each action; `ok` is False when an action failed."""
    efibootmgr = host.which('efibootmgr')
    if not efibootmgr or not host.exists('/sys/firmware/efi'):
        raise HostError('NotSupported', 'this machine has no EFI boot manager')
    config_storage = config.storage
    loader, legacy = loaders(config_storage)
    if not layout_in_use(host, config_storage):
        return {'dryRun': dry_run, 'roles': [], 'actions': [], 'changed': False, 'ok': True,
                'reason': 'notInUse'}
    with file_lock(os.path.join(config.state_dir, 'boot.lock')):
        before = _read(host, efibootmgr)
        # The AXB35's firmware rewrites BootOrder at every boot (it put its own "UEFI OS"
        # removable-path entry first): keep a trace of what it left, to see the pattern.
        log(f"boot-repair: firmware order was {','.join(before['order']) or '-'}; "
            f"booted {before['current'] or '?'}")
        devices = storage.lsblk(host)
        roles = layout(host, config_storage, devices)
        present = present_partuuids(devices)
        planned = plan(before, roles, loader, present, tuple(legacy))
        result = {'dryRun': dry_run, 'roles': planned['roles'], 'actions': [], 'changed': False, 'ok': True,
                  'bootCurrent': before['current'], 'firmwareOrder': list(before['order'])}
        by_role = {check['role']: check for check in planned['roles']}
        esp_of = {role['role']: role['esp'] for role in roles}
        if dry_run:
            actions = list(planned['actions'])
            main = by_role.get('main')
            if main and (main['state'] in ('ok', 'duplicate', 'inactive', 'oldLayout') or _creates(actions, 'main')):
                deleted = {action['number'] for action in actions if action['op'] == 'delete'}
                existing = ({entry['number'] for entry in before['entries']} | {'new'}) - deleted
                order = desired_order(before['order'], _front(by_role, actions), existing)
                if order != before['order']:
                    actions.append({'op': 'order', 'order': order})
            result['actions'] = actions
            return result

        # A kept old-layout entry starts fine: it may lead the order like a right one.
        verified: set[str] = {role for role, check in by_role.items()
                              if check['state'] in ('ok', 'duplicate', 'oldLayout')}
        done: list[dict] = []

        def run(argv: list[str], action: dict) -> bool:
            outcome = host.run([efibootmgr, *argv], timeout=30)
            action = {**action, 'ok': outcome.returncode == 0}
            if outcome.returncode != 0:
                action['error'] = clip(outcome.stderr or outcome.stdout, 200)
                result['ok'] = False
            else:
                result['changed'] = True
            done.append(action)
            log(f"boot-repair: {action['op']} {action.get('number') or action.get('label')}: "
                f"{'ok' if action['ok'] else action.get('error')}")
            return action['ok']

        # 1. Create or activate the right entry of each role, and read it back.
        for action in planned['actions']:
            role = action.get('role')
            if action['op'] == 'create':
                if not KNAME.match(action['disk']) or not 1 <= int(action['partition']) <= 128:
                    raise HostError('Internal', 'unexpected partition')
                known = {entry['number'] for entry in _read(host, efibootmgr)['entries']}
                if not run(['--create', '--disk', f"/dev/{action['disk']}", '--part', str(action['partition']),
                            '--label', action['label'], '--loader', loader], action):
                    continue
                after = _read(host, efibootmgr)
                new = [entry for entry in after['entries']
                       if entry['number'] not in known and entry['label'] == action['label']
                       and classify(entry, esp_of[role], loader, set()) == 'ok']
                if not new:
                    done[-1].update(ok=False, error='the new entry could not be read back')
                    result['ok'] = False
                    continue
                by_role[role]['number'] = new[0]['number']
                by_role[role]['state'] = 'ok'
                done[-1]['number'] = new[0]['number']
                verified.add(role)
            elif action['op'] == 'activate':
                if run(['--bootnum', action['number'], '--active'], action):
                    after = _read(host, efibootmgr)
                    entry = next((e for e in after['entries'] if e['number'] == action['number']), None)
                    if entry and classify(entry, esp_of[role], loader, set()) == 'ok':
                        by_role[role]['state'] = 'ok'
                        verified.add(role)

        # 2. Delete what is wrong, only where the role's right entry is verified.
        for action in planned['actions']:
            if action['op'] != 'delete' or action['role'] not in verified:
                continue
            if not NUMBER.match(action['number']) or action['number'] == by_role[action['role']]['number']:
                continue
            if run(['--bootnum', action['number'], '--delete-bootnum'], action):
                by_role[action['role']]['entries'] = [
                    n for n in by_role[action['role']]['entries'] if n != action['number']]
                if by_role[action['role']]['state'] == 'duplicate':
                    by_role[action['role']]['state'] = 'ok'

        # 3. The order: main, reserve, the rest — once the main entry is verified.
        if 'main' in verified:
            current = _read(host, efibootmgr)
            front = [by_role[role]['number'] for role in ROLES if role in verified and by_role[role]['number']]
            order = desired_order(current['order'], front, {entry['number'] for entry in current['entries']})
            if order and order != current['order']:
                run(['--bootorder', ','.join(order)], {'op': 'order', 'order': order})

        result['actions'] = done
        final = _read(host, efibootmgr) if done else before
        result['order'] = list(final['order'])
        _remember(config.state_dir, {
            'at': audit.now_iso(host), 'actor': actor, 'bootCurrent': before['current'],
            'firmwareOrder': list(before['order']), 'order': list(final['order']),
            'changed': bool(done),
        })
        if done:
            summary = '; '.join(_describe(action) for action in done)
            audit.append(config.state_dir, {
                'at': audit.now_iso(host), 'caller': 'root', 'actor': actor, 'method': 'BootRepair',
                'params': {}, 'ok': result['ok'], 'actions': done,
            }, log)
            # Moving entries from the old layout to the configured loader is expected (after
            # the layout change, or apt's first grub-install): news, not a warning.
            deletes = [action for action in done if action['op'] == 'delete']
            moved = bool(deletes) and all(action['reason'] == 'oldLayout' for action in deletes)
            if not result['ok']:
                severity, code = 'critical', 'BootEntryRepairFailed'
            elif moved:
                severity, code = 'info', 'BootEntriesMoved'
            else:
                severity, code = 'warning', 'BootEntryRepaired'
            events.record(config.state_dir, source='boot', severity=severity, code=code,
                          device=', '.join(sorted({by_role[a['role']]['label'] for a in done if a.get('role')})) or None,
                          message=summary, at=host.now())
        return result


HISTORY = 'boot-history.json'
HISTORY_KEEP = 100


def history(state_dir: str) -> list[dict]:
    """The boot orders the firmware left, newest last (one line per repair run)."""
    data = json_load_file(os.path.join(state_dir, HISTORY), [])
    return data if isinstance(data, list) else []


def _remember(state_dir: str, entry: dict) -> None:
    os.makedirs(state_dir, mode=0o700, exist_ok=True)
    atomic_write_json(os.path.join(state_dir, HISTORY), (history(state_dir) + [entry])[-HISTORY_KEEP:])


def _creates(actions: list[dict], role: str) -> bool:
    return any(action['op'] == 'create' and action['role'] == role for action in actions)


def _front(by_role: dict, actions: list[dict]) -> list[str]:
    """For a dry run: the numbers that would lead the order ("new" for one to be created)."""
    front = []
    for role in ROLES:
        check = by_role.get(role)
        if not check:
            continue
        if _creates(actions, role):
            front.append('new')
        elif check['state'] in ('ok', 'duplicate', 'inactive', 'oldLayout') and check['number']:
            front.append(check['number'])
    return front


def _describe(action: dict) -> str:
    what = {
        'create': lambda a: f"created Boot{a.get('number') or '?'} {a['label']} on {a['disk']} partition {a['partition']}",
        'activate': lambda a: f"activated Boot{a['number']}",
        'delete': lambda a: f"removed Boot{a['number']} ({a['reason']})",
        'order': lambda a: f"boot order {','.join(a['order'])}",
    }[action['op']](action)
    return what if action.get('ok') else f"{what} failed"
