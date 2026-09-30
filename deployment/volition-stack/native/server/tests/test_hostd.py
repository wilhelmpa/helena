"""Tests of helena-hostd with fakes for mdadm's sysfs, smartctl, lsblk, efibootmgr, the EC
driver, hwmon, power-profiles-daemon, ryzenadj and restic. Run:

    python3 -m unittest discover -s deployment/volition-stack/native/server/tests -v
"""

from __future__ import annotations

import json
import fcntl
import os
import shutil
import socket
import sys
import tempfile
import threading
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'hostd'))

from helena_host import backup, events, guard, owner_sudo, power, service, storage, system  # noqa: E402
from helena_host.common import CommandResult, Host, HostError  # noqa: E402
from helena_host.config import (Config, DEFAULT_CONFIG, _merge, load_settings, on_calendar,  # noqa: E402
                                save_settings, validate_retention, validate_schedule)
from helena_host.varlink import Server, VarlinkError, call  # noqa: E402

FIXTURES = os.path.join(HERE, 'fixtures')


def fixture(name: str) -> str:
    with open(os.path.join(FIXTURES, name), encoding='utf-8') as handle:
        return handle.read()


class FakeRunner:
    """Answers commands by their argv prefix and records every call."""

    def __init__(self):
        self.answers: list[tuple[tuple[str, ...], object]] = []
        self.calls: list[list[str]] = []
        self.kwargs: list[dict] = []

    def on(self, *prefix: str, rc: int = 0, out: str = '', err: str = '', fn=None):
        self.answers.insert(0, (prefix, fn or CommandResult(rc, out, err)))
        return self

    def __call__(self, argv, **kwargs):
        self.calls.append(list(argv))
        self.kwargs.append(kwargs)
        for prefix, answer in self.answers:
            if tuple(argv[:len(prefix)]) == prefix:
                result = answer(argv, **kwargs) if callable(answer) else answer
                if kwargs.get('stdout_path') and result.stdout:
                    with open(kwargs['stdout_path'], 'w', encoding='utf-8') as out:
                        out.write(result.stdout)
                elif kwargs.get('stdout_path'):
                    open(kwargs['stdout_path'], 'w').close()
                return result
        return CommandResult(127, '', f'no fake for {argv}')

    def called(self, *prefix: str) -> list[list[str]]:
        return [argv for argv in self.calls if tuple(argv[:len(prefix)]) == prefix]


class HostTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='hostd-test-')
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.runner = FakeRunner()
        self.clock = [1_790_000_000.0]
        self.sleeps: list[float] = []
        self.programs = {name: f'/usr/bin/{name}' for name in (
            'lsblk', 'smartctl', 'efibootmgr', 'findmnt', 'powerprofilesctl', 'systemctl', 'restic',
            'systemd-run', 'runuser', 'psql', 'pg_dump', 'pg_dumpall', 'pg_restore', 'createdb', 'dropdb')}
        self.programs['ryzenadj'] = '/usr/local/sbin/ryzenadj'
        self.host = Host(root=self.root, run=self.runner, now=lambda: self.clock[0],
                         sleep=self.sleeps.append, programs=self.programs)
        state = os.path.join(self.root, 'state')
        self.config = Config(_merge(DEFAULT_CONFIG, {
            'stateDir': state,
            'runDir': os.path.join(self.root, 'run'),
            'backup': {
                'repository': os.path.join(self.root, 'repo'),
                'passwordFile': os.path.join(self.root, 'etc-helena', 'restic.password'),
                'cacheDir': os.path.join(self.root, 'cache'),
                'stagingDir': os.path.join(self.root, 'staging'),
                'restoreDir': os.path.join(self.root, 'restores'),
                'paths': [os.path.join(self.root, 'data')],
            },
        }), os.path.join(self.root, 'hostd.json'))

    def write(self, absolute: str, value: str) -> None:
        path = self.host.path(absolute)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(value)

    def read(self, absolute: str) -> str:
        with open(self.host.path(absolute), encoding='utf-8') as handle:
            return handle.read()

    def link(self, absolute: str, target: str) -> None:
        path = self.host.path(absolute)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.lexists(path):
            os.symlink(target, path)


# ── Storage ──────────────────────────────────────────────────────────────────────────────

class OwnerSudoTests(HostTest):
    def test_enable_revoke_and_restore_on_validation_failure(self):
        self.write('/etc/sudoers', 'root ALL=(ALL:ALL) ALL\n')
        os.makedirs(self.host.path('/etc/sudoers.d'), exist_ok=True)
        self.runner.on('/usr/sbin/visudo', rc=0)
        self.assertEqual(owner_sudo.status(self.host), {'enabled': False})
        self.assertEqual(owner_sudo.set_enabled(self.host, True), {'enabled': True})
        self.assertEqual(self.read(owner_sudo.PATH).encode(), owner_sudo.RULE)
        self.assertEqual(os.stat(self.host.path(owner_sudo.PATH)).st_mode & 0o777, 0o440)
        self.assertEqual(owner_sudo.set_enabled(self.host, False), {'enabled': False})
        self.assertFalse(self.host.exists(owner_sudo.PATH))
        self.assertTrue(self.host.exists(owner_sudo.DISABLED))
        self.runner.on('/usr/sbin/visudo', '-c', rc=1)
        with self.assertRaises(HostError):
            owner_sudo.set_enabled(self.host, True)
        self.assertFalse(self.host.exists(owner_sudo.PATH))
        self.assertTrue(self.host.exists(owner_sudo.DISABLED))

    def test_revoke_refuses_legacy_owner_rule(self):
        os.makedirs(self.host.path('/etc/sudoers.d'), exist_ok=True)
        self.write(owner_sudo.PATH, owner_sudo.RULE.decode())
        self.write(owner_sudo.LEGACY, owner_sudo.RULE.decode())
        with self.assertRaises(HostError):
            owner_sudo.set_enabled(self.host, False)
        self.assertTrue(self.host.exists(owner_sudo.PATH))


class StorageTests(HostTest):
    def md(self, action='recover', degraded='1', completed='1033942400 / 3902568576', mismatch='0'):
        base = '/sys/block/md127/md'
        self.write(f'{base}/level', 'raid1\n')
        self.write(f'{base}/raid_disks', '2\n')
        self.write(f'{base}/degraded', f'{degraded}\n')
        self.write(f'{base}/sync_action', f'{action}\n')
        self.write(f'{base}/sync_completed', f'{completed}\n')
        self.write(f'{base}/sync_speed', '162076\n')
        self.write(f'{base}/mismatch_cnt', f'{mismatch}\n')
        self.write(f'{base}/array_state', 'clean\n')
        self.write(f'{base}/dev-nvme1n1p2/state', 'in_sync\n')
        self.write(f'{base}/dev-nvme1n1p2/slot', '0\n')
        self.write(f'{base}/dev-nvme0n1p2/state', 'spare\n')
        self.write(f'{base}/dev-nvme0n1p2/slot', 'none\n')
        self.link('/dev/md/helena-root', '../md127')

    def test_a_rebuilding_array_is_attention_with_progress(self):
        self.md()
        [array] = storage.read_arrays(self.host)
        self.assertEqual(array['name'], 'helena-root')
        self.assertEqual(array['syncAction'], 'recover')
        self.assertEqual(array['syncPercent'], 26.5)
        self.assertGreater(array['syncRemainingSeconds'], 8000)
        self.assertEqual(storage.array_health(array), 'attention')
        self.assertEqual(array['members'][0]['device'], 'nvme1n1p2')

    def test_degraded_without_a_rebuild_is_critical(self):
        self.md(action='idle', completed='none')
        [array] = storage.read_arrays(self.host)
        self.assertEqual(storage.array_health(array), 'critical')

    def test_mismatches_after_a_check_need_attention(self):
        self.md(action='idle', degraded='0', completed='none', mismatch='128')
        [array] = storage.read_arrays(self.host)
        self.assertEqual(storage.array_health(array), 'attention')

    def test_a_check_starts_only_on_a_healthy_idle_array(self):
        self.md()
        with self.assertRaises(HostError) as caught:
            storage.start_check(self.host, 'helena-root')
        self.assertEqual(caught.exception.code, 'NotAllowed')
        self.md(action='idle', degraded='0', completed='none')
        storage.start_check(self.host, 'helena-root')
        self.assertEqual(self.read('/sys/block/md127/md/sync_action'), 'check')

    def test_a_rebuild_is_never_stopped(self):
        self.md()
        with self.assertRaises(HostError):
            storage.stop_check(self.host, 'md127')
        self.md(action='check', degraded='0')
        storage.stop_check(self.host, 'md127')
        self.assertEqual(self.read('/sys/block/md127/md/sync_action'), 'idle')

    def test_array_names_are_validated(self):
        with self.assertRaises(HostError) as caught:
            storage.start_check(self.host, '../../etc')
        self.assertEqual(caught.exception.code, 'InvalidParameter')

    def test_smart_of_a_healthy_nvme(self):
        data = json.loads(fixture('smart-nvme-samsung.json'))
        facts = storage.parse_smart(data)
        self.assertTrue(facts['passed'])
        self.assertFalse(facts['failing'])  # exit status 4: the self-test log read failed
        self.assertEqual(facts['wearPercent'], 1)
        self.assertEqual(facts['temperatureC'], 49)
        self.assertEqual(facts['powerOnHours'], data['power_on_time']['hours'])
        self.assertEqual(facts['dataWrittenBytes'],
                         data['nvme_smart_health_information_log']['data_units_written'] * 512000)
        self.assertFalse(facts['selfTestSupported'])
        self.assertEqual(storage.disk_health(facts), 'ok')

    def test_smart_health_levels(self):
        base = storage.parse_smart(json.loads(fixture('smart-nvme-samsung.json')))
        self.assertEqual(storage.disk_health({**base, 'failing': True}), 'critical')
        self.assertEqual(storage.disk_health({**base, 'availableSpare': 5}), 'critical')
        self.assertEqual(storage.disk_health({**base, 'mediaErrors': 3}), 'attention')
        self.assertEqual(storage.disk_health({**base, 'wearPercent': 95}), 'attention')
        self.assertEqual(storage.disk_health({**base, 'temperatureC': 75}), 'attention')
        self.assertEqual(storage.disk_health(None), 'unknown')
        failing = json.loads(fixture('smart-nvme-samsung.json'))
        failing['smartctl']['exit_status'] = 8
        self.assertTrue(storage.parse_smart(failing)['failing'])

    def test_disks_get_their_letters_and_arrays(self):
        self.md()
        self.runner.on('/usr/bin/lsblk', out=fixture('lsblk.json'))
        self.runner.on('/usr/bin/smartctl', out=fixture('smart-nvme-samsung.json'), rc=4)
        storage._smart_cache.clear()
        arrays = storage.read_arrays(self.host)
        disks = storage.read_disks(self.host, DEFAULT_CONFIG['storage'], arrays)
        self.assertEqual([disk['letter'] for disk in disks], ['A', 'B'])
        self.assertEqual(disks[0]['arrays'], ['helena-root'])
        self.assertIn('/boot/efi', disks[0]['mountpoints'])
        self.assertEqual(disks[0]['health'], 'ok')

    def test_boot_entries_and_the_reserve_boot(self):
        self.runner.on('/usr/bin/efibootmgr', out=fixture('efibootmgr.txt'))
        boot = storage.parse_efibootmgr(fixture('efibootmgr.txt'))
        self.assertEqual(boot['order'], ['000F', '001A'])
        self.assertEqual(boot['entries'][1]['label'], 'Debian (Reserve)')
        self.assertEqual(boot['entries'][1]['partuuid'], '9da3b062-2afc-42d2-9cbb-6c9128eae4a9')
        storage.set_boot_next_reserve(self.host, 'Debian (Reserve)')
        self.assertEqual(self.runner.called('/usr/bin/efibootmgr', '--bootnext'),
                         [['/usr/bin/efibootmgr', '--bootnext', '001A']])
        with self.assertRaises(HostError):
            storage.set_boot_next_reserve(self.host, 'Nope')

    def test_esps_in_and_out_of_sync(self):
        for mount in ('/boot/efi', '/boot/efi2'):
            self.write(f'{mount}/EFI/helena-raid/shimx64.efi', 'shim')
            self.write(f'{mount}/EFI/helena-raid/grub.cfg', 'cfg')
            os.utime(self.host.path(f'{mount}/EFI/helena-raid/shimx64.efi'), (1000, 1000))
            os.utime(self.host.path(f'{mount}/EFI/helena-raid/grub.cfg'), (1000, 1000))
        self.runner.on('/usr/bin/findmnt', out='{"filesystems":[{"target":"x","source":"/dev/x"}]}')
        esp = storage.read_esps(self.host, ['/boot/efi', '/boot/efi2'], fresh=True)
        self.assertTrue(esp['inSync'])
        self.write('/boot/efi2/EFI/helena-raid/grub.cfg', 'changed config')
        esp = storage.read_esps(self.host, ['/boot/efi', '/boot/efi2'], fresh=True)
        self.assertFalse(esp['inSync'])
        self.assertEqual(esp['differences'], ['EFI/helena-raid/grub.cfg'])


# ── Power ────────────────────────────────────────────────────────────────────────────────

RYZENADJ_INFO = """CPU Family: Strix Halo
SMU BIOS Interface Version: 26
Version: v0.17.0
PM Table Version: 64020c
|        Name         |   Value   |     Parameter      |
|---------------------|-----------|--------------------|
| STAPM LIMIT         |    85.000 | stapm-limit        |
| STAPM VALUE         |    11.230 |                    |
| PPT LIMIT FAST      |   120.000 | fast-limit         |
| PPT VALUE FAST      |    14.100 |                    |
| PPT LIMIT SLOW      |   120.000 | slow-limit         |
| PPT VALUE SLOW      |    12.000 |                    |
| THM LIMIT CORE      |   100.000 | tctl-temp          |
| THM VALUE CORE      |    52.125 |                    |
"""


class PowerTests(HostTest):
    def ec(self, board='AXB35-02'):
        self.write('/sys/class/dmi/id/board_name', f'{board}\n')
        root = '/sys/class/ec_su_axb35'
        self.write(f'{root}/apu/power_mode', 'balanced\n')
        self.write(f'{root}/temp1/temp', '55\n')
        self.write(f'{root}/temp1/max', '71\n')
        for index, rpm in ((1, 2100), (2, 2150), (3, 900)):
            self.write(f'{root}/fan{index}/rpm', f'{rpm}\n')
            self.write(f'{root}/fan{index}/mode', 'auto\n')
            self.write(f'{root}/fan{index}/level', '2\n')
        self.write('/sys/class/hwmon/hwmon3/name', 'k10temp\n')
        self.write('/sys/class/hwmon/hwmon3/temp1_input', '58250\n')
        self.write('/sys/class/hwmon/hwmon3/temp1_label', 'Tctl\n')
        self.write('/sys/class/hwmon/hwmon1/name', 'nvme\n')
        self.write('/sys/class/hwmon/hwmon1/temp1_input', '49850\n')
        self.write('/sys/class/hwmon/hwmon1/temp1_label', 'Composite\n')
        self.write('/sys/class/hwmon/hwmon1/temp2_input', '83850\n')
        self.write('/sys/class/hwmon/hwmon1/temp2_label', 'Sensor 1\n')

    def test_the_ec_is_read_and_the_fans_summarised(self):
        self.ec()
        ec = power.read_ec(self.host, DEFAULT_CONFIG['power'])
        self.assertEqual(ec['powerMode'], 'balanced')
        self.assertEqual([fan['rpm'] for fan in ec['fans']], [2100, 2150, 900])
        self.assertEqual(ec['fans'][2]['role'], 'system')
        self.assertEqual(power.fans_summary(ec), {'mode': 'auto', 'level': None})
        self.assertEqual(power.cpu_temperature(self.host, DEFAULT_CONFIG['power']), 58.2)

    def test_status_reports_expected_fan_module_and_unreadable_rpm(self):
        self.ec()
        self.write('/etc/modules-load.d/helena-fan-control.conf', 'ec_su_axb35\n')
        os.makedirs(self.host.path('/sys/module/ec_su_axb35'))
        os.remove(self.host.path('/sys/class/ec_su_axb35/fan2/rpm'))
        status = power.status(self.host, DEFAULT_CONFIG['power'], {'power': {}, 'guard': {}}, None)
        self.assertTrue(status['fanControlExpected'])
        self.assertTrue(status['fanModuleLoaded'])
        self.assertIsNone(status['ec']['fans'][1]['rpm'])

    def test_another_board_never_gets_the_ec(self):
        self.ec(board='SomethingElse')
        self.assertIsNone(power.read_ec(self.host, DEFAULT_CONFIG['power']))
        self.assertFalse(power.ec_available(self.host, DEFAULT_CONFIG['power']))

    def test_nvme_sensors_other_than_composite_are_skipped(self):
        self.ec()
        labels = [(s['sensor'], s['label']) for s in power.read_temperatures(self.host)]
        self.assertIn(('nvme', 'Composite'), labels)
        self.assertNotIn(('nvme', 'Sensor 1'), labels)

    def test_fans_fixed_and_auto(self):
        self.ec()
        power.apply_fans(self.host, DEFAULT_CONFIG['power'], 'fixed', 5)
        for index in (1, 2, 3):
            self.assertEqual(self.read(f'/sys/class/ec_su_axb35/fan{index}/mode'), 'fixed')
            self.assertEqual(self.read(f'/sys/class/ec_su_axb35/fan{index}/level'), '5')
        power.apply_fans(self.host, DEFAULT_CONFIG['power'], 'auto', None)
        self.assertEqual(self.read('/sys/class/ec_su_axb35/fan1/mode'), 'auto')
        for mode, level in (('fixed', 0), ('fixed', 6), ('fixed', None), ('auto', 3), ('curve', None), ('fixed', True)):
            with self.assertRaises(HostError):
                power.validate_fans(mode, level)

    def test_a_profile_sets_the_ec_and_the_os_layer(self):
        self.ec()
        self.runner.on('/usr/bin/powerprofilesctl', 'set')
        result = power.set_profile(self.host, DEFAULT_CONFIG['power'], 'saver')
        self.assertEqual(self.read('/sys/class/ec_su_axb35/apu/power_mode'), 'quiet')
        self.assertEqual(self.runner.called('/usr/bin/powerprofilesctl', 'set'),
                         [['/usr/bin/powerprofilesctl', 'set', 'power-saver']])
        self.assertTrue(result['layers']['ec']['ok'])
        self.assertNotIn('ryzenadj', result['layers'])
        with self.assertRaises(HostError):
            power.set_profile(self.host, DEFAULT_CONFIG['power'], 'turbo')

    def test_ryzenadj_overrides_follow_the_mode_and_stay_below_its_limits(self):
        self.ec()
        self.write('/sys/kernel/ryzen_smu_drv/pm_table', '')
        self.runner.on('/usr/bin/powerprofilesctl', 'set')
        self.runner.on('/usr/local/sbin/ryzenadj')
        config = _merge(DEFAULT_CONFIG['power'], {'overrides': {'performance': {'stapm': 100000, 'fast': 130000}}})
        result = power.set_profile(self.host, config, 'performance')
        self.assertEqual(self.sleeps, [1.5])
        self.assertEqual(self.runner.called('/usr/local/sbin/ryzenadj'),
                         [['/usr/local/sbin/ryzenadj', '--stapm-limit=100000', '--fast-limit=130000',
                           '--tctl-temp=90']])
        self.assertTrue(result['layers']['ryzenadj']['ok'])
        with self.assertRaises(HostError):
            power.validate_override('saver', {'stapm': 60000})  # quiet allows 54 W
        with self.assertRaises(HostError):
            power.validate_override('performance', {'fast': 150000})
        with self.assertRaises(HostError):
            power.validate_override('balanced', {'boost': 1})

    def test_ryzenadj_info_is_parsed(self):
        info = power.parse_ryzenadj_info(RYZENADJ_INFO)
        self.assertEqual(info['family'], 'Strix Halo')
        self.assertEqual(info['stapmLimitW'], 85.0)
        self.assertEqual(info['fastLimitW'], 120.0)
        self.assertEqual(info['tctlValueC'], 52.1)

    def test_ryzenadj_needs_the_smu_driver(self):
        self.ec()
        self.assertEqual(power.read_ryzenadj(self.host, DEFAULT_CONFIG['power']),
                         {'available': False, 'reason': 'no_smu_driver'})

    def test_the_active_profile_is_mixed_when_layers_disagree(self):
        self.assertEqual(power.active_profile({'powerMode': 'quiet'}, {'profile': 'power-saver'}), 'saver')
        self.assertEqual(power.active_profile({'powerMode': 'performance'}, {'profile': 'balanced'}), 'mixed')
        self.assertIsNone(power.active_profile(None, None))


class GuardTests(HostTest):
    LIMITS = {'limit': 90, 'holdSeconds': 5, 'releaseBelow': 80, 'releaseSeconds': 120}
    LOW = {'mode': 'fixed', 'level': 1}

    def test_gpu_load_build_marker_and_idle_release(self):
        state, profile = guard.profile_step({}, now=0, gpu_busy=51, build_active=False, mode='auto')
        self.assertEqual(profile, 'balanced')
        state, profile = guard.profile_step(state, now=10, gpu_busy=51, build_active=False, mode='auto')
        self.assertEqual(profile, 'balanced')
        state, profile = guard.profile_step(state, now=11, gpu_busy=51, build_active=False, mode='auto')
        self.assertEqual(profile, 'performance')
        state, profile = guard.profile_step(state, now=12, gpu_busy=0, build_active=False, mode='auto')
        self.assertEqual(profile, 'performance')
        state, profile = guard.profile_step(state, now=311, gpu_busy=0, build_active=False, mode='auto')
        self.assertEqual(profile, 'balanced')
        state, profile = guard.profile_step(state, now=312, gpu_busy=None, build_active=True, mode='auto')
        self.assertEqual(profile, 'performance')
        _, profile = guard.profile_step(state, now=313, gpu_busy=90, build_active=True, mode='balanced')
        self.assertEqual(profile, 'balanced')

    def test_build_slot_ignores_a_stale_owner_marker(self):
        marker_dir = '/run/helena-heavy'
        self.write(f'{marker_dir}/test.1.owner', 'old')
        self.write(f'{marker_dir}/test.1.lock', '')
        self.assertFalse(guard.build_slot_active(self.host, marker_dir))
        with open(self.host.path(f'{marker_dir}/test.1.lock'), 'rb') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertTrue(guard.build_slot_active(self.host, marker_dir))

    def test_fake_sysfs_switches_to_performance_and_applies_temperature_limit(self):
        PowerTests.ec(self)
        self.write('/sys/kernel/ryzen_smu_drv/pm_table', '')
        self.runner.on('/usr/bin/powerprofilesctl', 'set')
        self.runner.on('/usr/local/sbin/ryzenadj')
        self.write('/sys/class/drm/card0/device/gpu_busy_percent', '60')
        worker = guard.Guard(self.host, self.config, lambda _: None)
        worker.tick()
        self.clock[0] += 12
        worker.tick()
        self.assertEqual(self.read('/sys/class/ec_su_axb35/apu/power_mode'), 'performance')
        self.assertIn(['/usr/local/sbin/ryzenadj', '--tctl-temp=90'], self.runner.calls)
        self.write('/sys/class/drm/card0/device/gpu_busy_percent', '0')
        self.clock[0] += 301
        worker.tick()
        self.assertEqual(self.read('/sys/class/ec_su_axb35/apu/power_mode'), 'balanced')

    def test_warning_timer_needs_both_hot_sensors(self):
        PowerTests.ec(self)
        worker = guard.Guard(self.host, self.config, lambda _: None)
        self.write('/sys/class/hwmon/hwmon3/temp1_input', '96000\n')
        worker.tick()
        self.assertIsNone(worker.state.get('thermalWarnSince'))
        self.write('/sys/class/ec_su_axb35/temp1/temp', '96\n')
        worker.tick()
        first = worker.state['thermalWarnSince']
        self.clock[0] += 600
        worker.tick()
        self.assertEqual(worker.state['thermalWarnSince'], first)
        self.write('/sys/class/ec_su_axb35/temp1/temp', '94\n')
        worker.tick()
        self.assertIsNone(worker.state.get('thermalWarnSince'))

    def step(self, state, temperature, now, fans=None):
        return guard.guard_step(state, temperature=temperature, now=now, fans=fans or self.LOW, limits=self.LIMITS)

    def test_hot_for_a_few_seconds_raises_the_fans(self):
        state, action = self.step({}, 92, 0)
        self.assertIsNone(action)
        state, action = self.step(state, 91, 3)
        self.assertIsNone(action)
        state, action = self.step(state, 93, 5)
        self.assertEqual(action, 'engage')
        self.assertTrue(state['active'])

    def test_a_short_spike_does_not(self):
        state, _ = self.step({}, 95, 0)
        state, action = self.step(state, 70, 2)
        state, action = self.step(state, 95, 4)
        self.assertIsNone(action)
        self.assertFalse(state.get('active'))

    def test_the_owners_level_comes_back_after_two_cool_minutes(self):
        state = {'active': True, 'engagedAt': 0}
        state, action = self.step(state, 79, 10)
        state, action = self.step(state, 85, 60)  # warm again: the timer starts over
        self.assertIsNone(action)
        state, action = self.step(state, 75, 70)
        state, action = self.step(state, 74, 189)
        self.assertIsNone(action)
        state, action = self.step(state, 74, 191)
        self.assertEqual(action, 'release')
        self.assertFalse(state['active'])

    def test_auto_and_level_five_need_no_guard(self):
        for fans in ({'mode': 'auto', 'level': None}, {'mode': 'fixed', 'level': 5}, None):
            state, action = guard.guard_step({}, temperature=99, now=100, fans=fans, limits=self.LIMITS)
            self.assertIsNone(action)

    def test_without_any_reading_it_assumes_the_worst(self):
        state, action = self.step({}, None, 0)
        state, action = self.step(state, None, 20)
        self.assertIsNone(action)
        state, action = self.step(state, None, 31)
        self.assertEqual(action, 'engage')
        self.assertEqual(state['reason'], 'blind')

    def test_the_guard_waits_quietly_for_the_driver_and_then_restores(self):
        logs: list[str] = []
        worker = guard.Guard(self.host, self.config, logs.append)
        self.assertEqual(worker.tick(), guard.ABSENT_TICK)
        self.assertEqual(worker.tick(), guard.ABSENT_TICK)
        self.assertEqual(len([line for line in logs if 'not loaded' in line]), 1)
        guard.initial_fans(self.config, 5)
        PowerTests.ec(self)
        self.assertEqual(worker.tick(), guard.TICK)
        self.assertEqual(self.read('/sys/class/ec_su_axb35/fan1/mode'), 'fixed')
        self.assertEqual(self.read('/sys/class/ec_su_axb35/fan3/level'), '5')
        state = power.read_guard_state(self.config.state_dir)
        self.assertTrue(state['available'])

    def test_the_guard_raises_and_records_it(self):
        PowerTests.ec(self)
        settings = load_settings(self.config)
        settings['power']['fans'] = {'mode': 'fixed', 'level': 1}
        save_settings(self.config, settings)
        worker = guard.Guard(self.host, self.config, lambda _: None)
        worker.tick()
        self.write('/sys/class/hwmon/hwmon3/temp1_input', '93000\n')
        worker.tick()
        self.clock[0] += 6
        worker.tick()
        self.assertEqual(self.read('/sys/class/ec_su_axb35/fan2/level'), '5')
        listing = events.listing(self.config.state_dir)
        self.assertEqual(listing['events'][0]['code'], 'FansRaised')
        self.assertTrue(power.read_guard_state(self.config.state_dir)['active'])


# ── System ───────────────────────────────────────────────────────────────────────────────

class SystemTests(HostTest):
    def test_reports_a_preload_in_progress(self):
        self.runner.on('/usr/bin/systemctl', 'show', '--property=ActiveState', '--value',
                       'helena-ai-preload.service', out='activating\n')
        self.assertTrue(system.status(self.host)['localAiPreloadRunning'])

    def test_gpu_eviction_is_a_per_process_rolling_five_minute_delta(self):
        self.programs['amd-smi'] = '/usr/bin/amd-smi'
        self.runner.on('/usr/bin/amd-smi', 'process', '--json', out=json.dumps([
            {'GPU': 0, 'PROCESS_INFO': [{'PID': 42, 'NAME': 'llama', 'EVICTED_TIME': '1 min'}]},
            {'GPU': 1, 'PROCESS_INFO': [{'PID': 42, 'NAME': 'llama', 'EVICTED_TIME': '2 min'}]},
        ]))
        first = system.status(self.host, self.config.state_dir)['gpuProcesses']
        self.assertEqual([item['evictedMs5m'] for item in first], [None, None])
        self.clock[0] += 60
        self.runner.on('/usr/bin/amd-smi', 'process', '--json', out=json.dumps([
            {'GPU': 0, 'PROCESS_INFO': [{'PID': 42, 'NAME': 'llama', 'EVICTED_TIME': '95 s'}]},
            {'GPU': 1, 'PROCESS_INFO': [{'PID': 42, 'NAME': 'llama', 'EVICTED_TIME': '121 s'}]},
        ]))
        second = system.status(self.host, self.config.state_dir)['gpuProcesses']
        self.assertEqual([item['evictedMs5m'] for item in second], [35_000, 1_000])
        self.clock[0] += 301
        third = system.status(self.host, self.config.state_dir)['gpuProcesses']
        self.assertEqual([item['evictedMs5m'] for item in third], [None, None])

    def test_restart_local_ai_queues_shared_maintenance_for_both_servers(self):
        for server_name in ('halogen', 'lemonade'):
            value = {'operation': {'id': 'reset-one', 'phase': 'drain', 'target': {'server': server_name}}}
            with mock.patch.object(service.model_server, 'reset_group', return_value=value) as reset:
                result = service.restart_local_ai(service.Context(self.host, self.config, {}), {})
                self.assertFalse(result['restarted'])
                self.assertEqual(result['maintenance'], value['operation'])
                reset.assert_called_once_with(self.host)
            self.assertEqual(self.runner.called('/usr/bin/systemctl', 'restart'), [])

    def test_the_gpu_split_is_shown_and_is_not_pressure(self):
        self.write('/proc/meminfo', 'MemTotal:       32497680 kB\nMemAvailable:   22181656 kB\n')
        self.write('/proc/pressure/memory', 'some avg10=0.00 avg60=0.00 avg300=0.00 total=1\n'
                                            'full avg10=0.00 avg60=0.00 avg300=0.00 total=1\n')
        self.write('/sys/class/drm/card0/device/mem_info_vram_total', '103079215104\n')
        self.write('/sys/class/drm/card0/device/mem_info_gtt_total', '16638812160\n')
        status = system.status(self.host)
        self.assertEqual(status['gpuMemory']['vramTotalBytes'], 103079215104)
        self.assertEqual(status['memory']['totalBytes'], 32497680 * 1024)
        self.assertFalse(status['memory']['underPressure'])

    def test_dynamic_uma_keeps_system_ram_and_gtt_separate(self):
        self.write('/proc/meminfo', 'MemTotal: 121093750 kB\nMemAvailable: 61000000 kB\n')
        self.write('/sys/class/drm/card0/device/mem_info_vram_total', '536870912\n')
        self.write('/sys/class/drm/card0/device/mem_info_gtt_total', '128849018880\n')
        status = system.status(self.host)
        self.assertEqual(status['memory']['totalBytes'], 121093750 * 1024)
        self.assertEqual(status['gpuMemory']['vramTotalBytes'], 536870912)
        self.assertEqual(status['gpuMemory']['gttTotalBytes'], 128849018880)

    def test_disabled_lemonade_and_running_halogen_are_distinct(self):
        self.runner.on('/usr/bin/systemctl', 'show',
                       '--property=LoadState,UnitFileState,ActiveState', 'lemond.service',
                       out='LoadState=loaded\nUnitFileState=disabled\nActiveState=inactive\n')
        self.runner.on('/usr/bin/systemctl', 'show',
                       '--property=LoadState,UnitFileState,ActiveState', 'helena-halogen.service',
                       out='LoadState=loaded\nUnitFileState=enabled\nActiveState=active\n')
        self.assertEqual(system.status(self.host)['localAiServices'], {
            'lemonade': {'enabled': False, 'active': False},
            'halogen': {'enabled': True, 'active': True},
        })

    def test_pressure_from_low_memory_or_stalls(self):
        self.write('/proc/meminfo', 'MemTotal: 32497680 kB\nMemAvailable: 1000000 kB\n')
        self.assertTrue(system.status(self.host)['memory']['underPressure'])
        self.write('/proc/meminfo', 'MemTotal: 32497680 kB\nMemAvailable: 22181656 kB\n')
        self.write('/proc/pressure/memory', 'some avg10=30.00 avg60=25.00 avg300=1.00 total=1\n')
        self.assertTrue(system.status(self.host)['memory']['underPressure'])


# ── Backup ───────────────────────────────────────────────────────────────────────────────

class BackupTests(HostTest):
    def install(self):
        os.makedirs(os.path.dirname(self.config.backup['passwordFile']), exist_ok=True)
        with open(self.config.backup['passwordFile'], 'w') as handle:
            handle.write('correct-horse-battery\n')
        os.makedirs(self.config.backup['repository'], exist_ok=True)
        open(os.path.join(self.config.backup['repository'], 'config'), 'w').close()

    def vault_snapshot(self, age=0):
        self.install()
        from helena_host.common import iso
        self.runner.on('/usr/bin/restic', 'snapshots', out=json.dumps([
            {'id': 'a' * 64, 'time': iso(self.host.now() - age), 'tags': [backup.TAG]},
        ]))

    def test_vault_integrity_disabled_unavailable_empty_and_stale(self):
        settings = load_settings(self.config)
        settings['backup']['schedule']['frequency'] = 'off'
        save_settings(self.config, settings)
        self.assertEqual(backup.vault_integrity(self.host, self.config), {'state': 'disabled'})
        self.assertEqual(self.runner.calls, [])
        settings['backup']['schedule']['frequency'] = 'hourly'
        save_settings(self.config, settings)
        self.assertEqual(backup.vault_integrity(self.host, self.config), {'state': 'unavailable'})
        self.install()
        self.runner.on('/usr/bin/restic', 'snapshots', out='[]')
        self.assertEqual(backup.vault_integrity(self.host, self.config), {'state': 'no_snapshot'})
        self.vault_snapshot(age=36 * 3600 + 1)
        self.assertEqual(backup.vault_integrity(self.host, self.config), {'state': 'stale'})
        self.assertEqual(self.runner.called('/usr/bin/restic', 'ls'), [])

    def test_vault_integrity_uses_backup_credentials_tag_and_binary_probe(self):
        self.vault_snapshot(age=36 * 3600)
        nodes = [
            {'struct_type': 'snapshot', 'paths': ['/srv/volition']},
            {'struct_type': 'node', 'path': '/srv/volition/vault', 'type': 'dir'},
            {'struct_type': 'node', 'path': '/srv/volition/vault/.git/config', 'type': 'file', 'size': 1},
            {'message_type': 'node', 'path': '/srv/volition/vault/Private/note.bin', 'type': 'file', 'size': 3},
            {'struct_type': 'node', 'path': '/srv/volition/vault/Home/note.md', 'type': 'file', 'size': 20},
        ]
        self.runner.on('/usr/bin/restic', 'ls', out='\n'.join(json.dumps(node) for node in nodes))
        restored_paths = []
        def dump(argv, **kwargs):
            restored_paths.append(kwargs['stdout_path'])
            with open(kwargs['stdout_path'], 'wb') as handle:
                handle.write(b'\x00\xff\x80')
            self.assertEqual(os.stat(os.path.dirname(kwargs['stdout_path'])).st_mode & 0o777, 0o700)
            return CommandResult(0, '', '')
        # This runner keeps the binary file written by dump; FakeRunner normally writes text.
        original_run = self.host.run
        self.host.run = lambda argv, **kwargs: dump(argv, **kwargs) if argv[1] == 'dump' else original_run(argv, **kwargs)
        result = backup.vault_integrity(self.host, self.config)
        self.assertEqual(result, {'state': 'ok', 'vault_present': True,
                                  'private_present': True, 'sample_ok': True})
        self.assertTrue(all(not os.path.exists(path) for path in restored_paths))
        self.assertEqual(self.runner.called('/usr/bin/restic', 'snapshots')[0],
                         ['/usr/bin/restic', 'snapshots', '--json', '--no-lock', '--tag', 'helena'])
        for argv, kwargs in zip(self.runner.calls, self.runner.kwargs):
            if argv[0] == '/usr/bin/restic':
                self.assertEqual(kwargs['env'], backup.restic_env(self.config))
        self.assertNotIn('password', json.dumps(result))

    def test_vault_integrity_accepts_an_empty_private_directory(self):
        self.vault_snapshot()
        for private, present in (('/srv/volition/vault/Private', True),
                                 ('/srv/volition/vault/Private-other', False)):
            with self.subTest(private=private):
                nodes = [
                    {'struct_type': 'node', 'path': '/srv/volition/vault', 'type': 'dir'},
                    {'struct_type': 'node', 'path': private, 'type': 'dir'},
                    {'struct_type': 'node', 'path': '/srv/volition/vault/Home/note.md',
                     'type': 'file', 'size': 3},
                ]
                self.runner.on('/usr/bin/restic', 'ls', out='\n'.join(json.dumps(node) for node in nodes))
                self.runner.on('/usr/bin/restic', 'dump', out='abc')
                self.assertEqual(backup.vault_integrity(self.host, self.config),
                                 {'state': 'ok', 'vault_present': True,
                                  'private_present': present, 'sample_ok': True})

    def test_vault_integrity_coverage_and_restore_failures(self):
        self.vault_snapshot()
        for path, rc, out, expected in (
            ('/srv/volition/vault-other/Private/note.md', 0, 'abc', (False, False, False)),
            ('/srv/volition/vault/Home/note.md', 0, 'ab', (True, False, False)),
            ('/srv/volition/vault/Private/note.md', 1, 'abc', (True, True, False)),
        ):
            with self.subTest(path=path, rc=rc):
                self.runner.on('/usr/bin/restic', 'ls', out=json.dumps(
                    {'struct_type': 'node', 'path': path, 'type': 'file', 'size': 3}))
                self.runner.on('/usr/bin/restic', 'dump', rc=rc, out=out)
                result = backup.vault_integrity(self.host, self.config)
                self.assertEqual((result['vault_present'], result['private_present'], result['sample_ok']), expected)

    def test_vault_integrity_command_errors_are_safe_findings(self):
        self.vault_snapshot()
        for out in ('not json', '[{"id":"aaaaaaaa","time":"bad time"}]'):
            self.runner.on('/usr/bin/restic', 'snapshots', out=out)
            self.assertEqual(backup.vault_integrity(self.host, self.config), {'state': 'error'})
        self.runner.on('/usr/bin/restic', 'snapshots', rc=1, err='sensitive command output')
        self.assertEqual(backup.vault_integrity(self.host, self.config), {'state': 'error'})
        self.vault_snapshot()
        self.runner.on('/usr/bin/restic', 'ls', rc=1)
        self.assertEqual(backup.vault_integrity(self.host, self.config), {'state': 'error'})
        self.runner.on('/usr/bin/restic', 'ls', out='not json')
        self.assertEqual(backup.vault_integrity(self.host, self.config), {'state': 'error'})

    def test_vault_integrity_method_has_no_caller_selected_paths(self):
        dispatcher = service.Dispatcher(self.host, self.config, lambda _: None)
        with mock.patch.object(backup, 'vault_integrity', return_value={'state': 'disabled'}) as check:
            self.assertEqual(dispatcher('VaultBackupIntegrity', {}, {'uid': 0, 'name': 'root'}),
                             {'result': {'state': 'disabled'}})
            check.assert_called_once_with(self.host, self.config)
        for params in ({'path': '/etc'}, {'snapshot': 'latest'}, {'repository': '/tmp/repo'}):
            with self.assertRaises(VarlinkError):
                dispatcher('VaultBackupIntegrity', params, {'uid': 0, 'name': 'root'})

    def test_schedules_and_retention(self):
        self.assertEqual(on_calendar({'frequency': 'hourly', 'time': '03:15'}), '*-*-* *:15:00')
        self.assertEqual(on_calendar({'frequency': 'every6h', 'time': '03:15'}), '*-*-* 03,09,15,21:15:00')
        self.assertEqual(on_calendar({'frequency': 'daily', 'time': '02:30'}), '*-*-* 02:30:00')
        self.assertIsNone(on_calendar({'frequency': 'off', 'time': '02:30'}))
        for bad in ({'frequency': 'minutely'}, {'frequency': 'daily', 'time': '25:00'},
                    {'frequency': 'daily', 'time': '1:00; rm'}, {'frequency': 'daily', 'extra': 1}):
            with self.assertRaises(HostError):
                validate_schedule(bad)
        self.assertEqual(validate_retention({'hourly': 0, 'daily': 7})['daily'], 7)
        for bad in ({'hourly': -1}, {'daily': 1000}, {'yearly': 1},
                    {'hourly': 0, 'daily': 0, 'weekly': 0, 'monthly': 0}, {'daily': '7'}):
            with self.assertRaises(HostError):
                validate_retention(bad)

    def test_timer_next_reads_list_timers_json_and_falls_back_to_show(self):
        # systemd 257: list-timers JSON has the time in microseconds; `show` prints a date.
        self.runner.on('/usr/bin/systemctl', 'list-timers', out=json.dumps([
            {'next': 1790302563789264, 'left': 1790302563789264, 'last': 1790300223052686,
             'passed': 0, 'unit': 'helena-backup.timer', 'activates': 'helena-backup.service'}]))
        self.runner.on('/usr/bin/systemctl', 'show', out='NextElapseUSecRealtime=Fri 2026-09-25 04:16:03 CEST\n')
        self.assertEqual(backup.timer_next(self.host, 'helena-backup.timer'), '2026-09-25T02:16:03Z')
        # A timer that is off: no next time.
        self.runner.on('/usr/bin/systemctl', 'list-timers', out=json.dumps([
            {'next': None, 'left': None, 'last': None, 'passed': None,
             'unit': 'helena-backup.timer', 'activates': 'helena-backup.service'}]))
        self.assertIsNone(backup.timer_next(self.host, 'helena-backup.timer'))
        # An older systemd without JSON output: the unix timestamp of `show`.
        self.runner.on('/usr/bin/systemctl', 'list-timers', rc=1, err='unknown option --output')
        self.runner.on('/usr/bin/systemctl', 'show', out='NextElapseUSecRealtime=@1790302563\n')
        self.assertEqual(backup.timer_next(self.host, 'helena-backup.timer'), '2026-09-25T02:16:03Z')

    def test_settings_write_the_timer_and_switch_it(self):
        self.install()
        result = backup.set_settings(self.host, self.config, {'schedule': {'frequency': 'daily', 'time': '02:30'},
                                                              'restoreTestMonthly': False})
        self.assertEqual(result['schedule']['frequency'], 'daily')
        self.assertIn('OnCalendar=*-*-* 02:30:00', self.read(backup.SCHEDULE_DROPIN))
        self.assertIn(['/usr/bin/systemctl', 'enable', '--now', 'helena-backup.timer'], self.runner.calls)
        self.assertIn(['/usr/bin/systemctl', 'disable', '--now', 'helena-backup-restore-test.timer'],
                      self.runner.calls)
        backup.set_settings(self.host, self.config, {'schedule': {'frequency': 'off', 'time': '02:30'}})
        self.assertIn(['/usr/bin/systemctl', 'disable', '--now', 'helena-backup.timer'], self.runner.calls)

    def test_the_password_is_shown_until_it_is_written_down(self):
        with self.assertRaises(HostError):
            backup.reveal_password(self.config)
        self.install()
        self.assertEqual(backup.password_state(self.config), 'unrevealed')
        self.assertEqual(backup.reveal_password(self.config), {'password': 'correct-horse-battery'})
        self.assertEqual(backup.reveal_password(self.config)['password'], 'correct-horse-battery')
        backup.acknowledge_password(self.config)
        self.assertEqual(backup.password_state(self.config), 'acknowledged')
        with self.assertRaises(HostError) as caught:
            backup.reveal_password(self.config)
        self.assertEqual(caught.exception.code, 'NotAllowed')

    def ls_output(self):
        nodes = [
            {'struct_type': 'snapshot', 'id': 'abc'},
            {'struct_type': 'node', 'name': 'Projekte', 'type': 'dir', 'path': '/home/o/Projekte'},
            {'struct_type': 'node', 'name': 'notes.md', 'type': 'file', 'path': '/home/o/notes.md', 'size': 12},
            {'struct_type': 'node', 'name': 'deep.txt', 'type': 'file', 'path': '/home/o/Projekte/deep.txt'},
        ]
        return '\n'.join(json.dumps(node) for node in nodes)

    def test_a_folder_lists_its_own_entries_folders_first(self):
        self.install()
        self.runner.on('/usr/bin/restic', 'ls', out=self.ls_output())
        listing = backup.list_dir(self.host, self.config, 'abcdef12', '/home/o')
        self.assertEqual([entry['name'] for entry in listing['entries']], ['Projekte', 'notes.md'])
        for bad in ('home/o', '/home/../etc', '/home/./o'):
            with self.assertRaises(HostError):
                backup.list_dir(self.host, self.config, 'abcdef12', bad)
        with self.assertRaises(HostError):
            backup.list_dir(self.host, self.config, 'abc;rm', '/home')

    def test_restoring_in_place_needs_the_path_repeated(self):
        self.install()
        self.runner.on('/usr/bin/restic', 'ls', out=self.ls_output())
        self.runner.on('/usr/bin/systemd-run')
        os.makedirs(self.host.path('/home/o'), exist_ok=True)
        with self.assertRaises(HostError) as caught:
            backup.start_restore(self.host, self.config, {'snapshot': 'abcdef12', 'path': '/home/o/notes.md',
                                                          'mode': 'original'})
        self.assertEqual(caught.exception.code, 'NotAllowed')
        job = backup.start_restore(self.host, self.config, {'snapshot': 'abcdef12', 'path': '/home/o/notes.md',
                                                            'mode': 'original', 'confirm': '/home/o/notes.md'})
        self.assertEqual(job['state'], 'queued')
        [argv] = self.runner.called('/usr/bin/systemd-run')
        self.assertEqual(argv[-3:], ['backup', 'restore', job['id']])
        with self.assertRaises(HostError):
            backup.start_restore(self.host, self.config, {'snapshot': 'abcdef12', 'path': '/home/o/missing'})

    def test_a_copy_of_the_owners_files_lands_in_his_home(self):
        home = os.path.join(self.root, 'home-owner')
        os.makedirs(home)
        self.config.data['backup']['ownerHome'] = home
        account = mock.Mock(pw_uid=os.getuid(), pw_gid=os.getgid(), pw_dir=home)
        with mock.patch.object(backup, '_owner_account', return_value=account):
            target = backup.restore_target(self.config, os.path.join(home, 'Projekte'), '2026-09-24_22-00-00')
        self.assertEqual(target, os.path.join(home, 'Wiederhergestellt', '2026-09-24_22-00-00'))
        self.assertTrue(os.path.isdir(target))
        other = backup.restore_target(self.config, '/etc/nginx', '2026-09-24_22-00-01')
        self.assertTrue(other.startswith(self.config.backup['restoreDir']))

    def test_a_planted_link_is_refused(self):
        home = os.path.join(self.root, 'home-owner')
        os.makedirs(home)
        os.symlink('/etc', os.path.join(home, 'Wiederhergestellt'))
        self.config.data['backup']['ownerHome'] = home
        account = mock.Mock(pw_uid=os.getuid(), pw_gid=os.getgid(), pw_dir=home)
        with mock.patch.object(backup, '_owner_account', return_value=account):
            with self.assertRaises(OSError):
                backup.restore_target(self.config, os.path.join(home, 'x'), 'stamp')

    def test_a_backup_run_dumps_backs_up_forgets_and_records(self):
        self.install()
        os.makedirs(self.host.path('/data'), exist_ok=True)
        os.makedirs(os.path.join(self.root, 'data'), exist_ok=True)
        self.runner.on('/usr/bin/runuser', '-u', 'postgres', '--', '/usr/bin/psql',
                       out='itsaplan\nitsaplan_test\npostgres\n')
        self.runner.on('/usr/bin/runuser', '-u', 'postgres', '--', '/usr/bin/pg_dump', out='DUMP')
        self.runner.on('/usr/bin/runuser', '-u', 'postgres', '--', '/usr/bin/pg_dumpall', out='GLOBALS')
        summary = {'message_type': 'summary', 'snapshot_id': 'f00dbeef', 'files_new': 3, 'files_changed': 1,
                   'total_files_processed': 10, 'total_bytes_processed': 2048, 'data_added': 512}
        self.runner.on('/usr/bin/restic', 'backup', out='{"message_type":"status"}\n' + json.dumps(summary))
        self.runner.on('/usr/bin/restic', 'forget')
        self.runner.on('/usr/bin/restic', 'stats', out='{"total_size": 4096}')
        result = backup.job_backup(self.host, self.config)
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['snapshot'], 'f00dbeef')
        self.assertEqual([d['database'] for d in result['databases']], ['itsaplan', 'postgres'])
        [forget] = self.runner.called('/usr/bin/restic', 'forget')
        self.assertIn('--keep-hourly=24', forget)
        self.assertIn('--keep-monthly=12', forget)
        [run] = self.runner.called('/usr/bin/restic', 'backup')
        self.assertIn(self.config.backup['stagingDir'], run)
        exclude = next(arg for arg in run if arg.startswith('--exclude-file='))[len('--exclude-file='):]
        with open(exclude) as handle:
            patterns = handle.read().splitlines()
        self.assertIn(self.config.backup['repository'], patterns)
        self.assertIn(self.config.backup['passwordFile'], patterns)
        self.assertFalse(os.path.exists(self.config.backup['stagingDir']))
        env = self.runner.kwargs[self.runner.calls.index(run)]['env']
        self.assertEqual(env['RESTIC_PASSWORD_FILE'], self.config.backup['passwordFile'])
        self.assertEqual(backup.history(self.config)[-1]['snapshot'], 'f00dbeef')

    def test_a_failed_run_is_an_event(self):
        self.install()
        self.runner.on('/usr/bin/runuser', '-u', 'postgres', '--', '/usr/bin/psql', out='itsaplan\n')
        self.runner.on('/usr/bin/runuser', '-u', 'postgres', '--', '/usr/bin/pg_dumpall', out='G')
        self.runner.on('/usr/bin/runuser', '-u', 'postgres', '--', '/usr/bin/pg_dump', rc=1, err='connection refused')
        result = backup.job_backup(self.host, self.config)
        self.assertFalse(result['ok'])
        self.assertIn('pg_dump of itsaplan failed', result['error'])
        self.assertEqual(events.listing(self.config.state_dir)['events'][0]['code'], 'BackupFailed')

    def test_offsite_targets_keep_their_secret_root_only(self):
        self.install()
        target = backup.set_target(self.config, {
            'id': 'offsite', 'kind': 's3', 'repository': 's3:https://s3.example.com/bucket/helena',
            'credentials': {'accessKeyId': 'AKIAEXAMPLE', 'secretAccessKey': 'secretsecret123'}})
        self.assertNotIn('credentials', target)
        path = backup.target_env_path(self.config, 'offsite')
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
        for bad in ({'id': 'Bad Id', 'kind': 's3', 'repository': 's3:https://h/b'},
                    {'id': 'x', 'kind': 'ftp', 'repository': 's3:https://h/b'},
                    {'id': 'x', 'kind': 's3', 'repository': 'file:///etc'},
                    {'id': 'new', 'kind': 's3', 'repository': 's3:https://h/b'}):
            with self.assertRaises(HostError):
                backup.set_target(self.config, bad)
        backup.remove_target(self.config, 'offsite')
        self.assertFalse(os.path.exists(path))


# ── Events ───────────────────────────────────────────────────────────────────────────────

class EventTests(HostTest):
    def test_repaired_boot_entries_stay_visible_without_problem_count(self):
        state = self.config.state_dir
        events.record(state, source='boot', severity='warning', code='BootEntryRepaired', device=None, message='Repaired', at=1.0)
        listing = events.listing(state)
        self.assertEqual(listing['unseen'], 0)
        self.assertEqual(listing['events'][0]['code'], 'BootEntryRepaired')
        events.record(state, source='boot', severity='critical', code='BootEntryRepaired', device=None, message='Requires owner', at=2.0)
        self.assertEqual(events.listing(state)['unseenCritical'], 1)
        self.assertEqual(events.listing(state)['unseen'], 1)

    def test_mdadm_and_smartd_events(self):
        self.assertEqual(events.from_mdadm(['Fail', '/dev/md127', '/dev/nvme0n1p2'])['severity'], 'critical')
        self.assertEqual(events.from_mdadm(['Rebuild40', '/dev/md127'])['severity'], 'info')
        self.assertEqual(events.from_mdadm(['DegradedArray', '/dev/md127'])['severity'], 'critical')
        self.assertEqual(events.from_smartd({'SMARTD_FAILTYPE': 'Health', 'SMARTD_DEVICE': '/dev/nvme0'})['severity'],
                         'critical')
        self.assertEqual(events.from_smartd({'SMARTD_FAILTYPE': 'Temperature'})['severity'], 'warning')

    def test_record_list_and_mark_seen(self):
        state = self.config.state_dir
        for code in ('Fail', 'RebuildStarted'):
            events.record(state, at=self.clock[0], **events.from_mdadm([code, '/dev/md127']))
        listing = events.listing(state)
        self.assertEqual(listing['unseen'], 2)
        self.assertEqual(listing['unseenCritical'], 1)
        self.assertEqual(listing['events'][0]['code'], 'RebuildStarted')
        events.mark_seen(state, listing['events'][0]['id'])
        self.assertEqual(events.listing(state)['unseen'], 0)
        events.record(state, source='x', severity='bogus', code='a\x00b' * 40, at=0)
        latest = events.listing(state)['events'][0]
        self.assertEqual(latest['severity'], 'warning')
        self.assertLessEqual(len(latest['code']), 64)


# ── The service ──────────────────────────────────────────────────────────────────────────

class ServiceTests(HostTest):
    def dispatcher(self):
        self.logs: list[str] = []
        return service.Dispatcher(self.host, self.config, self.logs.append)

    def test_only_listed_methods_and_parameters(self):
        dispatch = self.dispatcher()
        with self.assertRaises(VarlinkError) as caught:
            dispatch('Shell', {}, {'name': 'volition-plan'})
        self.assertEqual(caught.exception.error, 'org.varlink.service.MethodNotFound')
        with self.assertRaises(VarlinkError) as caught:
            dispatch('SetFans', {'mode': 'fixed', 'level': 3, 'path': '/etc/shadow'}, {'name': 'x'})
        self.assertEqual(caught.exception.error, 'io.helena.hostd.InvalidParameter')
        with self.assertRaises(VarlinkError):
            dispatch('SetGuard', {'limit': '90'}, {'name': 'x'})
        with self.assertRaises(VarlinkError):
            dispatch('SetGuard', {'limit': 99}, {'name': 'x'})
        with self.assertRaises(VarlinkError):
            dispatch('SetGuard', {'limit': 85, 'actor': 'x' * 200}, {'name': 'x'})
        with self.assertRaises(VarlinkError):
            dispatch('SetPowerPolicy', {'mode': 'turbo'}, {'name': 'x'})
        with self.assertRaises(VarlinkError):
            dispatch('SetPowerPolicy', {'mode': 'performance', 'tctlLimit': 101}, {'name': 'x'})

    def test_changes_are_audited_without_secrets(self):
        dispatch = self.dispatcher()
        BackupTests.install(self)
        dispatch('SetGuard', {'limit': 85, 'actor': 'owner@example.com'}, {'name': 'volition-plan'})
        dispatch('SetBackupTarget', {'id': 'off', 'kind': 's3', 'repository': 's3:https://h.example/b',
                                     'credentials': {'accessKeyId': 'AKIAX123', 'secretAccessKey': 'topsecret99'}},
                 {'name': 'volition-plan'})
        reply = dispatch('RevealBackupPassword', {}, {'name': 'volition-plan'})
        self.assertEqual(reply['result']['password'], 'correct-horse-battery')
        with open(os.path.join(self.config.state_dir, 'audit.log')) as handle:
            audit = handle.read()
        self.assertIn('"actor":"owner@example.com"', audit)
        self.assertNotIn('topsecret99', audit)
        self.assertNotIn('correct-horse-battery', audit)
        self.assertNotIn('topsecret99', '\n'.join(self.logs))
        self.assertEqual(load_settings(self.config)['guard']['releaseBelow'], 80)

    def test_fans_wait_for_the_guard_to_let_go(self):
        dispatch = self.dispatcher()
        PowerTests.ec(self)
        os.makedirs(self.config.state_dir, exist_ok=True)
        with open(os.path.join(self.config.state_dir, 'guard.json'), 'w') as handle:
            json.dump({'active': True}, handle)
        reply = dispatch('SetFans', {'mode': 'fixed', 'level': 2}, {'name': 'x'})['result']
        self.assertFalse(reply['applied'])
        self.assertEqual(self.read('/sys/class/ec_su_axb35/fan1/mode'), 'auto\n')
        reply = dispatch('SetFans', {'mode': 'auto'}, {'name': 'x'})['result']
        self.assertTrue(reply['applied'])
        self.assertEqual(self.read('/sys/class/ec_su_axb35/fan1/mode'), 'auto')

    def test_callers(self):
        dispatch = self.dispatcher()
        self.assertEqual(dispatch.authorize(0), 'root')
        self.config.data['callers'] = []
        self.assertIsNone(dispatch.authorize(os.getuid() or 65534))


@unittest.skipUnless(hasattr(socket, 'SO_PEERCRED'), 'needs Linux peer credentials')
class VarlinkTests(HostTest):
    def test_calls_over_a_unix_socket(self):
        path = os.path.join(self.root, 'hostd.sock')
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(path)
        listener.listen(4)
        self.config.data['callers'] = [__import__('pwd').getpwuid(os.getuid()).pw_name]
        dispatch = service.Dispatcher(self.host, self.config, lambda _: None)
        server = Server(interface=service.INTERFACE, description=service.DESCRIPTION,
                        info={'vendor': 'Helena', 'product': 'helena-hostd', 'version': 'test', 'url': ''},
                        dispatch=dispatch, authorize=dispatch.authorize, log=lambda _: None)
        thread = threading.Thread(target=server.serve, args=(listener,), daemon=True)
        thread.start()
        self.addCleanup(server.stopping.set)
        info = call(path, 'org.varlink.service.GetInfo')
        self.assertIn('io.helena.hostd', info['parameters']['interfaces'])
        description = call(path, 'org.varlink.service.GetInterfaceDescription', {'interface': 'io.helena.hostd'})
        self.assertIn('method SetFans', description['parameters']['description'])
        self.assertIn('method VaultBackupIntegrity()', description['parameters']['description'])
        with mock.patch.object(backup, 'vault_integrity', return_value={'state': 'no_snapshot'}):
            self.assertEqual(call(path, 'io.helena.hostd.VaultBackupIntegrity'),
                             {'parameters': {'result': {'state': 'no_snapshot'}}})
        self.write('/proc/meminfo', 'MemTotal: 1024 kB\nMemAvailable: 512 kB\n')
        reply = call(path, 'io.helena.hostd.SystemStatus')
        self.assertEqual(reply['parameters']['result']['memory']['totalBytes'], 1024 * 1024)
        error = call(path, 'io.helena.hostd.SetGuard', {'limit': 1})
        self.assertEqual(error['error'], 'io.helena.hostd.InvalidParameter')
        self.assertEqual(call(path, 'io.helena.hostd.Nope')['error'], 'org.varlink.service.MethodNotFound')


if __name__ == '__main__':
    unittest.main()
