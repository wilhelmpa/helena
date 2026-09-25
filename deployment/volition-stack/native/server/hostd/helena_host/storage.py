"""Disks and RAID: the md arrays from the kernel's own md interface (/sys/block/mdX/md, the
same one mdcheck uses), the disks from lsblk's JSON, their health from smartctl's JSON, the
two EFI system partitions (kept equal by the apt hook) and the firmware's boot entries."""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time

from .common import Host, HostError, clip

SMART_TTL = 60.0
ESP_TTL = 300.0
LSBLK_COLUMNS = 'NAME,KNAME,PATH,TYPE,SIZE,MODEL,SERIAL,PARTLABEL,LABEL,FSTYPE,MOUNTPOINTS,PKNAME,UUID,PARTUUID,ROTA,TRAN'
DISK_TYPES = {'disk'}
SYNC_ACTIONS = {'idle', 'resync', 'recover', 'check', 'repair', 'reshape', 'frozen'}
BOOT_ENTRY = re.compile(r'^Boot([0-9A-Fa-f]{4})(\*?)\s+(.*?)(?:\t(.*))?$')
PARTUUID = re.compile(r'HD\(\d+,GPT,([0-9A-Fa-f-]{36})', re.IGNORECASE)
LOADER_FILE = re.compile(r'File\(([^)]*)\)', re.IGNORECASE)

_cache_lock = threading.Lock()
_smart_cache: dict[str, tuple[float, dict]] = {}
_esp_cache: dict[str, object] = {}


# ── Arrays ───────────────────────────────────────────────────────────────────────────────

def md_names(host: Host) -> dict[str, str]:
    """kernel name → the array's name (/dev/md/<name> → ../md127)."""
    names: dict[str, str] = {}
    for name in host.listdir('/dev/md'):
        try:
            target = os.readlink(host.path(f'/dev/md/{name}'))
        except OSError:
            continue
        names[os.path.basename(target)] = name
    return names


def _progress(completed: str | None) -> tuple[int | None, int | None]:
    if not completed:
        return None, None
    match = re.match(r'^\s*(\d+)\s*/\s*(\d+)', completed)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def read_arrays(host: Host) -> list[dict]:
    names = md_names(host)
    arrays = []
    for kname in host.listdir('/sys/block'):
        if not re.match(r'^md\d+$', kname):
            continue
        base = f'/sys/block/{kname}/md'
        if not host.exists(base):
            continue
        action = (host.read(f'{base}/sync_action') or '').strip() or None
        if action not in SYNC_ACTIONS:
            action = None
        done, total = _progress(host.read(f'{base}/sync_completed'))
        speed = host.read_int(f'{base}/sync_speed')
        remaining = None
        if done is not None and total and speed:
            # sectors of 512 bytes; speed in KiB/s.
            remaining = int((total - done) * 512 / (speed * 1024))
        members = []
        for entry in host.listdir(base):
            if not entry.startswith('dev-'):
                continue
            state = (host.read(f'{base}/{entry}/state') or '').strip()
            slot = (host.read(f'{base}/{entry}/slot') or '').strip()
            members.append({
                'device': entry[4:],
                'states': [part for part in state.split(',') if part],
                'slot': int(slot) if slot.isdigit() else None,
            })
        raid_disks = host.read_int(f'{base}/raid_disks')
        degraded = host.read_int(f'{base}/degraded') or 0
        arrays.append({
            'kname': kname,
            'name': names.get(kname, kname),
            'level': (host.read(f'{base}/level') or '').strip() or None,
            'state': (host.read(f'{base}/array_state') or '').strip() or None,
            'raidDisks': raid_disks,
            'degraded': degraded,
            'syncAction': action,
            'syncPercent': round(done * 100 / total, 1) if done is not None and total else None,
            'syncSpeedKiB': speed,
            'syncRemainingSeconds': remaining,
            'mismatchCount': host.read_int(f'{base}/mismatch_cnt'),
            'members': sorted(members, key=lambda m: (m['slot'] is None, m['slot'] or 0, m['device'])),
        })
    return arrays


def array_health(array: dict) -> str:
    if array['degraded'] > 0:
        # Rebuilding onto a disk is the way out of a degraded array; until it finishes there
        # is only one copy, but nothing is to be done but wait.
        return 'attention' if array['syncAction'] in ('recover', 'resync') else 'critical'
    if array['syncAction'] in ('check', 'repair', 'resync', 'recover', 'reshape'):
        return 'attention'
    if array['mismatchCount']:
        return 'attention'
    return 'ok'


def _find_array(host: Host, name: str) -> dict:
    if not isinstance(name, str) or not re.match(r'^[A-Za-z0-9._-]{1,64}$', name):
        raise HostError('InvalidParameter', 'array is invalid', parameter='array')
    for array in read_arrays(host):
        if name in (array['kname'], array['name']):
            return array
    raise HostError('NotFound', 'no such array')


def start_check(host: Host, name: str) -> dict:
    array = _find_array(host, name)
    if array['degraded'] > 0:
        raise HostError('NotAllowed', 'a degraded array cannot be checked')
    if array['syncAction'] != 'idle':
        raise HostError('Busy', 'the array is busy', action=array['syncAction'])
    host.write_sysfs(f"/sys/block/{array['kname']}/md/sync_action", 'check')
    return {'array': array['name'], 'syncAction': 'check'}


def stop_check(host: Host, name: str) -> dict:
    array = _find_array(host, name)
    if array['syncAction'] not in ('check', 'repair'):
        # A rebuild (recover/resync) is never stopped from here.
        raise HostError('NotAllowed', 'only a check can be stopped')
    host.write_sysfs(f"/sys/block/{array['kname']}/md/sync_action", 'idle')
    return {'array': array['name'], 'syncAction': 'idle'}


# ── Disks ────────────────────────────────────────────────────────────────────────────────

def lsblk(host: Host) -> list[dict]:
    lsblk_bin = host.which('lsblk')
    if not lsblk_bin:
        return []
    result = host.run([lsblk_bin, '-J', '-b', '-o', LSBLK_COLUMNS], timeout=15)
    if result.returncode != 0:
        return []
    try:
        return json.loads(result.stdout).get('blockdevices') or []
    except ValueError:
        return []


def _walk(device: dict):
    yield device
    for child in device.get('children') or []:
        yield from _walk(child)


def parse_smart(data: dict) -> dict:
    """The facts Helena shows from `smartctl -j -a`. smartctl's exit status is a bit mask
    (smartctl(8)): bit 3 is "disk failing", bit 4/5 attributes at or past their threshold,
    bit 6/7 errors in the error or self-test log; bit 2 (a command failed) is common on
    NVMe drives without a self-test log and says nothing about the disk."""
    ctl = data.get('smartctl') or {}
    exit_status = int(ctl.get('exit_status') or 0)
    passed = (data.get('smart_status') or {}).get('passed')
    nvme = data.get('nvme_smart_health_information_log')
    facts: dict = {
        'model': data.get('model_name') or data.get('model_family'),
        'serial': data.get('serial_number'),
        'firmware': data.get('firmware_version'),
        'capacityBytes': (data.get('user_capacity') or {}).get('bytes') or data.get('nvme_total_capacity'),
        'protocol': (data.get('device') or {}).get('protocol'),
        'passed': passed if isinstance(passed, bool) else None,
        'failing': passed is False or bool(exit_status & 0x08),
        'thresholdReached': bool(exit_status & 0x30),
        'errorLogEntries': None,
        'temperatureC': (data.get('temperature') or {}).get('current'),
        'powerOnHours': (data.get('power_on_time') or {}).get('hours'),
        'powerCycles': data.get('power_cycle_count'),
        'wearPercent': None,
        'availableSpare': None,
        'availableSpareThreshold': None,
        'mediaErrors': None,
        'criticalWarning': None,
        'unsafeShutdowns': None,
        'dataWrittenBytes': None,
        'reallocatedSectors': None,
        'pendingSectors': None,
        'selfTestSupported': False,
        'selfTestRunning': None,
        'lastSelfTest': None,
    }
    if isinstance(nvme, dict):
        facts.update({
            'wearPercent': nvme.get('percentage_used'),
            'availableSpare': nvme.get('available_spare'),
            'availableSpareThreshold': nvme.get('available_spare_threshold'),
            'mediaErrors': nvme.get('media_errors'),
            'criticalWarning': nvme.get('critical_warning'),
            'unsafeShutdowns': nvme.get('unsafe_shutdowns'),
            'errorLogEntries': nvme.get('num_err_log_entries'),
            # One NVMe data unit is 1000 sectors of 512 bytes.
            'dataWrittenBytes': nvme['data_units_written'] * 512_000
            if isinstance(nvme.get('data_units_written'), int) else None,
        })
        log = data.get('nvme_self_test_log')
        if isinstance(log, dict):
            facts['selfTestSupported'] = True
            current = log.get('current_self_test_operation') or {}
            facts['selfTestRunning'] = bool(current.get('value'))
            table = log.get('table') or []
            if table:
                result = (table[0].get('self_test_result') or {}).get('string')
                facts['lastSelfTest'] = result
    attributes = ((data.get('ata_smart_attributes') or {}).get('table')) or []
    for attribute in attributes:
        raw = (attribute.get('raw') or {}).get('value')
        if attribute.get('id') == 5:
            facts['reallocatedSectors'] = raw
        elif attribute.get('id') == 197:
            facts['pendingSectors'] = raw
        elif attribute.get('id') in (177, 231, 233) and facts['wearPercent'] is None:
            value = attribute.get('value')
            if isinstance(value, int):
                facts['wearPercent'] = max(0, 100 - value)
    capabilities = (data.get('ata_smart_data') or {}).get('capabilities') or {}
    if capabilities.get('self_tests_supported'):
        facts['selfTestSupported'] = True
        status = ((data.get('ata_smart_data') or {}).get('self_test') or {}).get('status') or {}
        facts['selfTestRunning'] = status.get('remaining_percent') is not None
    return facts


def disk_health(smart: dict | None) -> str:
    if not smart:
        return 'unknown'
    if smart.get('failing') or smart.get('criticalWarning'):
        return 'critical'
    spare, threshold = smart.get('availableSpare'), smart.get('availableSpareThreshold')
    if isinstance(spare, int) and isinstance(threshold, int) and spare <= threshold:
        return 'critical'
    if smart.get('pendingSectors') or smart.get('thresholdReached'):
        return 'attention'
    if isinstance(smart.get('mediaErrors'), int) and smart['mediaErrors'] > 0:
        return 'attention'
    if isinstance(smart.get('wearPercent'), int) and smart['wearPercent'] >= 90:
        return 'attention'
    temperature = smart.get('temperatureC')
    if isinstance(temperature, (int, float)) and temperature >= 70:
        return 'attention'
    return 'ok'


def read_smart(host: Host, kname: str, *, fresh: bool = False) -> dict | None:
    smartctl = host.which('smartctl')
    if not smartctl:
        return None
    now = host.now()
    with _cache_lock:
        cached = _smart_cache.get(kname)
        if cached and not fresh and now - cached[0] < SMART_TTL:
            return cached[1]
    result = host.run([smartctl, '-j', '-a', f'/dev/{kname}'], timeout=30)
    try:
        facts = parse_smart(json.loads(result.stdout))
    except ValueError:
        facts = {'error': clip(result.stderr or result.stdout, 300)}
    with _cache_lock:
        _smart_cache[kname] = (now, facts)
    return facts


def read_disks(host: Host, config_storage: dict, arrays: list[dict],
               devices: list[dict] | None = None) -> list[dict]:
    pattern = re.compile(config_storage.get('diskLabelPattern') or r'^$')
    member_of = {member['device']: array['name'] for array in arrays for member in array['members']}
    disks = []
    for device in (lsblk(host) if devices is None else devices):
        if device.get('type') not in DISK_TYPES:
            continue
        kname = device.get('kname') or device.get('name')
        if not kname or kname.startswith(('zram', 'loop')):
            continue
        letter = None
        arrays_of = set()
        mounts = []
        partitions = []
        for part in _walk(device):
            if part is device:
                continue
            label = part.get('partlabel') or ''
            match = pattern.match(label)
            if match and letter is None:
                letter = match.group(1)
            if part.get('kname') in member_of:
                arrays_of.add(member_of[part['kname']])
            mounts.extend([m for m in (part.get('mountpoints') or []) if m])
            if part.get('type') == 'part':
                partitions.append({
                    'kname': part.get('kname'),
                    'partlabel': part.get('partlabel'),
                    'partuuid': part.get('partuuid'),
                    'fstype': part.get('fstype'),
                    'sizeBytes': part.get('size'),
                    'mountpoints': [m for m in (part.get('mountpoints') or []) if m],
                })
        smart = read_smart(host, kname)
        disks.append({
            'kname': kname,
            'letter': letter,
            'model': device.get('model'),
            'serial': device.get('serial'),
            'sizeBytes': device.get('size'),
            'transport': device.get('tran'),
            'arrays': sorted(arrays_of),
            'mountpoints': sorted(set(mounts)),
            'partitions': partitions,
            'smart': smart,
            'health': disk_health(smart if smart and 'error' not in smart else None),
        })
    disks.sort(key=lambda disk: (disk['letter'] is None, disk['letter'] or '', disk['kname']))
    return disks


def start_self_test(host: Host, disk: str) -> dict:
    if not isinstance(disk, str) or not re.match(r'^[a-z0-9]{2,32}$', disk):
        raise HostError('InvalidParameter', 'disk is invalid', parameter='disk')
    known = {device.get('kname') for device in lsblk(host) if device.get('type') in DISK_TYPES}
    if disk not in known:
        raise HostError('NotFound', 'no such disk')
    smart = read_smart(host, disk, fresh=True)
    if not smart or not smart.get('selfTestSupported'):
        raise HostError('NotSupported', 'the disk does not offer a self-test')
    if smart.get('selfTestRunning'):
        raise HostError('Busy', 'a self-test is running')
    smartctl = host.which('smartctl')
    result = host.run([smartctl, '-t', 'short', f'/dev/{disk}'], timeout=30)
    if result.returncode & 0x03:
        raise HostError('CommandFailed', 'smartctl could not start the self-test')
    return {'disk': disk, 'started': True}


# ── EFI system partitions and boot entries ─────────────────────────────────────────────

def _manifest(root: str) -> tuple[dict[str, tuple[int, int]], int]:
    files: dict[str, tuple[int, int]] = {}
    total = 0
    for directory, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for filename in sorted(filenames):
            full = os.path.join(directory, filename)
            try:
                info = os.lstat(full)
            except OSError:
                continue
            relative = os.path.relpath(full, root)
            # vfat stores times in 2-second steps; rsync -a keeps them.
            files[relative] = (info.st_size, int(info.st_mtime) // 2)
            total += info.st_size
    return files, total


def read_esps(host: Host, mounts: list[str], *, fresh: bool = False) -> dict:
    now = host.now()
    key = '|'.join(mounts)
    with _cache_lock:
        cached = _esp_cache.get(key)
        if cached and not fresh and now - cached[0] < ESP_TTL:  # type: ignore[index]
            return cached[1]  # type: ignore[index]
    findmnt = host.which('findmnt')
    entries = []
    manifests = []
    for mount in mounts:
        mounted = False
        source = None
        if findmnt:
            result = host.run([findmnt, '-J', '-n', '-o', 'TARGET,SOURCE', '--mountpoint', mount], timeout=10)
            if result.returncode == 0:
                try:
                    found = json.loads(result.stdout).get('filesystems') or []
                    mounted = bool(found)
                    source = found[0].get('source') if found else None
                except ValueError:
                    pass
        if mounted:
            files, total = _manifest(host.path(mount))
            manifests.append(files)
            digest = hashlib.sha256(json.dumps(sorted(files.items())).encode()).hexdigest()[:16]
            entries.append({'mount': mount, 'mounted': True, 'source': source,
                            'files': len(files), 'bytes': total, 'digest': digest})
        else:
            manifests.append(None)
            entries.append({'mount': mount, 'mounted': False, 'source': None,
                            'files': None, 'bytes': None, 'digest': None})
    differences: list[str] = []
    in_sync = None
    present = [m for m in manifests if m is not None]
    if len(present) >= 2:
        first = present[0]
        for other in present[1:]:
            for path in sorted(set(first) | set(other)):
                if first.get(path) != other.get(path):
                    differences.append(path)
        in_sync = not differences
    value = {'mounts': entries, 'inSync': in_sync, 'differences': differences[:10],
             'differenceCount': len(differences)}
    with _cache_lock:
        _esp_cache[key] = (now, value)
    return value


def _removable(host: Host, config_storage: dict, devices: list[dict], *, fresh: bool) -> list[dict]:
    """bootlayout.removable_check, cached like the ESP manifest (it hashes a few MB)."""
    from . import bootlayout

    now = host.now()
    key = 'removable|' + '|'.join(config_storage.get('espMounts') or [])
    with _cache_lock:
        cached = _esp_cache.get(key)
        if cached and not fresh and now - cached[0] < ESP_TTL:  # type: ignore[index]
            return cached[1]  # type: ignore[index]
    value = bootlayout.removable_check(host, config_storage, devices)
    with _cache_lock:
        _esp_cache[key] = (now, value)
    return value


def parse_efibootmgr(text: str) -> dict:
    result: dict = {'current': None, 'next': None, 'order': [], 'timeoutSeconds': None, 'entries': []}
    for line in text.splitlines():
        if line.startswith('BootCurrent:'):
            result['current'] = line.split(':', 1)[1].strip() or None
        elif line.startswith('BootNext:'):
            result['next'] = line.split(':', 1)[1].strip() or None
        elif line.startswith('BootOrder:'):
            result['order'] = [part for part in line.split(':', 1)[1].strip().split(',') if part]
        elif line.startswith('Timeout:'):
            match = re.search(r'(\d+)', line)
            result['timeoutSeconds'] = int(match.group(1)) if match else None
        else:
            match = BOOT_ENTRY.match(line.rstrip('\n'))
            if match:
                number, active, label, path = match.groups()
                uuid = PARTUUID.search(path or '')
                loader = LOADER_FILE.search(path or '')
                result['entries'].append({
                    'number': number.upper(),
                    'active': active == '*',
                    'label': label.strip(),
                    'partuuid': uuid.group(1).lower() if uuid else None,
                    # The file the entry starts (\EFI\helena-raid\shimx64.efi), or None for
                    # an entry without one: a BBS/network entry, or one the firmware rewrote
                    # to VenHw(…) when its disk was missing at boot.
                    'loader': loader.group(1) if loader else None,
                    'vendorHardware': (path or '').startswith('VenHw('),
                })
    return result


def read_boot(host: Host, disks: list[dict]) -> dict | None:
    efibootmgr = host.which('efibootmgr')
    if not efibootmgr or not host.exists('/sys/firmware/efi'):
        return None
    result = host.run([efibootmgr], timeout=15)
    if result.returncode != 0:
        return {'error': clip(result.stderr, 200)}
    boot = parse_efibootmgr(result.stdout)
    letters = {}
    for disk in disks:
        for part in disk['partitions']:
            if part.get('partuuid'):
                letters[part['partuuid'].lower()] = disk['letter'] or disk['kname']
    for entry in boot['entries']:
        entry['disk'] = letters.get(entry['partuuid']) if entry['partuuid'] else None
    return boot


def set_boot_next_reserve(host: Host, label: str) -> dict:
    efibootmgr = host.which('efibootmgr')
    if not efibootmgr:
        raise HostError('NotSupported', 'this machine has no EFI boot manager')
    boot = parse_efibootmgr(host.run([efibootmgr], timeout=15).stdout)
    matches = [entry for entry in boot['entries'] if entry['label'] == label]
    if len(matches) != 1:
        raise HostError('NotFound', 'the reserve boot entry was not found exactly once')
    number = matches[0]['number']
    result = host.run([efibootmgr, '--bootnext', number], timeout=15)
    if result.returncode != 0:
        raise HostError('CommandFailed', 'efibootmgr could not set the next boot')
    return {'next': number, 'label': label}


def clear_boot_next(host: Host) -> dict:
    efibootmgr = host.which('efibootmgr')
    if not efibootmgr:
        raise HostError('NotSupported', 'this machine has no EFI boot manager')
    boot = parse_efibootmgr(host.run([efibootmgr], timeout=15).stdout)
    if boot['next'] is None:
        return {'next': None}
    result = host.run([efibootmgr, '--delete-bootnext'], timeout=15)
    if result.returncode != 0:
        raise HostError('CommandFailed', 'efibootmgr could not clear the next boot')
    return {'next': None}


def status(host: Host, config_storage: dict, *, fresh: bool = False, state_dir: str | None = None) -> dict:
    # Imported here: boot and esp build on this module's readers.
    from . import boot as boot_entries
    from . import esp as esp_sync

    arrays = read_arrays(host)
    for array in arrays:
        array['health'] = array_health(array)
    if fresh:
        with _cache_lock:
            _smart_cache.clear()
    devices = lsblk(host)
    disks = read_disks(host, config_storage, arrays, devices)
    esp = dict(read_esps(host, list(config_storage.get('espMounts') or []), fresh=fresh))
    # The last copy onto the second ESP (after a package change): ok, skipped or failed.
    esp['sync'] = esp_sync.read_state(state_dir) if state_dir else None
    # The firmware's removable path (EFI/BOOT) against the loader folder, per ESP.
    esp['removable'] = _removable(host, config_storage, devices, fresh=fresh)
    boot = read_boot(host, disks)
    reserve = None
    if boot and 'entries' in boot:
        label = config_storage.get('reserveBootLabel')
        reserve = next((entry for entry in boot['entries'] if entry['label'] == label), None)
    return {
        'arrays': arrays,
        'disks': disks,
        'esp': esp,
        'boot': boot,
        'reserveEntry': reserve,
        # Each ESP's firmware entry judged against the partition mounted now (boot.py).
        'bootEntries': boot_entries.check(host, config_storage, boot, devices),
        'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(host.now())),
    }
