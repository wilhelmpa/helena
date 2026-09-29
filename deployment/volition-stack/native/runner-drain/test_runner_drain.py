import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('runner-drain.py')
spec = importlib.util.spec_from_file_location('runner_drain', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
TARGET = 'a' * 40


def safe_temp_root():
    # The drain refuses state below group- or world-writable directories (only /tmp itself is
    # exempt), as it must when it runs as root. A TMPDIR under a shared, group-writable folder
    # (the agents' ~/agent-work is 0774) would make every test fail on that guard instead of
    # testing the drain, so use the first candidate whose whole chain passes the same rule.
    for candidate in (tempfile.gettempdir(), os.environ.get('XDG_RUNTIME_DIR'), '/tmp'):
        if not candidate:
            continue
        path = Path(candidate).resolve()
        chain = (path, *path.parents)
        if path.is_dir() and all(part == Path('/tmp') or not part.stat().st_mode & 0o022
                                 for part in chain):
            return str(path)
    return '/tmp'


class FakeSystem:
    def __init__(self, root):
        self.root, self.calls = root, []
        self.head = TARGET
        self.alive = True
        self.start_sources_held = True
        self.leftovers = False
        self.finish_on_stop = True
        self.fail_stop = False
        self.fragment = root / 'unit.service'
        self.fragment.write_text('[Service]\nExecStart=/synthetic/runner\n')
        self.extra = []
        self.snapshot = dict.fromkeys(module.PROPERTIES, '')
        self.snapshot.update(LoadState='loaded', ActiveState='active', SubState='running',
                             MainPID='123', ControlPID='0', InvocationID='1' * 32,
                             ControlGroup='/system.slice/' + module.UNIT, Job='0', Result='success',
                             ExecMainCode='1', ExecMainStatus='0', FragmentPath=str(self.fragment))

    def show(self):
        value = dict(self.snapshot)
        value['DropInPaths'] = ' '.join(map(str, self.extra + ([self.dropin] if self.dropin.exists() else [])))
        value.update(KillSignal='2' if self.dropin.exists() else '15',
                     TimeoutStopUSec='infinity' if self.dropin.exists() else '45s',
                     SendSIGKILL='no' if self.dropin.exists() else 'yes', SendSIGHUP='no', KillMode='mixed')
        return value

    def start_sources_idle(self):
        return self.start_sources_held

    def identity(self, pid):
        return '456'

    def empty_group(self, _group):
        return not self.leftovers

    def finish(self):
        self.snapshot.update(ActiveState='inactive', SubState='dead', MainPID='0', Job='0')

    def run(self, *args):
        self.calls.append(args)
        if args[:2] == ('systemctl', 'stop'):
            if self.fail_stop:
                raise module.Refuse('synthetic uncertain dispatch')
            self.snapshot.update(ActiveState='deactivating', SubState='stop-sigterm', Job='42')
            if self.finish_on_stop:
                self.finish()
        elif args[:2] == ('systemctl', 'start'):
            self.snapshot.update(ActiveState='active', SubState='running', MainPID='124',
                                 InvocationID='2' * 32, Job='0')
            self.capability.write_text(json.dumps(dict(version=1, pid=124, startTicks='456', phase='running')))
        elif args[0] == 'git':
            return self.head
        return ''


class DrainTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='helena-drain-', dir=safe_temp_root())
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.system = FakeSystem(self.root)
        self.state_dir = self.root / 'state'
        self.state_dir.mkdir(mode=0o700)
        self.dropin = self.root / 'unit.d/90-helena-deploy-drain.conf'
        self.system.dropin = self.dropin
        self.capability = self.root / 'status.json'
        self.capability.write_text(json.dumps(dict(version=1, pid=123, startTicks='456', phase='running')))
        self.capability.chmod(0o600)
        self.system.capability = self.capability
        self.live = self.root / 'source'
        self.bundle = self.live / 'packages/runner/dist/cli.js'
        self.bundle.parent.mkdir(parents=True)
        self.bundle.write_text('synthetic bundle')
        self.candidate_unit = self.live / 'deployment/volition-stack/native/systemd' / module.UNIT
        self.candidate_unit.parent.mkdir(parents=True)
        self.candidate_unit.write_bytes(self.system.fragment.read_bytes())
        self.controller = self.new_controller()

    def new_controller(self):
        return module.Drain(self.system, self.state_dir, self.dropin, self.capability,
                            self.live, os.getuid(), os.getuid())

    def stops(self):
        return [call for call in self.system.calls if call[:2] == ('systemctl', 'stop')]

    def test_complete_sequence_preserves_guard_until_natural_completion_and_ready(self):
        self.controller.drain(TARGET, 0)
        self.assertEqual(self.stops(), [('systemctl', 'stop', '--no-block', module.UNIT)])
        self.assertEqual(self.controller.load()['phase'], 'drained')
        self.assertTrue(self.dropin.exists())
        self.assertEqual(self.controller.file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.controller.backup.stat().st_mode & 0o777, 0o600)
        self.controller.ready(TARGET)
        self.controller.activate(TARGET)
        self.assertFalse(self.dropin.exists())
        self.assertEqual(self.controller.load()['phase'], 'complete')
        self.assertEqual(self.system.calls[-1], ('systemctl', 'start', module.UNIT))
        self.assertFalse(any('restart' in call or 'kill' in call for call in self.system.calls))

    def test_deadline_and_retry_never_resend_stop_or_remove_override(self):
        self.system.finish_on_stop = False
        for _ in range(2):
            with self.assertRaisesRegex(module.Refuse, 'Drain still running'):
                self.new_controller().drain(TARGET, 0)
        self.assertEqual(len(self.stops()), 1)
        self.assertTrue(self.dropin.exists())
        self.assertEqual(self.system.snapshot['MainPID'], '123')
        self.system.finish()
        self.new_controller().drain(TARGET, 0)
        self.assertEqual(len(self.stops()), 1)

    def test_runner_exiting_between_show_and_proc_read_still_drains(self):
        self.system.finish_on_stop = False
        seen = []

        def vanishing(pid):
            if self.system.snapshot['ActiveState'] == 'deactivating':
                # systemd still names the PID, /proc no longer has it; systemd catches up next.
                seen.append(pid)
                self.system.finish()
                return None
            return '456'

        self.system.identity = vanishing
        self.controller.drain(TARGET, 5)
        self.assertEqual(seen, ['123'])
        self.assertEqual(self.controller.load()['phase'], 'drained')
        self.assertEqual(len(self.stops()), 1)

    def test_uncertain_dispatch_does_not_retry_signal(self):
        self.system.fail_stop = True
        with self.assertRaisesRegex(module.Refuse, 'uncertain dispatch'):
            self.controller.drain(TARGET, 0)
        self.system.fail_stop = False
        with self.assertRaisesRegex(module.Refuse, 'unconfirmed'):
            self.new_controller().drain(TARGET, 0)
        self.assertEqual(len(self.stops()), 1)
        self.assertEqual(self.controller.load()['phase'], 'stop-requested')

    def test_crash_after_dispatch_reuses_stop_job(self):
        self.system.finish_on_stop = False
        original = self.controller.save
        def save(phase):
            if phase == 'waiting':
                raise module.Refuse('synthetic crash')
            original(phase)
        with patch.object(self.controller, 'save', side_effect=save):
            with self.assertRaisesRegex(module.Refuse, 'synthetic crash'):
                self.controller.drain(TARGET, 0)
        self.system.finish()
        self.new_controller().drain(TARGET, 0)
        self.assertEqual(len(self.stops()), 1)

    def test_foreign_override_and_stale_capability_fail_before_stop(self):
        self.dropin.parent.mkdir(mode=0o755)
        self.dropin.write_text('foreign override')
        with self.assertRaises(module.Refuse):
            self.controller.drain(TARGET, 0)
        self.assertEqual(self.dropin.read_text(), 'foreign override')
        self.dropin.unlink()
        self.capability.write_text(json.dumps(dict(version=1, pid=122, startTicks='456', phase='running')))
        with self.assertRaisesRegex(module.Refuse, 'capability'):
            self.controller.drain(TARGET, 0)
        self.assertEqual(self.stops(), [])

    def test_stale_process_ticks_and_releasing_are_not_capability(self):
        for values in [dict(pid=123, startTicks='old', phase='running'),
                       dict(pid=123, startTicks='456', phase='releasing')]:
            self.capability.write_text(json.dumps(dict(version=1, **values)))
            with self.assertRaisesRegex(module.Refuse, 'capability'):
                self.controller.drain(TARGET, 0)
        self.assertEqual(self.stops(), [])

    def test_residual_cgroup_or_control_job_prevents_ready(self):
        self.system.leftovers = True
        with self.assertRaisesRegex(module.Refuse, 'Drain still running'):
            self.controller.drain(TARGET, 0)
        self.system.leftovers = False
        self.system.snapshot['ControlPID'] = '999'
        with self.assertRaisesRegex(module.Refuse, 'Drain still running'):
            self.controller.drain(TARGET, 0)
        self.assertEqual(len(self.stops()), 1)

    def test_changed_invocation_or_unit_during_wait_is_refused(self):
        self.system.finish_on_stop = False
        with self.assertRaises(module.Refuse):
            self.controller.drain(TARGET, 0)
        self.system.snapshot['InvocationID'] = 'f' * 32
        with self.assertRaisesRegex(module.Refuse, 'invocation changed'):
            self.controller.drain(TARGET, 0)
        self.system.snapshot['InvocationID'] = '1' * 32
        self.system.fragment.write_text('changed unit')
        with self.assertRaisesRegex(module.Refuse, 'Unit files changed'):
            self.controller.drain(TARGET, 0)
        self.assertEqual(len(self.stops()), 1)

    def test_completed_foreign_or_unknown_invocation_never_acknowledges_original_stop(self):
        self.controller.drain(TARGET, 0)
        for invocation in ('f' * 32, ''):
            self.system.snapshot['InvocationID'] = invocation
            with self.assertRaises(module.Refuse):
                self.new_controller().drain(TARGET, 0)
            with self.assertRaises(module.Refuse):
                self.new_controller().ready(TARGET)
        self.system.snapshot['InvocationID'] = '1' * 32
        self.controller.ready(TARGET)
        self.system.snapshot['InvocationID'] = 'f' * 32
        with self.assertRaises(module.Refuse):
            self.new_controller().activate(TARGET)
        self.assertEqual(len(self.stops()), 1)
        self.assertTrue(self.dropin.exists())

    def test_tampered_backup_or_override_is_never_restored(self):
        self.controller.drain(TARGET, 0)
        self.controller.ready(TARGET)
        self.dropin.write_text('foreign replacement')
        with self.assertRaisesRegex(module.Refuse, 'override changed'):
            self.controller.activate(TARGET)
        self.assertEqual(self.dropin.read_text(), 'foreign replacement')
        self.dropin.write_bytes(module.OVERRIDE)
        self.controller.backup.write_text('foreign backup')
        with self.assertRaisesRegex(module.Refuse, 'backup changed'):
            self.controller.activate(TARGET)
        self.assertTrue(self.dropin.exists())

    def test_activation_requires_exact_ready_checkout_bundle_and_unit(self):
        self.controller.drain(TARGET, 0)
        with self.assertRaisesRegex(module.Refuse, 'marked ready'):
            self.controller.activate(TARGET)
        self.system.head = 'b' * 40
        with self.assertRaisesRegex(module.Refuse, 'checkout'):
            self.controller.ready(TARGET)
        self.system.head = TARGET
        self.controller.ready(TARGET)
        self.bundle.write_text('foreign bundle')
        with self.assertRaisesRegex(module.Refuse, 'bundle changed'):
            self.controller.activate(TARGET)
        self.assertTrue(self.dropin.exists())

    def test_ready_retry_cannot_rebind_a_replaced_bundle(self):
        self.controller.drain(TARGET, 0)
        self.controller.ready(TARGET)
        self.bundle.write_text('replacement')
        with self.assertRaisesRegex(module.Refuse, 'refusing to rebind'):
            self.controller.ready(TARGET)

    def test_activation_retry_after_override_removal_does_not_stop_or_restore(self):
        self.controller.drain(TARGET, 0)
        self.controller.ready(TARGET)
        self.controller.save('released')
        self.dropin.unlink()
        self.new_controller().activate(TARGET)
        self.assertEqual(len(self.stops()), 1)
        self.assertFalse(self.dropin.exists())

    def test_next_deployment_archives_completed_state_without_touching_other_units(self):
        self.controller.drain(TARGET, 0)
        self.controller.ready(TARGET)
        self.controller.activate(TARGET)
        self.new_controller().drain('b' * 40, 0, before=TARGET)
        self.assertEqual(len(self.stops()), 2)
        self.assertEqual(len(list(self.state_dir.glob('completed-*.json'))), 1)
        self.assertTrue(all(call[-1] == module.UNIT for call in self.system.calls
                            if call[:2] in (('systemctl', 'start'), ('systemctl', 'stop'))))

    def test_changed_checkout_before_or_during_drain_is_refused(self):
        with self.assertRaisesRegex(module.Refuse, 'Checkout already changed'):
            self.controller.drain(TARGET, 0, before='b' * 40)
        self.assertEqual(self.stops(), [])
        self.system.finish_on_stop = False
        with self.assertRaises(module.Refuse):
            self.controller.drain(TARGET, 0, before=TARGET)
        self.system.head = 'c' * 40
        with self.assertRaisesRegex(module.Refuse, 'Checkout or bundle changed'):
            self.new_controller().drain(TARGET, 0, before=TARGET)
        self.assertEqual(len(self.stops()), 1)

    def test_competing_bootstrap_start_is_refused_before_signal_and_keeps_pending_stop(self):
        self.system.start_sources_held = False
        with self.assertRaisesRegex(module.Refuse, 'bootstrap timer'):
            self.controller.drain(TARGET, 0)
        self.assertEqual(self.stops(), [])
        self.system.start_sources_held = True
        self.system.finish_on_stop = False
        with self.assertRaisesRegex(module.Refuse, 'Drain still running'):
            self.controller.drain(TARGET, 0)
        self.system.start_sources_held = False
        with self.assertRaisesRegex(module.Refuse, 'bootstrap timer'):
            self.new_controller().drain(TARGET, 0)
        self.assertEqual(len(self.stops()), 1)
        self.assertTrue(self.dropin.exists())

    def test_release_racing_stop_dispatch_cannot_be_acknowledged_as_safe_drain(self):
        self.system.finish_on_stop = False
        with self.assertRaisesRegex(module.Refuse, 'Drain still running'):
            self.controller.drain(TARGET, 0)
        self.capability.write_text(json.dumps(dict(version=1, pid=123, startTicks='456', phase='releasing')))
        with self.assertRaisesRegex(module.Refuse, 'phase is unsafe'):
            self.new_controller().drain(TARGET, 0)
        self.system.finish()
        with self.assertRaisesRegex(module.Refuse, 'phase is unsafe'):
            self.new_controller().drain(TARGET, 0)
        self.assertEqual(len(self.stops()), 1)
        self.assertTrue(self.dropin.exists())

    def test_late_releasing_or_stale_identity_cannot_pass_ready_or_activation(self):
        self.controller.drain(TARGET, 0)
        for values in [dict(pid=123, startTicks='456', phase='releasing'),
                       dict(pid=123, startTicks='other-process', phase='running')]:
            self.capability.write_text(json.dumps(dict(version=1, **values)))
            with self.assertRaises(module.Refuse):
                self.new_controller().ready(TARGET)
        self.capability.write_text(json.dumps(dict(version=1, pid=123, startTicks='456', phase='draining')))
        self.controller.ready(TARGET)
        self.capability.write_text(json.dumps(dict(version=1, pid=123, startTicks='456', phase='releasing')))
        with self.assertRaises(module.Refuse):
            self.new_controller().activate(TARGET)
        self.assertTrue(self.dropin.exists())

    def test_symlinks_and_open_state_files_are_rejected(self):
        self.controller.file.symlink_to(self.capability)
        with self.assertRaises(OSError):
            self.controller.drain(TARGET, 0)
        self.controller.file.unlink()
        self.controller.drain(TARGET, 0)
        self.controller.file.chmod(0o644)
        with self.assertRaises(module.Refuse):
            self.new_controller().drain(TARGET, 0)
        self.assertEqual(len(self.stops()), 1)


if __name__ == '__main__':
    unittest.main()
