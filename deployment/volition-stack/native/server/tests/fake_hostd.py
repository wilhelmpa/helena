#!/usr/bin/env python3
"""A fake helena-hostd for a dev stack and the headless UI check: the same Varlink interface,
canned readings of a Strix Halo with a RAID 1 rebuilding onto its second disk, the EC fans,
a restic repository with snapshots, and changes kept in memory. It touches nothing on the
machine. Run as any user:

    python3 fake_hostd.py /path/to/hostd.sock

and start the API with HELENA_HOSTD_SOCKET=/path/to/hostd.sock. HELENA_FAKE_INCIDENT=1 shows the
state after the 2026-09-25 incident instead: the "Debian" entry rewritten to VenHw(…) and the
ESP copy skipped while the first disk was away.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'hostd'))

from helena_host import storage  # noqa: E402
from helena_host.service import DESCRIPTION, INTERFACE  # noqa: E402
from helena_host.varlink import Server, VarlinkError  # noqa: E402

FIXTURES = os.path.join(HERE, 'fixtures')
NOW = time.time


def iso(offset: float = 0) -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(NOW() + offset))


class Fake:
    def __init__(self):
        self.lock = threading.Lock()
        self.started = NOW()
        self.fans = {'mode': 'fixed', 'level': 5}
        self.profile = 'balanced'
        self.guard = {'limit': 90, 'holdSeconds': 5, 'releaseBelow': 80, 'releaseSeconds': 120}
        self.password_ack = False
        self.check_running = False
        self.boot_next = None
        self.schedule = {'frequency': 'hourly', 'time': '03:15'}
        self.retention = {'hourly': 24, 'daily': 7, 'weekly': 4, 'monthly': 12}
        self.check_weekly = True
        self.restore_test = True
        self.restores: dict[str, dict] = {}
        self.targets: list[dict] = []
        self.events = [
            {'id': 1, 'at': iso(-7200), 'source': 'mdadm', 'severity': 'critical', 'code': 'DegradedArray',
             'device': '/dev/md/helena-root', 'message': None},
            {'id': 2, 'at': iso(-7100), 'source': 'mdadm', 'severity': 'info', 'code': 'RebuildStarted',
             'device': '/dev/md/helena-root', 'message': '/dev/nvme0n1p2'},
            {'id': 3, 'at': iso(-600), 'source': 'mdadm', 'severity': 'info', 'code': 'Rebuild40',
             'device': '/dev/md/helena-root', 'message': None},
        ]
        self.seen = 0
        self.owner_sudo = True

    # ── Storage ────────────────────────────────────────────────────────────────────────
    def storage(self) -> dict:
        blk = json.load(open(os.path.join(FIXTURES, 'lsblk.json')))['blockdevices']
        smart = storage.parse_smart(json.load(open(os.path.join(FIXTURES, 'smart-nvme-samsung.json'))))
        elapsed = NOW() - self.started
        percent = min(100.0, 26.5 + elapsed / 30)
        rebuilding = percent < 100
        action = 'check' if self.check_running else ('recover' if rebuilding else 'idle')
        arrays = [{
            'kname': 'md127', 'name': 'helena-root', 'level': 'raid1', 'state': 'clean', 'raidDisks': 2,
            'degraded': 1 if rebuilding else 0, 'syncAction': action,
            'syncPercent': round(percent, 1) if action != 'idle' else None,
            'syncSpeedKiB': 162076 if action != 'idle' else None,
            'syncRemainingSeconds': int((100 - percent) * 88) if action != 'idle' else None,
            'mismatchCount': 0,
            'members': [{'device': 'nvme1n1p2', 'states': ['in_sync'], 'slot': 0},
                        {'device': 'nvme0n1p2', 'states': ['spare'] if rebuilding else ['in_sync'],
                         'slot': None if rebuilding else 1}],
        }]
        for array in arrays:
            array['health'] = storage.array_health(array)
        disks = []
        for device in blk:
            letter = None
            partitions = []
            mounts = []
            for part in device.get('children') or []:
                label = part.get('partlabel') or ''
                if label.startswith('HELENA-') and letter is None:
                    letter = label[-1]
                partitions.append({'kname': part['kname'], 'partlabel': part.get('partlabel'),
                                   'partuuid': part.get('partuuid'), 'fstype': part.get('fstype'),
                                   'sizeBytes': part.get('size'),
                                   'mountpoints': [m for m in part.get('mountpoints') or [] if m]})
                mounts += [m for m in part.get('mountpoints') or [] if m]
                for child in part.get('children') or []:
                    mounts += [m for m in child.get('mountpoints') or [] if m]
            facts = dict(smart)
            if letter == 'B':
                facts.update(model=device.get('model'), temperatureC=56, wearPercent=3, powerOnHours=930)
            disks.append({'kname': device['kname'], 'letter': letter, 'model': device.get('model'),
                          'serial': device.get('serial'), 'sizeBytes': device.get('size'), 'transport': 'nvme',
                          'arrays': ['helena-root'], 'mountpoints': sorted(set(mounts)), 'partitions': partitions,
                          'smart': facts, 'health': storage.disk_health(facts)})
        disks.sort(key=lambda d: d['letter'] or '')
        incident = os.environ.get('HELENA_FAKE_INCIDENT') == '1'
        boot = storage.parse_efibootmgr(open(os.path.join(
            FIXTURES, 'efibootmgr-venhw.txt' if incident else 'efibootmgr.txt')).read())
        boot['current'] = '001A' if incident else '000F'
        boot['next'] = self.boot_next
        for entry in boot['entries']:
            entry['disk'] = None if not entry['partuuid'] else ('A' if entry['label'] == 'Debian' else 'B')
        if incident:
            # The first disk is off the bus: not listed, its ESP not mounted.
            disks = [disk for disk in disks if disk['letter'] != 'A']
        checks = [
            {'role': 'main', 'label': 'Debian', 'mount': '/boot/efi', 'espPresent': not incident,
             'partuuid': '2a7ccb77-d727-4df5-aa1a-e619e847d2e8', 'number': '000F',
             'state': 'noPartuuid' if incident else 'ok', 'entries': ['000F'], 'foreign': []},
            {'role': 'reserve', 'label': 'Debian (Reserve)', 'mount': '/boot/efi2', 'espPresent': True,
             'partuuid': '9da3b062-2afc-42d2-9cbb-6c9128eae4a9', 'number': '001A', 'state': 'ok',
             'entries': ['001A'], 'foreign': []},
        ]
        sync = ({'state': 'skipped', 'reason': 'notMounted', 'at': iso(-5400), 'mount': '/boot/efi',
                 'pending': True, 'syncedAt': iso(-86400), 'detail': None} if incident else
                {'state': 'ok', 'reason': None, 'at': iso(-86400), 'mount': '/boot/efi2', 'pending': False,
                 'syncedAt': iso(-86400), 'detail': None})
        return {
            'arrays': arrays, 'disks': disks,
            'esp': {'mounts': [
                {'mount': '/boot/efi', 'mounted': not incident, 'source': None if incident else '/dev/nvme1n1p1',
                 'files': None if incident else 14, 'bytes': None if incident else 9437184,
                 'digest': None if incident else 'a1'},
                {'mount': '/boot/efi2', 'mounted': True, 'source': '/dev/nvme0n1p1', 'files': 14, 'bytes': 9437184, 'digest': 'a1'},
            ], 'inSync': None if incident else True, 'differences': [], 'differenceCount': 0, 'sync': sync,
                'removable': [{'mount': '/boot/efi2', 'state': 'differs' if incident else 'ok',
                               'detail': 'EFI/BOOT/grubx64.efi' if incident else None}]},
            'boot': boot, 'reserveEntry': next(e for e in boot['entries'] if e['label'] == 'Debian (Reserve)'),
            'bootEntries': checks,
            'checkedAt': iso(),
        }

    # ── Power ──────────────────────────────────────────────────────────────────────────
    def power(self) -> dict:
        level = self.fans.get('level') if self.fans['mode'] == 'fixed' else None
        rpm = {None: 2100, 1: 1200, 2: 2000, 3: 2800, 4: 3700, 5: 4700}
        ec_mode = {'saver': 'quiet', 'balanced': 'balanced', 'performance': 'performance'}[self.profile]
        ppd = {'saver': 'power-saver', 'balanced': 'balanced', 'performance': 'performance'}[self.profile]
        limits = {'quiet': (54, 100, 54), 'balanced': (85, 120, 120), 'performance': (120, 140, 120)}
        stapm, fast, slow = limits[ec_mode]
        return {
            'available': {'ec': True, 'os': True, 'ryzenadj': True, 'smuDriver': True},
            'board': 'AXB35-02', 'profile': self.profile,
            'desired': {'profile': self.profile, 'fans': self.fans},
            'ec': {'powerMode': ec_mode, 'temperatureC': 52, 'temperatureMaxC': 71, 'fans': [
                {'id': 'fan1', 'role': 'cpu', 'rpm': rpm[level], 'mode': self.fans['mode'], 'level': level or 2},
                {'id': 'fan2', 'role': 'cpu', 'rpm': rpm[level] - 50, 'mode': self.fans['mode'], 'level': level or 2},
                {'id': 'fan3', 'role': 'system', 'rpm': int(rpm[level] * 0.7), 'mode': self.fans['mode'], 'level': level or 2},
            ]},
            'fans': {'mode': self.fans['mode'], 'level': level},
            'os': {'profile': ppd},
            'cpu': {'driver': 'amd-pstate-epp', 'governor': 'powersave',
                    'epp': {'power-saver': 'power', 'balanced': 'balance_performance', 'performance': 'performance'}[ppd]},
            'ryzenadj': {'available': True, 'family': 'Strix Halo', 'stapmLimitW': stapm, 'stapmValueW': 18.4,
                         'fastLimitW': fast, 'fastValueW': 22.1, 'slowLimitW': slow, 'slowValueW': 19.0,
                         'tctlLimitC': 100.0, 'tctlValueC': 57.5},
            'profiles': {name: {'ec': ec, 'os': os_, 'ecLimitsW': dict(zip(('stapm', 'fast', 'slow'), limits[ec])),
                                'override': None}
                         for name, ec, os_ in (('saver', 'quiet', 'power-saver'), ('balanced', 'balanced', 'balanced'),
                                               ('performance', 'performance', 'performance'))},
            'temperatures': [
                {'sensor': 'acpitz', 'id': 'hwmon0/temp1', 'label': None, 'celsius': 73.0},
                {'sensor': 'nvme', 'id': 'hwmon1/temp1', 'label': 'Composite', 'celsius': 48.9, 'disk': 'nvme1n1'},
                {'sensor': 'nvme', 'id': 'hwmon2/temp1', 'label': 'Composite', 'celsius': 53.9, 'disk': 'nvme0n1'},
                {'sensor': 'k10temp', 'id': 'hwmon3/temp1', 'label': 'Tctl', 'celsius': 57.5},
                {'sensor': 'amdgpu', 'id': 'hwmon5/temp1', 'label': 'edge', 'celsius': 40.0},
                {'sensor': 'amdgpu', 'id': 'hwmon5/power1', 'label': 'PPT', 'watts': 23.0},
            ],
            'cpuTemperatureC': 57.5,
            'guard': {**self.guard, 'state': {'active': False, 'available': True, 'updatedAt': iso()}},
        }

    # ── Backup ─────────────────────────────────────────────────────────────────────────
    def snapshots(self) -> list[dict]:
        out = []
        for index in range(8):
            out.append({'id': f'{index:02d}ab34cd' + 'e' * 56, 'shortId': f'{index:02d}ab34cd', 'time': iso(-3600 * index - 900),
                        'hostname': 'kingston-server', 'paths': ['/etc', '/home/wilhelmpa'], 'tags': ['helena'],
                        'filesTotal': 412000, 'bytesTotal': 96_000_000_000, 'dataAddedBytes': 180_000_000 + index * 1_000_000})
        return out

    def backup(self) -> dict:
        return {
            'installed': True, 'initialized': True, 'repository': '/var/backups/helena/restic',
            'passwordState': 'acknowledged' if self.password_ack else 'unrevealed',
            'schedule': self.schedule, 'retention': self.retention, 'checkWeekly': self.check_weekly,
            'restoreTestMonthly': self.restore_test,
            'running': {'backup': False, 'maintenance': False, 'restore-test': False},
            'next': {'backup': iso(1800), 'maintenance': iso(4 * 86400), 'restore-test': iso(12 * 86400)},
            'last': {
                'backup': {'ok': True, 'startedAt': iso(-1000), 'finishedAt': iso(-900), 'snapshot': '00ab34cd' + 'e' * 56,
                           'filesTotal': 412000, 'bytesTotal': 96_000_000_000, 'dataAddedBytes': 180_000_000,
                           'repositoryBytes': 71_000_000_000, 'durationSeconds': 100},
                'maintenance': {'ok': True, 'finishedAt': iso(-3 * 86400)},
                'restore-test': {'ok': True, 'finishedAt': iso(-20 * 86400), 'files': 20, 'filesRestored': 20,
                                 'database': {'name': 'itsaplan', 'tables': 214, 'bytes': 104_000_000}},
            },
            'targets': self.targets, 'ownerHome': '/home/wilhelmpa',
            'paths': ['/etc', '/root', '/srv/volition', '/var/lib/volition', '/var/lib/helena', '/usr/local',
                      '/boot/efi', '/home/wilhelmpa'],
            'history': [], 'restores': sorted(self.restores.values(), key=lambda job: job['createdAt'], reverse=True),
        }

    def listing(self, params: dict) -> dict:
        path = params['path'].rstrip('/') or '/'
        tree = {
            '/': ['etc', 'home', 'srv', 'var'],
            '/home': ['wilhelmpa'],
            '/home/wilhelmpa': ['KI-Verläufe', 'Projekte', 'Videos', 'volition', 'notizen.md'],
            '/home/wilhelmpa/Projekte': ['Linux', 'homepage', 'm5-control', 'README.md'],
        }
        names = tree.get(path)
        if names is None:
            return {'snapshot': params['snapshot'], 'path': path, 'entries': [], 'truncated': False}
        entries = []
        for name in names:
            full = (path if path != '/' else '') + '/' + name
            is_file = '.' in name
            entries.append({'name': name, 'path': full, 'type': 'file' if is_file else 'dir',
                            'size': 2048 if is_file else None, 'mtime': iso(-86400)})
        entries.sort(key=lambda e: (e['type'] != 'dir', e['name'].lower()))
        return {'snapshot': params['snapshot'], 'path': path, 'entries': entries, 'truncated': False}

    def restore(self, params: dict) -> dict:
        if params.get('mode') == 'original' and params.get('confirm') != params['path']:
            raise VarlinkError(f'{INTERFACE}.NotAllowed', {'message': 'restoring in place needs the path confirmed'})
        restore_id = time.strftime('%Y%m%d%H%M%S', time.gmtime()) + '-' + os.urandom(3).hex()
        home = params['path'].startswith('/home/wilhelmpa')
        stamp = time.strftime('%Y-%m-%d_%H-%M-%S')
        job = {'id': restore_id, 'snapshot': params['snapshot'], 'path': params['path'], 'mode': params.get('mode', 'copy'),
               'state': 'running', 'createdAt': iso(), 'startedAt': iso(), 'actor': params.get('actor'),
               'location': (f'/home/wilhelmpa/Wiederhergestellt/{stamp}' if home else f'/var/backups/helena/restores/{stamp}')
               + params['path'] if params.get('mode', 'copy') == 'copy' else params['path'],
               'movedAside': f"{params['path']}.vor-wiederherstellung-{stamp}" if params.get('mode') == 'original' else None}
        self.restores[restore_id] = job

        def finish():
            time.sleep(3)
            job.update(state='done', finishedAt=iso())
        threading.Thread(target=finish, daemon=True).start()
        return job

    # ── Dispatch ───────────────────────────────────────────────────────────────────────
    def __call__(self, name: str, params: dict, caller: dict) -> dict:
        with self.lock:
            return {'result': self.handle(name, params)}

    def handle(self, name: str, params: dict):
        if name == 'Capabilities':
            return {'version': 'fake', 'system': True, 'storage': {'raid': True, 'smart': True, 'efi': True},
                    'backup': {'installed': True, 'initialized': True}, 'power': {'ec': True, 'os': True, 'ryzenadj': True}}
        if name == 'SystemStatus':
            return {'hostname': 'kingston-server', 'kernel': '6.12.107+deb13-amd64', 'boardVendor': 'Bosgame',
                    'boardName': 'AXB35-02', 'productName': 'BeyondMax Series',
                    'cpuModel': 'AMD RYZEN AI MAX+ 395 w/ Radeon 8060S', 'cpuCount': 32,
                    'uptimeSeconds': int(NOW() - self.started) + 7200, 'load': [2.1, 2.9, 3.0],
                    'memory': {'totalBytes': 33277624320, 'availableBytes': 22139301888, 'swapTotalBytes': 8589930496,
                               'swapFreeBytes': 8521773056, 'pressure': {'some': {'avg10': 0.0, 'avg60': 0.0}},
                               'underPressure': False},
                    'gpuMemory': {'vramTotalBytes': 103079215104, 'vramUsedBytes': 154816512,
                                  'gttTotalBytes': 16638812160, 'gttUsedBytes': 14757888}, 'efi': True}
        if name == 'StorageStatus':
            return self.storage()
        if name == 'Events':
            seen = self.seen
            return {'events': list(reversed(self.events)), 'seenUpTo': seen,
                    'unseen': sum(1 for e in self.events if e['id'] > seen),
                    'unseenCritical': sum(1 for e in self.events if e['id'] > seen and e['severity'] == 'critical')}
        if name == 'MarkEventsSeen':
            self.seen = max(self.seen, params['upTo'])
            return {'seenUpTo': self.seen}
        if name == 'StartRaidCheck':
            self.check_running = True
            return {'array': 'helena-root', 'syncAction': 'check'}
        if name == 'StopRaidCheck':
            self.check_running = False
            return {'array': 'helena-root', 'syncAction': 'idle'}
        if name == 'SetBootNextReserve':
            self.boot_next = '001A'
            return {'next': '001A', 'label': 'Debian (Reserve)'}
        if name == 'ClearBootNext':
            self.boot_next = None
            return {'next': None}
        if name == 'StartSelfTest':
            raise VarlinkError(f'{INTERFACE}.NotSupported', {'message': 'the disk does not offer a self-test'})
        if name == 'PowerStatus':
            return self.power()
        if name == 'SetPowerProfile':
            self.profile = params['profile']
            return {'profile': self.profile, 'layers': {'ec': {'ok': True}, 'os': {'ok': True}}}
        if name == 'SetFans':
            self.fans = {'mode': params['mode'], 'level': params.get('level')}
            return {**self.fans, 'applied': True, 'guardActive': False}
        if name == 'SetGuard':
            self.guard['limit'] = params['limit']
            return self.guard
        if name == 'OwnerSudoStatus':
            return {'enabled': self.owner_sudo}
        if name == 'SetOwnerSudo':
            self.owner_sudo = params['enabled']
            return {'enabled': self.owner_sudo}
        if name == 'BackupStatus':
            return self.backup()
        if name == 'BackupSnapshots':
            return {'snapshots': self.snapshots()}
        if name == 'BackupList':
            return self.listing(params)
        if name == 'RunBackup':
            return {'kind': params['kind'], 'started': True}
        if name == 'SetBackupSettings':
            self.schedule = params.get('schedule', self.schedule)
            self.retention = params.get('retention', self.retention)
            self.check_weekly = params.get('checkWeekly', self.check_weekly)
            self.restore_test = params.get('restoreTestMonthly', self.restore_test)
            return {'schedule': self.schedule, 'retention': self.retention}
        if name == 'StartRestore':
            return self.restore(params)
        if name == 'RestoreStatus':
            job = self.restores.get(params['id'])
            if not job:
                raise VarlinkError(f'{INTERFACE}.NotFound', {'message': 'no such restore'})
            return job
        if name == 'RevealBackupPassword':
            if self.password_ack:
                raise VarlinkError(f'{INTERFACE}.NotAllowed', {'message': 'the password was already written down'})
            return {'password': 'fake-Pass-4711-not-real'}
        if name == 'AcknowledgeBackupPassword':
            self.password_ack = True
            return {'passwordState': 'acknowledged'}
        if name == 'SetBackupTarget':
            target = {'id': params['id'], 'kind': 's3', 'repository': params['repository'],
                      'enabled': params.get('enabled', True), 'lastCopy': None}
            self.targets = [t for t in self.targets if t['id'] != params['id']] + [target]
            return target
        if name == 'RemoveBackupTarget':
            self.targets = [t for t in self.targets if t['id'] != params['id']]
            return {'removed': params['id']}
        raise VarlinkError('org.varlink.service.MethodNotFound', {'method': f'{INTERFACE}.{name}'})


def main() -> int:
    path = sys.argv[1]
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    os.chmod(path, 0o600)
    listener.listen(16)
    fake = Fake()
    me = os.getuid()
    server = Server(interface=INTERFACE, description=DESCRIPTION,
                    info={'vendor': 'Helena', 'product': 'helena-hostd (fake)', 'version': 'fake', 'url': ''},
                    dispatch=fake, authorize=lambda uid: 'dev' if uid == me else None,
                    log=lambda message: print(message, file=sys.stderr, flush=True))
    print(f'fake helena-hostd on {path}', file=sys.stderr, flush=True)
    server.serve(listener)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
