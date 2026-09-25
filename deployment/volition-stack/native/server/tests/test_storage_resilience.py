"""Tests of the storage safeguards added after the 2026-09-25 incident (a disk fell off the
PCIe bus; the firmware rewrote its boot entry to VenHw(…)): the boot entry check and repair,
the guarded ESP copy, the move of the entries onto Debian's EFI/debian, the NVMe power rules
and their helper. Run with the other hostd tests:

    python3 -m unittest discover -s deployment/volition-stack/native/server/tests -v
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unittest

from test_hostd import HostTest, fixture  # noqa: E402  (the shared fake host)

from helena_host import boot, bootlayout, esp, events, service, storage  # noqa: E402
from helena_host.common import CommandResult, HostError  # noqa: E402
from helena_host.config import load_config, write_storage_override  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS = os.path.join(HERE, '..', 'hooks')
OLD_LOADER = '\\EFI\\helena-raid\\shimx64.efi'
NEW_LOADER = '\\EFI\\debian\\shimx64.efi'
ROOT_UUID = '7a3b588b-a269-457b-a281-67748156782a'
ARRAY_UUID = '3a9a9cf25e0c71773502594f9df09b21'
STUB = (f'search.fs_uuid {ROOT_UUID} root mduuid/{ARRAY_UUID} \n'
        "set prefix=($root)'/boot/grub'\nconfigfile $prefix/grub.cfg\n")
ESP_A = '2a7ccb77-d727-4df5-aa1a-e619e847d2e8'
ESP_B = '9da3b062-2afc-42d2-9cbb-6c9128eae4a9'


class FakeFirmware:
    """efibootmgr over a fake NVRAM: prints the entries, and creates, activates, deletes and
    orders them the way efibootmgr 18 does (a created entry goes first in BootOrder)."""

    def __init__(self, text: str, partuuids: dict[tuple[str, int], str]):
        parsed = storage.parse_efibootmgr(text)
        self.current = parsed['current']
        self.order = list(parsed['order'])
        self.entries: dict[str, dict] = {}
        for line in text.splitlines():
            match = storage.BOOT_ENTRY.match(line)
            if match:
                number, active, label, path = match.groups()
                self.entries[number] = {'active': active == '*', 'label': label.strip(), 'path': path or ''}
        self.partuuids = partuuids
        self.fail: set[str] = set()
        self.log: list[str] = []

    def text(self) -> str:
        lines = [f'BootCurrent: {self.current}', 'Timeout: 2 seconds', f"BootOrder: {','.join(self.order)}"]
        for number in sorted(self.entries):
            entry = self.entries[number]
            lines.append(f"Boot{number}{'*' if entry['active'] else ' '} {entry['label']}\t{entry['path']}")
        return '\n'.join(lines) + '\n'

    def __call__(self, argv, **_):
        args = argv[1:]
        if not args:
            return CommandResult(0, self.text(), '')
        op = next((a for a in args if a in ('--create', '--active', '--delete-bootnum', '--bootorder')), None)
        self.log.append(' '.join(args))
        if op in self.fail:
            return CommandResult(5, '', 'Could not write the variable: Input/output error')
        value = lambda flag: args[args.index(flag) + 1]  # noqa: E731
        if op == '--create':
            disk, part = value('--disk').removeprefix('/dev/'), int(value('--part'))
            number = next(f'{n:04X}' for n in range(0x10000) if f'{n:04X}' not in self.entries)
            self.entries[number] = {
                'active': True, 'label': value('--label'),
                'path': f"HD({part},GPT,{self.partuuids[(disk, part)]},0x800,0x400000)/File({value('--loader')})",
            }
            self.order.insert(0, number)
        elif op == '--active':
            self.entries[value('--bootnum')]['active'] = True
        elif op == '--delete-bootnum':
            number = value('--bootnum')
            del self.entries[number]
            self.order = [n for n in self.order if n != number]
        elif op == '--bootorder':
            self.order = value('--bootorder').split(',')
        return CommandResult(0, self.text(), '')


class ResilienceTest(HostTest):
    def setUp(self):
        super().setUp()
        self.programs['rsync'] = '/usr/bin/rsync'
        self.write('/sys/firmware/efi/.present', '')
        for kname, number in (('nvme1n1p1', 1), ('nvme1n1p2', 2), ('nvme0n1p1', 1), ('nvme0n1p2', 2)):
            self.write(f'/sys/class/block/{kname}/partition', f'{number}\n')
        self.devices = json.loads(fixture('lsblk.json'))['blockdevices']
        self.runner.on('/usr/bin/lsblk', fn=lambda argv, **_: CommandResult(
            0, json.dumps({'blockdevices': self.devices}), ''))
        for mount in ('/boot/efi', '/boot/efi2'):
            self.esp_files(mount)
        self.mounted = {'/boot/efi': 'vfat', '/boot/efi2': 'vfat'}
        self.runner.on('/usr/bin/findmnt', fn=self.findmnt)
        self.runner.on('/usr/bin/rsync', fn=self.copy_tree)
        # The mirrored layout: both ESPs in fstab, the RAID idle and whole.
        self.write('/etc/fstab', 'UUID=7a3b588b / ext4 defaults 0 1\n'
                                 'UUID=19BA-D77A /boot/efi vfat umask=0077,nofail 0 1\n'
                                 'UUID=E6D1-53D4 /boot/efi2 vfat umask=0077,nofail 0 1\n')
        self.mirror()

    def mirror(self, degraded: int = 0, action: str = 'idle') -> None:
        base = '/sys/block/md127/md'
        for name, value in (('level', 'raid1'), ('raid_disks', '2'), ('degraded', str(degraded)),
                            ('sync_action', action), ('sync_completed', 'none'), ('array_state', 'clean')):
            self.write(f'{base}/{name}', value + '\n')

    def copy_tree(self, argv, **_):
        shutil.rmtree(argv[-1])
        shutil.copytree(argv[-2], argv[-1])
        return CommandResult(0, '', '')

    def esp_files(self, mount: str, *, grub: str = STUB) -> None:
        """An ESP as the RAID setup of 2026-09-24 left it: EFI/helena-raid and the firmware's
        removable path EFI/BOOT with the same shim, GRUB and MokManager, and the stub."""
        for folder, shim in (('EFI/helena-raid', 'shimx64.efi'), ('EFI/BOOT', 'BOOTX64.EFI')):
            self.write(f'{mount}/{folder}/{shim}', 'shim-15.8')
            self.write(f'{mount}/{folder}/grubx64.efi', 'grub-2.12')
            self.write(f'{mount}/{folder}/mmx64.efi', 'mm-15.8')
            self.write(f'{mount}/{folder}/grub.cfg', grub)

    def findmnt(self, argv, **_):
        if '-T' in argv:  # the file system that holds /boot/grub: the RAID's
            return CommandResult(0, json.dumps({'filesystems': [
                {'target': '/', 'source': '/dev/md127', 'uuid': ROOT_UUID}]}), '')
        mount = argv[argv.index('--mountpoint') + 1]
        fstype = self.mounted.get(mount)
        if not fstype:
            return CommandResult(1, '', '')
        return CommandResult(0, json.dumps({'filesystems': [
            {'target': mount, 'source': f'/dev/disk-of{mount.replace("/", "-")}', 'fstype': fstype}]}), '')

    def firmware(self, text: str) -> FakeFirmware:
        fake = FakeFirmware(text, {('nvme1n1', 1): ESP_A, ('nvme0n1', 1): ESP_B,
                                   ('nvme1n1', 2): '1fe4a82c-657a-4460-b39f-1c80fbf6c066'})
        self.runner.on('/usr/bin/efibootmgr', fn=fake)
        return fake

    def unplug(self, disk: str) -> None:
        """The disk fell off the bus: lsblk no longer lists it, its ESP is not mounted."""
        self.devices = [device for device in self.devices if device['kname'] != disk]
        mount = {'nvme1n1': '/boot/efi', 'nvme0n1': '/boot/efi2'}[disk]
        self.mounted.pop(mount, None)


# ── Boot entries ─────────────────────────────────────────────────────────────────────────

class BootEntryTests(ResilienceTest):
    """The repair on the layout of 2026-09-25: both entries on EFI/helena-raid."""

    def setUp(self):
        super().setUp()
        self.config.data['storage']['bootLoader'] = OLD_LOADER

    def test_the_parser_keeps_the_loader_and_sees_a_rewritten_entry(self):
        parsed = storage.parse_efibootmgr(fixture('efibootmgr-venhw.txt'))
        debian, reserve, uefi = parsed['entries'][:3]
        self.assertEqual((debian['number'], debian['label'], debian['partuuid']), ('000F', 'Debian', None))
        self.assertTrue(debian['vendorHardware'])
        self.assertIsNone(debian['loader'])
        self.assertEqual(reserve['loader'], OLD_LOADER)
        self.assertEqual(reserve['partuuid'], ESP_B)
        self.assertFalse(reserve['vendorHardware'])
        self.assertEqual(uefi['loader'], '\\EFI\\BOOT\\BOOTX64.EFI')
        self.assertIsNone(parsed['entries'][3]['loader'])  # BBS(…)

    def test_a_healthy_machine_needs_nothing(self):
        fake = self.firmware(fixture('efibootmgr.txt'))
        result = boot.repair(self.host, self.config)
        self.assertEqual([check['state'] for check in result['roles']], ['ok', 'ok'])
        self.assertEqual(result['actions'], [])
        self.assertFalse(result['changed'])
        self.assertEqual(fake.log, [])
        self.assertFalse(os.path.exists(os.path.join(self.config.state_dir, 'audit.log')))

    def test_the_rewritten_entry_is_replaced_created_first_then_deleted(self):
        fake = self.firmware(fixture('efibootmgr-venhw.txt'))
        checks = boot.check(self.host, self.config.storage,
                            storage.parse_efibootmgr(fixture('efibootmgr-venhw.txt')), self.devices)
        self.assertEqual([(c['role'], c['state']) for c in checks], [('main', 'noPartuuid'), ('reserve', 'ok')])
        result = boot.repair(self.host, self.config)
        self.assertTrue(result['ok'])
        # efibootmgr puts a created entry first: the order needs no rewrite afterwards.
        self.assertEqual([a['op'] for a in result['actions']], ['create', 'delete'])
        create = fake.log[0].split(' ')
        self.assertEqual(create[:6], ['--create', '--disk', '/dev/nvme1n1', '--part', '1', '--label'])
        self.assertIn(OLD_LOADER, fake.log[0])
        self.assertEqual(fake.log[1], '--bootnum 000F --delete-bootnum')
        new = result['actions'][0]['number']
        self.assertEqual(fake.order, [new, '001A', '001B', '001C', '001D', '001E'])
        after = storage.parse_efibootmgr(fake.text())
        debian = [entry for entry in after['entries'] if entry['label'] == 'Debian']
        self.assertEqual(len(debian), 1)
        self.assertEqual((debian[0]['partuuid'], debian[0]['loader']), (ESP_A, OLD_LOADER))
        self.assertEqual(result['roles'][0]['state'], 'ok')
        # Audited, and an event for the Server tab.
        with open(os.path.join(self.config.state_dir, 'audit.log')) as handle:
            line = json.loads(handle.read().splitlines()[-1])
        self.assertEqual((line['method'], line['caller'], line['ok']), ('BootRepair', 'root', True))
        latest = events.listing(self.config.state_dir)['events'][0]
        self.assertEqual((latest['source'], latest['code'], latest['severity']), ('boot', 'BootEntryRepaired', 'warning'))
        self.assertIn('removed Boot000F (noPartuuid)', latest['message'])
        # A second run finds nothing to do.
        fake.log.clear()
        again = boot.repair(self.host, self.config)
        self.assertEqual(again['actions'], [])
        self.assertEqual(fake.log, [])

    def test_the_order_the_firmware_left_is_logged_and_kept(self):
        text = fixture('efibootmgr.txt').replace('BootOrder: 000F,001A', 'BootOrder: 001A,000F')
        fake = self.firmware(text)
        logs: list[str] = []
        result = boot.repair(self.host, self.config, log=logs.append, actor='test')
        self.assertIn('boot-repair: firmware order was 001A,000F; booted 000A', logs)
        self.assertEqual((result['firmwareOrder'], result['order']), (['001A', '000F'], ['000F', '001A']))
        self.assertEqual(fake.order, ['000F', '001A'])
        boot.repair(self.host, self.config)
        [first, second] = boot.history(self.config.state_dir)
        self.assertEqual((first['firmwareOrder'], first['order'], first['changed']),
                         (['001A', '000F'], ['000F', '001A'], True))
        self.assertEqual((second['firmwareOrder'], second['changed']), (['000F', '001A'], False))

    def test_a_failed_create_deletes_nothing(self):
        fake = self.firmware(fixture('efibootmgr-venhw.txt'))
        fake.fail.add('--create')
        result = boot.repair(self.host, self.config)
        self.assertFalse(result['ok'])
        self.assertEqual([a['op'] for a in result['actions']], ['create'])
        self.assertIn('000F', fake.entries)
        self.assertEqual(fake.order[0], '000F')
        latest = events.listing(self.config.state_dir)['events'][0]
        self.assertEqual((latest['code'], latest['severity']), ('BootEntryRepairFailed', 'critical'))

    def test_an_entry_that_does_not_read_back_is_not_trusted(self):
        fake = self.firmware(fixture('efibootmgr-venhw.txt'))
        # The firmware takes the variable but mangles it (as it did at boot).
        original = fake.__call__

        def mangle(argv, **kwargs):
            result = original(argv, **kwargs)
            if '--create' in argv:
                number = fake.order[0]
                fake.entries[number]['path'] = 'VenHw(99e275e7-75a0-4b37-a2e6-c5385e6c00cb)'
            return result
        self.runner.on('/usr/bin/efibootmgr', fn=mangle)
        result = boot.repair(self.host, self.config)
        self.assertFalse(result['ok'])
        self.assertIn('000F', fake.entries)
        self.assertNotIn('--delete-bootnum', ' '.join(fake.log))

    def test_a_missing_disk_is_left_alone(self):
        fake = self.firmware(fixture('efibootmgr-venhw.txt'))
        self.unplug('nvme1n1')
        result = boot.repair(self.host, self.config)
        main, reserve = result['roles']
        self.assertEqual((main['espPresent'], main['state']), (False, 'noPartuuid'))
        self.assertEqual(reserve['state'], 'ok')
        self.assertEqual(result['actions'], [])
        self.assertEqual(fake.log, [])  # not even the order: main is not verified
        self.assertEqual(fake.order[0], '000F')

    def test_the_reserve_is_repaired_while_the_main_disk_is_away(self):
        text = fixture('efibootmgr.txt').replace(
            f'HD(1,GPT,{ESP_B},0x800,0x400000)/File(\\EFI\\helena-raid\\shimx64.efi)',
            'VenHw(99e275e7-75a0-4b37-a2e6-c5385e6c00cb)')
        fake = self.firmware(text)
        self.unplug('nvme1n1')
        result = boot.repair(self.host, self.config)
        self.assertEqual([a['op'] for a in result['actions']], ['create', 'delete'])
        self.assertIn('--disk /dev/nvme0n1 --part 1 --label Debian (Reserve)', fake.log[0])
        # The main entry (its disk away) keeps its place; the order is not rewritten.
        self.assertIn('000F', fake.entries)
        self.assertNotIn('--bootorder', ' '.join(fake.log))

    def test_missing_wrong_loader_inactive_and_duplicates(self):
        text = '\n'.join([
            'BootCurrent: 0001', 'BootOrder: 0003,0001,0002,0004',
            f'Boot0001  Debian (Reserve)\tHD(1,GPT,{ESP_B},0x800,0x400000)/File({OLD_LOADER})',
            f'Boot0002* Debian (Reserve)\tHD(1,GPT,{ESP_B},0x800,0x400000)/File({OLD_LOADER})',
            f'Boot0003* Debian\tHD(1,GPT,{ESP_A},0x800,0x400000)/File(\\EFI\\debian\\shimx64.efi)',
            'Boot0004* Debian\tHD(1,GPT,0badc0de-0000-4000-8000-000000000000,0x800,0x400000)/File(\\EFI\\x.efi)',
        ]) + '\n'
        fake = self.firmware(text)
        dry = boot.repair(self.host, self.config, dry_run=True)
        self.assertEqual(fake.log, [])
        self.assertEqual(dry['roles'][0]['state'], 'wrongDisk')  # the worst of 0003 (loader) and 0004 (gone)
        self.assertEqual(dry['roles'][1]['state'], 'duplicate')
        self.assertEqual([a['op'] for a in dry['actions']], ['create', 'delete', 'delete', 'delete', 'order'])
        result = boot.repair(self.host, self.config)
        self.assertTrue(result['ok'])
        labels = [(e['label'], e['partuuid'], e['active']) for e in storage.parse_efibootmgr(fake.text())['entries']]
        self.assertEqual(sorted(labels), sorted([('Debian', ESP_A, True), ('Debian (Reserve)', ESP_B, True)]))
        # The active reserve entry (0002) is kept; 0001 was the inactive duplicate.
        self.assertIn('0002', fake.entries)
        self.assertEqual(fake.order[1], '0002')

    def test_an_inactive_entry_is_activated_not_recreated(self):
        text = fixture('efibootmgr.txt').replace('Boot000F* Debian', 'Boot000F  Debian')
        fake = self.firmware(text)
        result = boot.repair(self.host, self.config)
        self.assertEqual([a['op'] for a in result['actions']], ['activate'])
        self.assertTrue(fake.entries['000F']['active'])

    def test_an_entry_of_another_install_on_another_disk_is_never_deleted(self):
        self.devices.append({'kname': 'sda', 'type': 'disk', 'children': [
            {'kname': 'sda1', 'type': 'part', 'partuuid': '11111111-2222-4333-8444-555555555555',
             'mountpoints': []}]})
        text = fixture('efibootmgr.txt') + (
            'Boot0005* Debian\tHD(1,GPT,11111111-2222-4333-8444-555555555555,0x800,0x100000)'
            '/File(\\EFI\\debian\\shimx64.efi)\n')
        fake = self.firmware(text)
        result = boot.repair(self.host, self.config)
        self.assertIn('0005', fake.entries)
        self.assertEqual(result['roles'][0]['foreign'], ['0005'])
        self.assertEqual(result['roles'][0]['state'], 'ok')

    def test_no_entry_is_made_for_a_loader_that_is_not_there(self):
        fake = self.firmware(fixture('efibootmgr-venhw.txt'))
        os.unlink(self.host.path('/boot/efi/EFI/helena-raid/shimx64.efi'))
        result = boot.repair(self.host, self.config)
        self.assertEqual(result['roles'][0]['state'], 'loaderMissing')
        self.assertEqual(fake.log, [])

    def test_another_boot_layout_gets_no_lines_and_no_repair(self):
        # Debian's usual single ESP with its own "debian" entry: not ours to judge.
        self.write('/etc/fstab', 'UUID=19BA-D77A /boot/efi vfat umask=0077 0 1\n')
        self.write('/boot/efi/EFI/debian/shimx64.efi', 'shim')
        self.write('/boot/efi/EFI/debian/grub.cfg', STUB)
        fake = self.firmware('BootCurrent: 0001\nBootOrder: 0001\n'
                             f'Boot0001* debian\tHD(1,GPT,{ESP_A},0x800,0x400000)/File({NEW_LOADER})\n')
        for loader in (OLD_LOADER, NEW_LOADER):
            self.config.data['storage']['bootLoader'] = loader
            self.assertEqual(boot.check(self.host, self.config.storage, storage.parse_efibootmgr(fake.text()),
                                        self.devices), [])
            result = boot.repair(self.host, self.config)
            self.assertEqual((result['reason'], result['actions']), ('notInUse', []))
            synced = esp.sync(self.host, self.config)
            self.assertEqual((synced['state'], synced['reason']), ('skipped', 'notInUse'))
        self.assertEqual(fake.log, [])
        self.assertFalse(os.path.exists(os.path.join(self.config.state_dir, 'esp-sync.json')))
        self.assertEqual(events.listing(self.config.state_dir)['events'], [])
        # Both ESPs in fstab but no known loader folder on either: not in use either.
        self.write('/etc/fstab', 'x /boot/efi vfat d 0 1\nx /boot/efi2 vfat d 0 1\n')
        for mount in ('/boot/efi', '/boot/efi2'):
            shutil.rmtree(self.host.path(f'{mount}/EFI/helena-raid'))
        shutil.rmtree(self.host.path('/boot/efi/EFI/debian'))
        self.assertFalse(boot.layout_in_use(self.host, self.config.storage))

    def test_a_machine_without_efi_is_not_supported(self):
        shutil.rmtree(self.host.path('/sys/firmware'))
        with self.assertRaises(HostError) as caught:
            boot.repair(self.host, self.config)
        self.assertEqual(caught.exception.code, 'NotSupported')

    def test_storage_status_carries_the_checks_and_the_last_copy(self):
        self.firmware(fixture('efibootmgr-venhw.txt'))
        self.runner.on('/usr/bin/smartctl', out=fixture('smart-nvme-samsung.json'), rc=4)
        storage._smart_cache.clear()
        status = storage.status(self.host, self.config.storage, fresh=True, state_dir=self.config.state_dir)
        self.assertEqual([(c['role'], c['state']) for c in status['bootEntries']],
                         [('main', 'noPartuuid'), ('reserve', 'ok')])
        self.assertIsNone(status['esp']['sync'])
        esp.sync(self.host, self.config)
        status = storage.status(self.host, self.config.storage, state_dir=self.config.state_dir)
        self.assertEqual(status['esp']['sync']['state'], 'ok')
        self.assertNotIn('syncedDigest', status['esp']['sync'])
        dispatch = service.Dispatcher(self.host, self.config, lambda _: None)
        reply = dispatch('StorageStatus', {}, {'name': 'volition-plan'})['result']
        self.assertEqual(reply['bootEntries'][0]['state'], 'noPartuuid')


# ── The ESP copy ─────────────────────────────────────────────────────────────────────────

class EspSyncTests(ResilienceTest):
    def setUp(self):
        super().setUp()
        self.runner.on('/usr/bin/rsync', fn=self.rsync)
        self.rsync_rc = 0
        self.corrupt = False

    def rsync(self, argv, **_):
        source, target = argv[-2].rstrip('/'), argv[-1].rstrip('/')
        if self.rsync_rc:
            return CommandResult(self.rsync_rc, '', 'rsync: write failed: Input/output error (5)')
        assert '--delete' in argv
        shutil.rmtree(target)
        shutil.copytree(source, target)
        if self.corrupt:
            with open(os.path.join(target, 'EFI/helena-raid/grubx64.efi'), 'w') as handle:
                handle.write('half')
        return CommandResult(0, '>f.st...... EFI/helena-raid/grub.cfg\n', '')

    def state(self) -> dict:
        with open(os.path.join(self.config.state_dir, 'esp-sync.json')) as handle:
            return json.load(handle)

    def test_a_good_source_is_copied_and_verified(self):
        self.write('/boot/efi/EFI/helena-raid/grub.cfg', 'new grub config\n')
        self.write('/boot/efi2/EFI/old-leftover.efi', 'stale')
        result = esp.sync(self.host, self.config, trigger='apt')
        self.assertEqual(result['state'], 'ok')
        self.assertEqual(self.read('/boot/efi2/EFI/helena-raid/grub.cfg'), 'new grub config\n')
        self.assertFalse(os.path.exists(self.host.path('/boot/efi2/EFI/old-leftover.efi')))
        [call] = self.runner.called('/usr/bin/rsync')
        self.assertIn('--modify-window=1', call)
        self.assertEqual(call[-2:], [self.host.path('/boot/efi') + '/', self.host.path('/boot/efi2') + '/'])
        self.assertEqual(self.state()['pending'], False)
        with open(os.path.join(self.config.state_dir, 'audit.log')) as handle:
            self.assertEqual(json.loads(handle.read())['method'], 'EspSync')
        self.assertEqual(events.listing(self.config.state_dir)['events'], [])

    def test_a_dry_run_touches_nothing(self):
        result = esp.sync(self.host, self.config, dry_run=True)
        self.assertEqual(result['state'], 'ready')
        self.assertEqual(self.runner.called('/usr/bin/rsync'), [])
        self.assertFalse(os.path.exists(os.path.join(self.config.state_dir, 'esp-sync.json')))

    def test_an_unmounted_mirror_is_skipped_and_pending_only_when_something_changed(self):
        esp.sync(self.host, self.config)  # a verified copy first
        self.mounted.pop('/boot/efi2')
        result = esp.sync(self.host, self.config)
        self.assertEqual((result['state'], result['reason'], result['mount']), ('skipped', 'notMounted', '/boot/efi2'))
        self.assertFalse(result['pending'])  # the source is what was copied last time
        self.assertEqual(events.listing(self.config.state_dir)['events'], [])
        self.write('/boot/efi/EFI/helena-raid/grubx64.efi', 'grub-2.14')  # grub updated meanwhile
        result = esp.sync(self.host, self.config)
        self.assertTrue(result['pending'])
        self.assertEqual(len(self.runner.called('/usr/bin/rsync')), 1)
        [event] = events.listing(self.config.state_dir)['events']
        self.assertEqual((event['code'], event['severity'], event['device']), ('EspSyncSkipped', 'warning', '/boot/efi2'))
        esp.sync(self.host, self.config)  # still skipped: no second event
        self.assertEqual(len(events.listing(self.config.state_dir)['events']), 1)
        self.mounted['/boot/efi2'] = 'vfat'
        self.assertEqual(esp.sync(self.host, self.config)['state'], 'ok')
        latest = events.listing(self.config.state_dir)['events'][0]
        self.assertEqual((latest['code'], latest['severity']), ('EspSyncRecovered', 'info'))

    def test_an_unmounted_source_is_skipped_and_the_mirror_kept(self):
        self.mounted.pop('/boot/efi')
        result = esp.sync(self.host, self.config)
        self.assertEqual((result['state'], result['reason'], result['pending']), ('skipped', 'notMounted', True))
        self.assertEqual(self.runner.called('/usr/bin/rsync'), [])

    def test_the_same_file_system_twice_or_not_vfat_is_skipped(self):
        shutil.rmtree(self.host.path('/boot/efi2'))
        os.symlink(self.host.path('/boot/efi'), self.host.path('/boot/efi2'))
        self.assertEqual(esp.sync(self.host, self.config)['reason'], 'sameDevice')
        self.mounted['/boot/efi2'] = 'ext4'
        self.assertEqual(esp.sync(self.host, self.config)['reason'], 'notVfat')
        self.assertEqual(self.runner.called('/usr/bin/rsync'), [])

    def test_an_incomplete_source_never_reaches_rsync(self):
        for missing in ('EFI/helena-raid/shimx64.efi', 'EFI/helena-raid/grub.cfg'):
            with self.subTest(missing=missing):
                self.esp_files('/boot/efi')
                self.write(f'/boot/efi/{missing}', '')  # empty counts as missing
                result = esp.sync(self.host, self.config)
                self.assertEqual((result['state'], result['reason'], result['detail']),
                                 ('failed', 'sourceIncomplete', missing))
        os.unlink(self.host.path('/boot/efi/EFI/helena-raid/shimx64.efi'))
        self.assertEqual(esp.sync(self.host, self.config)['reason'], 'sourceIncomplete')
        self.assertEqual(self.runner.called('/usr/bin/rsync'), [])
        self.assertEqual(self.read('/boot/efi2/EFI/helena-raid/shimx64.efi'), 'shim-15.8')
        [event] = [e for e in events.listing(self.config.state_dir)['events'] if e['code'] == 'EspSyncFailed']
        self.assertEqual(event['severity'], 'critical')

    @unittest.skipIf(hasattr(os, 'geteuid') and os.geteuid() == 0, 'root reads a file without permissions')
    def test_a_source_that_does_not_read_is_not_copied(self):
        path = self.host.path('/boot/efi/EFI/helena-raid/grubx64.efi')
        os.chmod(path, 0)
        self.addCleanup(os.chmod, path, 0o644)
        result = esp.sync(self.host, self.config)
        self.assertEqual((result['state'], result['reason']), ('failed', 'readFailed'))
        self.assertEqual(result['detail'], 'EFI/helena-raid/grubx64.efi')
        self.assertEqual(self.runner.called('/usr/bin/rsync'), [])

    def test_rsync_errors_and_a_copy_that_differs_fail(self):
        self.rsync_rc = 23
        result = esp.sync(self.host, self.config)
        self.assertEqual((result['state'], result['reason']), ('failed', 'rsyncFailed'))
        self.rsync_rc = 0
        self.corrupt = True
        result = esp.sync(self.host, self.config)
        self.assertEqual((result['state'], result['reason'], result['detail']),
                         ('failed', 'verifyFailed', 'EFI/helena-raid/grubx64.efi'))
        codes = [(e['code'], e['message']) for e in events.listing(self.config.state_dir)['events']]
        self.assertEqual(codes[0], ('EspSyncFailed', 'verifyFailed EFI/helena-raid/grubx64.efi'))
        self.assertEqual(codes[1][0], 'EspSyncFailed')
        with open(os.path.join(self.config.state_dir, 'audit.log')) as handle:
            self.assertEqual([json.loads(line)['ok'] for line in handle], [False, False])

    def test_the_cli_reports_to_apt_without_failing_it(self):
        # The apt hook swallows the exit status; the command itself says what happened.
        with open(os.path.join(HOOKS, '99helena-esp-sync')) as handle:
            hook = handle.read()
        self.assertIn('/usr/local/lib/helena/hostd/helena-esp-sync --from-apt', hook)
        self.assertIn('|| true', hook)
        self.assertRegex(hook, r'if \[ -x /usr/local/lib/helena/hostd/helena-esp-sync \]')


class EspDebianFolderTests(ResilienceTest):
    def test_every_loader_folder_on_either_esp_must_be_complete_on_the_source(self):
        # EFI/debian on the source only, without its grub.cfg: never copied.
        self.write('/boot/efi/EFI/debian/shimx64.efi', 'shim-15.8')
        result = esp.sync(self.host, self.config)
        self.assertEqual((result['state'], result['reason'], result['detail']),
                         ('failed', 'sourceIncomplete', 'EFI/debian/grub.cfg'))
        # Complete on the source: copied along with EFI/helena-raid.
        self.write('/boot/efi/EFI/debian/grub.cfg', STUB)
        self.assertEqual(esp.sync(self.host, self.config)['state'], 'ok')
        self.assertEqual(self.read('/boot/efi2/EFI/debian/grub.cfg'), STUB)
        self.assertEqual(self.read('/boot/efi2/EFI/helena-raid/shimx64.efi'), 'shim-15.8')
        # A loader the mirror still has but the source lost: the copy would delete it. Refused.
        shutil.rmtree(self.host.path('/boot/efi/EFI/helena-raid'))
        result = esp.sync(self.host, self.config)
        self.assertEqual((result['state'], result['detail']), ('failed', 'EFI/helena-raid/shimx64.efi'))
        # Removed from both ESPs at once (the documented clean-up): fine again.
        shutil.rmtree(self.host.path('/boot/efi2/EFI/helena-raid'))
        self.assertEqual(esp.sync(self.host, self.config)['state'], 'ok')
        # The firmware's removable path is guarded the same way.
        os.unlink(self.host.path('/boot/efi/EFI/BOOT/grub.cfg'))
        result = esp.sync(self.host, self.config)
        self.assertEqual((result['state'], result['detail']), ('failed', 'EFI/BOOT/grub.cfg'))


class OldLayoutTests(ResilienceTest):
    """The default config names EFI/debian; the entries of 2026-09-24 start EFI/helena-raid."""

    def debian(self, mount: str, *, grub: bool = True) -> None:
        self.write(f'{mount}/EFI/debian/shimx64.efi', 'shim-15.8')
        self.write(f'{mount}/EFI/debian/grubx64.efi', 'grub-2.12')
        if grub:
            self.write(f'{mount}/EFI/debian/grub.cfg', STUB)

    def test_entries_on_the_old_layout_are_left_alone_until_debian_is_complete(self):
        fake = self.firmware(fixture('efibootmgr.txt'))
        self.debian('/boot/efi', grub=False)  # a shim without its grub.cfg is not a loader
        result = boot.repair(self.host, self.config)
        self.assertEqual([(c['state'], c['number']) for c in result['roles']],
                         [('oldLayout', '000F'), ('oldLayout', '001A')])
        self.assertEqual((result['actions'], fake.log), ([], []))

    def test_an_entry_moves_once_its_esp_has_debian(self):
        fake = self.firmware(fixture('efibootmgr.txt'))
        self.debian('/boot/efi')  # only the first ESP so far
        result = boot.repair(self.host, self.config)
        self.assertTrue(result['ok'])
        self.assertEqual([a['op'] for a in result['actions']], ['create', 'delete'])
        self.assertEqual(result['actions'][1]['reason'], 'oldLayout')
        self.assertEqual([c['state'] for c in result['roles']], ['ok', 'oldLayout'])
        entries = {e['label']: e for e in storage.parse_efibootmgr(fake.text())['entries']}
        self.assertEqual((entries['Debian']['loader'], entries['Debian']['partuuid']), (NEW_LOADER, ESP_A))
        self.assertEqual(entries['Debian (Reserve)']['loader'], OLD_LOADER)
        self.assertEqual(fake.order[:2], [entries['Debian']['number'], '001A'])
        latest = events.listing(self.config.state_dir)['events'][0]
        self.assertEqual((latest['code'], latest['severity']), ('BootEntriesMoved', 'info'))

    def test_a_rewritten_entry_is_created_on_debian_when_it_is_there(self):
        fake = self.firmware(fixture('efibootmgr-venhw.txt'))
        self.debian('/boot/efi')
        result = boot.repair(self.host, self.config)
        self.assertEqual(result['roles'][0]['state'], 'ok')
        debian = [e for e in storage.parse_efibootmgr(fake.text())['entries'] if e['label'] == 'Debian']
        self.assertEqual([(e['loader'], e['partuuid']) for e in debian], [(NEW_LOADER, ESP_A)])
        latest = events.listing(self.config.state_dir)['events'][0]
        self.assertEqual(latest['code'], 'BootEntryRepaired')  # a VenHw entry is a repair, not a move


class BootLayoutTests(ResilienceTest):
    """helena-hostd boot-layout: the move onto Debian's EFI/debian, and back."""

    def setUp(self):
        super().setUp()
        for name in ('grub-install', 'debconf-show', 'debconf-set-selections'):
            self.programs[name] = f'/usr/sbin/{name}'
        for mount in ('/boot/efi', '/boot/efi2'):
            self.write(f'{mount}/EFI/helena-raid/mmx64.efi', 'mm-15.8')
            self.write(f'{mount}/EFI/helena-raid/grub.cfg', STUB)
        self.write('/usr/lib/shim/shimx64.efi.signed', 'shim-15.8')
        self.write('/usr/lib/grub/x86_64-efi-signed/grubx64.efi.signed', 'grub-2.12')
        self.write('/usr/lib/shim/mmx64.efi.signed', 'mm-15.8')
        self.debconf = {'grub2/force_efi_extra_removable': 'false', 'grub2/update_nvram': 'true'}
        self.runner.on('/usr/sbin/debconf-show', fn=lambda argv, **_: CommandResult(
            0, '  grub2/linux_cmdline:\n' + ''.join(f'* {k}: {v}\n' for k, v in self.debconf.items()), ''))
        self.runner.on('/usr/sbin/debconf-set-selections', fn=self.set_selections)
        self.grub_cfg = STUB
        self.grub_binary = None
        # The config file the change writes its override into (with this test's folders).
        with open(self.config.path, 'w') as handle:
            json.dump({'stateDir': self.config.state_dir, 'runDir': self.config.run_dir}, handle)
        self.runner.on('/usr/sbin/grub-install', fn=self.grub_install)
        self.fake = self.firmware(fixture('efibootmgr.txt'))

    def set_selections(self, argv, input=None, **_):
        for line in input.splitlines():
            package, question, kind, value = line.split()
            assert (package, kind) == ('grub-efi-amd64', 'boolean')
            self.debconf[question] = value
        return CommandResult(0, '', '')

    def grub_install(self, argv, **_):
        """Debian's grub-install --uefi-secure-boot (grub-install-removable-shim.patch): the
        signed images and the stub in the vendor folder; with --force-extra-removable shim as
        BOOTX64.EFI, grubx64.efi and mmx64.efi in EFI/BOOT, fbx64.efi only when it may write
        NVRAM, never a grub.cfg there."""
        efi = next(a for a in argv if a.startswith('--efi-directory=')).split('=', 1)[1]
        folder = next(a for a in argv if a.startswith('--bootloader-id=')).split('=', 1)[1]
        for name, signed in bootlayout.SIGNED:
            self.write(f'{efi}/EFI/{folder}/{name}', self.read(signed))
        self.write(f'{efi}/EFI/{folder}/fbx64.efi', 'fb-15.8')
        if self.grub_binary:
            self.write(f'{efi}/EFI/{folder}/grubx64.efi', self.grub_binary)
        self.write(f'{efi}/EFI/{folder}/grub.cfg', self.grub_cfg)
        if '--force-extra-removable' in argv:
            self.write(f'{efi}/EFI/BOOT/BOOTX64.EFI', self.read('/usr/lib/shim/shimx64.efi.signed'))
            self.write(f'{efi}/EFI/BOOT/grubx64.efi', self.grub_binary or self.read(bootlayout.SIGNED[1][1]))
            self.write(f'{efi}/EFI/BOOT/mmx64.efi', self.read('/usr/lib/shim/mmx64.efi.signed'))
            if '--no-nvram' not in argv:
                self.write(f'{efi}/EFI/BOOT/fbx64.efi', 'fb-15.8')
        return CommandResult(0, '', 'Installation finished. No error reported.')

    def package_update(self) -> None:
        """A newer shim and GRUB from apt (the signed files under /usr/lib change)."""
        self.write('/usr/lib/shim/shimx64.efi.signed', 'shim-16.1')
        self.write('/usr/lib/grub/x86_64-efi-signed/grubx64.efi.signed', 'grub-2.14')

    def entries(self) -> dict:
        return {e['label']: e for e in storage.parse_efibootmgr(self.fake.text())['entries']}

    def test_the_dry_run_says_what_it_would_do_and_does_nothing(self):
        result = bootlayout.migrate(self.host, self.config, dry_run=True)
        self.assertTrue(result['ok'])
        steps = {step['step']: step for step in result['steps']}
        self.assertEqual(list(steps), ['config', 'debconf', 'grubInstall', 'removablePath', 'copy', 'bootRepair'])
        self.assertTrue(steps['config']['already'])
        self.assertEqual(steps['debconf']['set'], {'grub2/update_nvram': 'false',
                                                   'grub2/force_efi_extra_removable': 'true'})
        self.assertEqual(steps['grubInstall']['argv'][1:], [
            '--target=x86_64-efi', '--efi-directory=/boot/efi', '--bootloader-id=debian',
            '--uefi-secure-boot', '--force-extra-removable', '--no-nvram'])
        self.assertIn('EFI/debian/shimx64.efi is missing', steps['grubInstall']['because'])
        self.assertEqual([e['state'] for e in steps['bootRepair']['entries']], ['oldLayout', 'oldLayout'])
        self.assertEqual(self.runner.called('/usr/sbin/grub-install'), [])
        self.assertEqual(self.runner.called('/usr/sbin/debconf-set-selections'), [])
        self.assertEqual(self.runner.called('/usr/bin/rsync'), [])
        self.assertEqual(self.fake.log, [])
        self.assertFalse(os.path.exists(self.host.path('/boot/efi/EFI/debian')))

    def test_the_move_installs_debian_copies_it_and_moves_both_entries(self):
        result = bootlayout.migrate(self.host, self.config)
        self.assertTrue(result['ok'], result)
        self.assertEqual(self.debconf, {'grub2/update_nvram': 'false', 'grub2/force_efi_extra_removable': 'true'})
        [argv] = self.runner.called('/usr/sbin/grub-install')
        self.assertIn('--no-nvram', argv)
        for mount in ('/boot/efi', '/boot/efi2'):
            self.assertEqual(bootlayout.removable_state(self.host, mount, self.config.storage,
                                                        bootlayout.root_filesystem(self.host, self.devices))['state'],
                             'ok', mount)
            self.assertFalse(os.path.exists(self.host.path(f'{mount}/EFI/BOOT/fbx64.efi')))
        for mount in ('/boot/efi', '/boot/efi2'):
            self.assertEqual(self.read(f'{mount}/EFI/debian/grub.cfg'), STUB)
            self.assertEqual(self.read(f'{mount}/EFI/helena-raid/shimx64.efi'), 'shim-15.8')  # the fallback stays
        entries = self.entries()
        self.assertEqual((entries['Debian']['loader'], entries['Debian']['partuuid']), (NEW_LOADER, ESP_A))
        self.assertEqual((entries['Debian (Reserve)']['loader'], entries['Debian (Reserve)']['partuuid']),
                         (NEW_LOADER, ESP_B))
        self.assertNotIn('000F', self.fake.entries)
        self.assertNotIn('001A', self.fake.entries)
        self.assertEqual(self.fake.order[:2], [entries['Debian']['number'], entries['Debian (Reserve)']['number']])
        codes = [e['code'] for e in events.listing(self.config.state_dir)['events']]
        self.assertEqual(codes, ['BootEntriesMoved'])
        with open(os.path.join(self.config.state_dir, 'audit.log')) as handle:
            methods = [json.loads(line)['method'] for line in handle]
        self.assertEqual(methods[-1], 'BootLayout')
        self.assertIn('BootRepair', methods)
        # Once more: nothing to do.
        self.fake.log.clear()
        again = bootlayout.migrate(self.host, self.config)
        self.assertTrue(again['ok'])
        self.assertTrue(all(step.get('already') for step in again['steps'][:4]), again['steps'])
        self.assertEqual(len(self.runner.called('/usr/sbin/grub-install')), 1)
        self.assertEqual(len(self.runner.called('/usr/sbin/debconf-set-selections')), 1)
        self.assertEqual(self.fake.log, [])

    def test_a_machine_already_on_debian_only_gets_the_debconf_answer(self):
        # Kingston after f452afc7: EFI/debian verified, EFI/BOOT the same binaries.
        self.assertTrue(bootlayout.migrate(self.host, self.config)['ok'])
        self.debconf['grub2/force_efi_extra_removable'] = 'false'
        result = bootlayout.migrate(self.host, self.config)
        steps = {step['step']: step for step in result['steps']}
        self.assertEqual(steps['debconf']['set'], {'grub2/force_efi_extra_removable': 'true'})
        self.assertTrue(steps['grubInstall']['already'] and steps['removablePath']['already'])
        self.assertEqual(len(self.runner.called('/usr/sbin/grub-install')), 1)

    def test_an_old_removable_path_is_reinstalled_and_a_fallback_removed(self):
        self.assertTrue(bootlayout.migrate(self.host, self.config)['ok'])
        self.package_update()  # apt updated shim and GRUB; the postinst ran without EFI/BOOT
        self.write('/boot/efi/EFI/debian/shimx64.efi', 'shim-16.1')
        self.write('/boot/efi/EFI/debian/grubx64.efi', 'grub-2.14')
        root = bootlayout.root_filesystem(self.host, self.devices)
        self.assertEqual(bootlayout.removable_state(self.host, '/boot/efi', self.config.storage, root)['state'],
                         'differs')
        self.write('/boot/efi/EFI/BOOT/fbx64.efi', 'fb-15.8')
        os.unlink(self.host.path('/boot/efi/EFI/BOOT/grub.cfg'))
        result = bootlayout.migrate(self.host, self.config)
        self.assertTrue(result['ok'], result)
        steps = {step['step']: step for step in result['steps']}
        self.assertIn('EFI/BOOT/BOOTX64.EFI differs', steps['grubInstall']['because'])
        self.assertEqual(steps['removablePath']['fix'], [
            'remove EFI/BOOT/fbx64.efi', 'write EFI/BOOT/grub.cfg from EFI/debian/grub.cfg'])
        for mount in ('/boot/efi', '/boot/efi2'):
            self.assertEqual(self.read(f'{mount}/EFI/BOOT/BOOTX64.EFI'), 'shim-16.1')
            self.assertEqual(self.read(f'{mount}/EFI/BOOT/grubx64.efi'), 'grub-2.14')
            self.assertEqual(self.read(f'{mount}/EFI/BOOT/grub.cfg'), STUB)
            self.assertFalse(os.path.exists(self.host.path(f'{mount}/EFI/BOOT/fbx64.efi')))

    def test_the_removable_path_states(self):
        root = bootlayout.root_filesystem(self.host, self.devices)

        def state():
            return bootlayout.removable_state(self.host, '/boot/efi', self.config.storage, root)['state']
        # Before the change EFI/BOOT is compared with EFI/helena-raid (the complete folder).
        self.assertEqual(state(), 'ok')
        self.write('/boot/efi/EFI/BOOT/grub.cfg', STUB.replace(ROOT_UUID, 'x'))
        self.assertEqual(state(), 'stub')
        self.write('/boot/efi/EFI/BOOT/grub.cfg', STUB)
        self.write('/boot/efi/EFI/BOOT/fbx64.efi', 'fb')
        self.assertEqual(state(), 'fallback')
        self.write('/boot/efi/EFI/BOOT/mmx64.efi', 'mm-old')
        self.assertEqual(state(), 'differs')  # old binaries first: they decide the reinstall
        os.unlink(self.host.path('/boot/efi/EFI/BOOT/BOOTX64.EFI'))
        self.assertEqual(state(), 'missing')
        shutil.rmtree(self.host.path('/boot/efi/EFI/helena-raid'))
        self.assertEqual(state(), 'unknown')
        # StorageStatus carries it per mounted ESP.
        self.runner.on('/usr/bin/smartctl', out=fixture('smart-nvme-samsung.json'), rc=4)
        status = storage.status(self.host, self.config.storage, fresh=True, state_dir=self.config.state_dir)
        self.assertEqual([(r['mount'], r['state']) for r in status['esp']['removable']],
                         [('/boot/efi', 'unknown'), ('/boot/efi2', 'ok')])

    def test_it_refuses_a_degraded_or_rebuilding_mirror_and_a_missing_esp(self):
        for degraded, action in ((1, 'idle'), (1, 'recover'), (0, 'resync')):
            with self.subTest(degraded=degraded, action=action):
                self.mirror(degraded, action)
                with self.assertRaises(HostError) as caught:
                    bootlayout.migrate(self.host, self.config, dry_run=True)
                self.assertEqual(caught.exception.code, 'NotAllowed')
        self.mirror()
        self.mounted.pop('/boot/efi2')
        with self.assertRaisesRegex(HostError, '/boot/efi2 is not mounted'):
            bootlayout.migrate(self.host, self.config)
        self.mounted['/boot/efi2'] = 'vfat'
        self.unplug('nvme1n1')
        with self.assertRaises(HostError):
            bootlayout.migrate(self.host, self.config)
        self.assertEqual(self.runner.called('/usr/sbin/grub-install'), [])
        self.assertEqual(self.fake.log, [])

    def test_a_stub_that_would_not_find_the_root_is_moved_aside(self):
        bad = {
            'another uuid': STUB.replace(ROOT_UUID, '00000000-0000-4000-8000-000000000000'),
            'no mduuid hint': STUB.replace(f' mduuid/{ARRAY_UUID}', ''),
            'another array': STUB.replace(ARRAY_UUID, 'f' * 32),
            'another prefix': STUB.replace("'/boot/grub'", "'/grub'"),
        }
        for name, text in bad.items():
            with self.subTest(name):
                self.grub_cfg = text
                result = bootlayout.migrate(self.host, self.config)
                self.assertFalse(result['ok'])
                self.assertEqual(result['failedStep'], 'grubInstall')
                self.assertIn('moved to /boot/efi/EFI/debian-failed-', result['error'])
                self.assertFalse(os.path.exists(self.host.path('/boot/efi/EFI/debian')))
        self.assertEqual(len([n for n in os.listdir(self.host.path('/boot/efi/EFI'))
                              if n.startswith('debian-failed-')]), 4)
        self.assertEqual(self.runner.called('/usr/bin/rsync'), [])
        self.assertEqual(self.fake.log, [])  # the entries were never touched
        # And the repair at the next boot leaves them on EFI/helena-raid.
        self.assertEqual(boot.repair(self.host, self.config)['actions'], [])

    def test_an_unsigned_grub_is_refused(self):
        self.grub_binary = 'grub-built-here'
        result = bootlayout.migrate(self.host, self.config)
        self.assertFalse(result['ok'])
        self.assertIn("grubx64.efi is not Debian's signed image", result['error'])
        self.assertEqual(self.fake.log, [])

    def test_the_rollback_puts_the_entries_back_on_helena_raid(self):
        self.assertTrue(bootlayout.migrate(self.host, self.config)['ok'])
        dry = bootlayout.rollback(self.host, self.config, dry_run=True)
        self.assertEqual([a['op'] for a in dry['steps'][1]['actions']].count('create'), 2)
        self.assertEqual(self.entries()['Debian']['loader'], NEW_LOADER)
        result = bootlayout.rollback(self.host, self.config)
        self.assertTrue(result['ok'], result)
        entries = self.entries()
        self.assertEqual((entries['Debian']['loader'], entries['Debian (Reserve)']['loader']),
                         (OLD_LOADER, OLD_LOADER))
        self.assertEqual(load_config(self.config.path).storage['bootLoader'], OLD_LOADER)
        # The next boot's repair keeps them there (the override is the config now).
        self.assertEqual(boot.repair(self.host, load_config(self.config.path))['actions'], [])
        # And the move again removes the override.
        self.assertTrue(bootlayout.migrate(self.host, self.config)['ok'])
        self.assertEqual(load_config(self.config.path).storage['bootLoader'], NEW_LOADER)
        self.assertEqual(self.entries()['Debian']['loader'], NEW_LOADER)

    def test_no_rollback_without_a_complete_helena_raid(self):
        os.unlink(self.host.path('/boot/efi2/EFI/helena-raid/grub.cfg'))
        with self.assertRaisesRegex(HostError, 'EFI/helena-raid is not complete on /boot/efi2'):
            bootlayout.rollback(self.host, self.config, dry_run=True)

    def test_the_stub_check_follows_a_separate_boot_partition(self):
        root = {'target': '/boot', 'source': '/dev/nvme0n1p3', 'uuid': 'abcd', 'md': False, 'arrayUuid': None}
        stub = "search.fs_uuid abcd root hd0,gpt3\nset prefix=($root)'/grub'\nconfigfile $prefix/grub.cfg\n"
        self.assertIsNone(bootlayout.check_grub_cfg(stub, root))
        self.assertEqual(bootlayout.check_grub_cfg(stub.replace("'/grub'", "'/boot/grub'"), root),
                         'grub.cfg sets another prefix')
        self.assertEqual(bootlayout.check_grub_cfg('', root), 'grub.cfg is missing')


# ── Configuration ────────────────────────────────────────────────────────────────────────

class LayoutConfigTests(HostTest):
    def load(self, storage_config: dict):
        path = os.path.join(self.root, 'hostd.json')
        with open(path, 'w') as handle:
            json.dump({'storage': storage_config}, handle)
        return load_config(path)

    def test_defaults_and_refusals(self):
        config = self.load({})
        self.assertEqual(config.storage['mainBootLabel'], 'Debian')
        self.assertEqual(config.storage['bootLoader'], NEW_LOADER)
        self.assertEqual(boot.loaders(config.storage), (NEW_LOADER, [OLD_LOADER]))
        self.assertEqual(boot.loaders({**config.storage, 'bootLoader': OLD_LOADER}), (OLD_LOADER, [NEW_LOADER]))
        for bad in ({'mainBootLabel': 'Debian (Reserve)'}, {'bootLoader': '/EFI/x.efi'},
                    {'bootLoader': '\\EFI\\..\\x.efi'}, {'espMounts': ['/boot/efi', '/boot/efi']},
                    {'espMounts': ['boot/efi']}, {'reserveBootLabel': ''}, {'legacyBootLoaders': 'x'},
                    {'legacyBootLoaders': ['/EFI/x.efi']}):
            with self.subTest(bad=bad), self.assertRaises(HostError):
                self.load(bad)

    def test_an_override_is_written_and_removed_keeping_the_rest(self):
        config = self.load({'mainBootLabel': 'Debian'})
        with open(config.path) as handle:
            raw = json.load(handle)
        raw['callers'] = ['volition-plan']
        with open(config.path, 'w') as handle:
            json.dump(raw, handle)
        write_storage_override(config, {'bootLoader': OLD_LOADER})
        self.assertEqual(config.storage['bootLoader'], OLD_LOADER)
        self.assertEqual(load_config(config.path).storage['bootLoader'], OLD_LOADER)
        write_storage_override(config, {'bootLoader': None, 'mainBootLabel': None})
        with open(config.path) as handle:
            self.assertEqual(json.load(handle), {'callers': ['volition-plan']})
        self.assertEqual(config.storage['bootLoader'], NEW_LOADER)
        with self.assertRaises(HostError):
            write_storage_override(config, {'bootLoader': '../x'})


# ── NVMe power rules ─────────────────────────────────────────────────────────────────────

class NvmePowerTests(HostTest):
    def sysfs(self):
        """A fake /sys: an NVMe function behind a root port, and its controller + namespace."""
        root = os.path.join(self.root, 'sys')
        port = os.path.join(root, 'devices/pci0000:00/0000:00:03.1')
        function = os.path.join(port, '0000:c5:00.0')
        controller = os.path.join(function, 'nvme/nvme1')
        for directory, klass in ((port, '0x060400'), (function, '0x010802')):
            os.makedirs(os.path.join(directory, 'power'), exist_ok=True)
            with open(os.path.join(directory, 'class'), 'w') as handle:
                handle.write(klass + '\n')
            with open(os.path.join(directory, 'power/control'), 'w') as handle:
                handle.write('auto\n')
        os.makedirs(os.path.join(controller, 'power'))
        os.makedirs(os.path.join(controller, 'nvme1n1'))
        os.makedirs(os.path.join(root, 'class/nvme'))
        os.symlink(os.path.join(root, 'class/nvme'), os.path.join(controller, 'subsystem'))
        with open(os.path.join(controller, 'power/pm_qos_latency_tolerance_us'), 'w') as handle:
            handle.write('100000\n')
        return root, port, function, controller

    def helper(self, root: str, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(['sh', os.path.join(HOOKS, 'helena-nvme-pm'), *args],
                              env={'HELENA_SYSFS': root, 'PATH': os.environ.get('PATH', '/usr/bin:/bin')},
                              capture_output=True, text=True, check=False)

    def test_the_helper_keeps_the_root_port_and_the_controller_awake(self):
        root, port, function, controller = self.sysfs()
        done = self.helper(root, 'pci', '/devices/pci0000:00/0000:00:03.1/0000:c5:00.0')
        self.assertEqual(done.returncode, 0, done.stderr)
        with open(os.path.join(port, 'power/control')) as handle:
            self.assertEqual(handle.read(), 'on')
        with open(os.path.join(function, 'power/control')) as handle:
            self.assertEqual(handle.read(), 'auto\n')  # the function itself is the rule's ATTR
        done = self.helper(root, 'namespace', '/devices/pci0000:00/0000:00:03.1/0000:c5:00.0/nvme/nvme1/nvme1n1')
        self.assertEqual(done.returncode, 0, done.stderr)
        with open(os.path.join(controller, 'power/pm_qos_latency_tolerance_us')) as handle:
            self.assertEqual(handle.read(), '0')

    def test_the_helper_refuses_odd_paths(self):
        root, *_ = self.sysfs()
        for args in (('pci', '/etc/passwd'), ('pci', '/devices/../../etc'), ('reboot', '/devices/x')):
            with self.subTest(args=args):
                self.assertEqual(self.helper(root, *args).returncode, 2)

    def test_the_rules_cover_apst_d3cold_and_runtime_pm(self):
        with open(os.path.join(HOOKS, '60-helena-nvme.rules')) as handle:
            rules = handle.read()
        logical = re.sub(r'\\\n\s*', '', rules)
        lines = [line for line in logical.splitlines() if line and not line.startswith('#')]
        joined = '\n'.join(lines)
        self.assertIn('ATTR{power/pm_qos_latency_tolerance_us}="0"', joined)
        self.assertIn('ATTR{parameters/default_ps_max_latency_us}="0"', joined)
        pci = next(line for line in lines if 'SUBSYSTEM=="pci"' in line)
        for part in ('ATTR{class}=="0x010802"', 'ATTR{d3cold_allowed}="0"', 'ATTR{power/control}="on"',
                     'helena-nvme-pm pci %p'):
            self.assertIn(part, pci)
        self.assertNotIn('aspm', joined.lower())
        self.assertTrue(os.access(os.path.join(HOOKS, 'helena-nvme-pm'), os.X_OK))
        self.assertTrue(os.access(os.path.join(HOOKS, 'helena-esp-sync'), os.X_OK))


class InstallerTests(unittest.TestCase):
    def test_the_installer_puts_every_piece_in_place_and_removes_it(self):
        with open(os.path.join(HERE, '..', 'install.sh')) as handle:
            script = handle.read()
        install, uninstall = script.split('\nuninstall)', 1)
        for piece in ('60-helena-nvme.rules', '99helena-esp-sync', 'helena-esp-sync', 'helena-nvme-pm',
                      'helena-boot-entries.service', 'udevadm control --reload',
                      '--subsystem-match=pci --attr-match=class=0x010802',
                      # a module is a "subsystem" to udevadm trigger, not a device
                      '--type=subsystems --action=change --subsystem-match=module --sysname-match=nvme_core'):
            self.assertIn(piece, install)
        self.assertIn('/etc/apt/apt.conf.d/99helena-esp-sync', install)
        for piece in ('$UDEV_RULE', '$APT_HOOK', 'helena-boot-entries.service'):
            self.assertIn(piece, uninstall)
        # Enabled for the next boot, never started by the installer.
        self.assertNotRegex(install, r'(enable --now|start) helena-boot-entries')
        # The layout change runs the installed helper as root, its dry run too.
        layout = install.split('\nboot-layout)', 1)[1].split(';;', 1)[0]
        self.assertIn('[ "$(id -u)" = 0 ]', layout)
        self.assertIn('helena-hostd" boot-layout --dry-run $rollback', layout)
        self.assertIn('systemctl try-restart helena-hostd.service', layout)
        with open(os.path.join(HERE, '..', 'systemd', 'helena-boot-entries.service')) as handle:
            unit = handle.read()
        self.assertIn('ConditionPathExists=/sys/firmware/efi', unit)
        self.assertIn('DefaultDependencies=no', unit)
        self.assertIn('After=sysinit.target local-fs.target boot-efi.mount boot-efi2.mount', unit)
        self.assertIn('helena-hostd boot-repair', unit)


if __name__ == '__main__':
    unittest.main()
