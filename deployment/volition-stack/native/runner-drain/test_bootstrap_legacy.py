import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import test_runner_drain as shared

spec = importlib.util.spec_from_file_location('bootstrap_legacy', Path(__file__).with_name('bootstrap-legacy.py'))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


class BootstrapTest(unittest.TestCase):
    def setUp(self):
        # Reuse the real filesystem/state fixture, not the ordinary capability adapter.
        shared.DrainTest.setUp(self)
        self.cli = self.live / 'packages/runner/src/cli.ts'
        self.cli.parent.mkdir(parents=True)
        self.cli.write_text('reviewed synthetic legacy CLI')
        self.pin = patch.object(legacy, 'LEGACY_CLI_SHA256', legacy.base.digest(self.cli.read_bytes()))
        self.pin.start()
        self.addCleanup(self.pin.stop)
        self.counts = dict(runs=0, chats=0, claimed_pending_chats=0, reflections=0, requests=0, queued_runs=0, queued_chats=0)
        self.system.inflight = lambda: dict(self.counts)
        self.system.bundle_predates_process = lambda *_: True
        self.system.already_stopping = lambda *_: False
        self.bundle_hash = legacy.base.digest(self.bundle.read_bytes())
        self.controller = self.new_controller()
        self.capability.unlink()  # No real or fabricated capability file exists.

    def new_controller(self):
        return legacy.Bootstrap(self.system, state_dir=self.state_dir, dropin=self.dropin,
                                capability=self.capability, live=self.live,
                                uid=os.getuid(), runner_uid=os.getuid())

    stops = shared.DrainTest.stops

    def plan(self):
        return self.controller.plan(shared.TARGET, self.bundle_hash)

    def test_pinned_plan_one_stop_natural_completion_release_never_starts_or_mutates_source(self):
        self.plan()
        self.assertEqual(self.controller.plan_file.stat().st_mode & 0o777, 0o600)
        self.controller.drain_legacy(0)
        self.controller.release()
        self.new_controller().release()
        self.assertEqual(len(self.stops()), 1)
        self.assertFalse(self.dropin.exists())
        self.assertFalse(self.capability.exists())
        self.assertEqual(legacy.base.digest(self.bundle.read_bytes()), self.bundle_hash)
        self.assertFalse(any(call[:2] in (('systemctl', 'start'), ('systemctl', 'restart'))
                             or 'kill' in call for call in self.system.calls))

    def test_claim_arriving_after_plan_waits_without_second_stop_and_blocks_release(self):
        self.plan()
        self.system.finish_on_stop = False
        original = self.system.run
        def run(*args):
            if args[:2] == ('systemctl', 'stop'):
                self.counts['chats'] = 1  # Claim raced with the earlier zero observation.
            return original(*args)
        self.system.run = run
        for _ in range(2):
            with self.assertRaisesRegex(legacy.base.Refuse, 'Drain still running'):
                self.new_controller().drain_legacy(0)
        self.system.finish()
        with self.assertRaisesRegex(legacy.base.Refuse, 'streaming chats remain'):
            self.new_controller().drain_legacy(0)
        with self.assertRaisesRegex(legacy.base.Refuse, 'streaming chats remain'):
            self.new_controller().release()
        self.counts['chats'] = 0
        self.new_controller().drain_legacy(0)
        self.new_controller().release()
        self.assertEqual(len(self.stops()), 1)

    def test_existing_work_and_changed_plan_are_refused_before_signal(self):
        self.counts['runs'] = 1
        with self.assertRaisesRegex(legacy.base.Refuse, 'Claimed runs'):
            self.plan()
        self.counts['runs'] = 0
        self.plan()
        self.counts['chats'] = 1
        with self.assertRaisesRegex(legacy.base.Refuse, 'streaming chats'):
            self.controller.drain_legacy(0)
        self.assertEqual(self.stops(), [])

    def test_old_source_bundle_process_and_stop_history_are_all_pinned(self):
        self.plan()
        changes = [
            (self.system.snapshot, 'InvocationID', 'f' * 32),
            (self.system.snapshot, 'MainPID', '999'),
        ]
        for obj, key, value in changes:
            old = obj[key]
            obj[key] = value
            with self.assertRaisesRegex(legacy.base.Refuse, 'Pinned legacy'):
                self.controller.drain_legacy(0)
            obj[key] = old
        with patch.object(self.system, 'identity', return_value='789'):
            with self.assertRaisesRegex(legacy.base.Refuse, 'Pinned legacy'):
                self.controller.drain_legacy(0)
        with patch.object(self.system, 'already_stopping', return_value=True):
            with self.assertRaisesRegex(legacy.base.Refuse, 'Pinned legacy'):
                self.controller.drain_legacy(0)
        self.bundle.write_text('new foreign bundle')
        with self.assertRaisesRegex(legacy.base.Refuse, 'Pinned legacy'):
            self.controller.drain_legacy(0)
        self.assertEqual(self.stops(), [])

    def test_source_pin_and_bundle_predating_process_fail_closed(self):
        with patch.object(self.system, 'bundle_predates_process', return_value=False):
            with self.assertRaisesRegex(legacy.base.Refuse, 'changed after'):
                self.plan()
        self.cli.write_text('unreviewed CLI')
        with self.assertRaisesRegex(legacy.base.Refuse, 'exact reviewed'):
            self.plan()
        self.assertEqual(self.stops(), [])

    def test_unclaimed_queue_does_not_prevent_finishing_a_drained_runner(self):
        self.counts.update(queued_runs=4, queued_chats=2)
        self.plan()
        self.controller.drain_legacy(0)
        self.controller.release()
        self.assertEqual(len(self.stops()), 1)
        self.assertEqual(self.counts['queued_chats'], 2)

    def test_uncertain_stop_dispatch_is_never_retried(self):
        self.plan()
        self.system.fail_stop = True
        with self.assertRaises(shared.module.Refuse):
            self.controller.drain_legacy(0)
        self.system.fail_stop = False
        with self.assertRaisesRegex(legacy.base.Refuse, 'unconfirmed'):
            self.new_controller().drain_legacy(0)
        self.assertEqual(len(self.stops()), 1)
        self.assertTrue(self.dropin.exists())

    def test_foreign_completed_invocation_and_source_change_cannot_release(self):
        self.plan()
        self.controller.drain_legacy(0)
        self.system.snapshot['InvocationID'] = 'f' * 32
        with self.assertRaises(legacy.base.Refuse):
            self.new_controller().release()
        self.system.snapshot['InvocationID'] = '1' * 32
        self.system.head = 'b' * 40
        with self.assertRaises(legacy.base.Refuse):
            self.new_controller().release()
        self.assertTrue(self.dropin.exists())

    def test_crash_after_release_intent_does_not_dispatch_stop_or_start(self):
        self.plan()
        self.controller.drain_legacy(0)
        self.controller.save('released')
        self.new_controller().release()
        self.assertEqual(len(self.stops()), 1)
        self.assertFalse(self.dropin.exists())

    def test_bootstrap_trigger_cannot_be_left_running_at_plan_or_release(self):
        self.system.start_sources_held = False
        with self.assertRaisesRegex(legacy.base.Refuse, 'bootstrap timer'):
            self.plan()
        self.system.start_sources_held = True
        self.plan()
        self.controller.drain_legacy(0)
        self.system.start_sources_held = False
        with self.assertRaisesRegex(legacy.base.Refuse, 'bootstrap timer'):
            self.controller.release()
        self.assertTrue(self.dropin.exists())

    def test_no_matching_journal_entries_is_valid_but_journal_errors_are_not(self):
        system = legacy.LegacySystem()
        with patch.object(legacy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', '')):
            self.assertFalse(system.already_stopping('a' * 32))
        with patch.object(legacy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'stopping —', '')):
            self.assertTrue(system.already_stopping('a' * 32))
        with patch.object(legacy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'journal unavailable')):
            with self.assertRaisesRegex(legacy.base.Refuse, 'unavailable'):
                system.already_stopping('a' * 32)


if __name__ == '__main__':
    unittest.main()
