"""Offline UI admission and recovery tests; no systemd, database, network or GPU."""

from contextlib import ExitStack, contextmanager, nullcontext
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import whisper_ui as ui


class ReadinessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for obj, name, value in (
                (ui.operator, 'STATE', self.root), (ui, 'MAINTENANCE', self.root / 'maintenance.json'),
                (ui.operator, 'DEST', self.root / 'build'),
                (ui.operator, 'PRIVATE_UNIT', self.root / 'candidate.service')):
            self.stack.enter_context(patch.object(obj, name, value))
        ui.operator.DEST.mkdir()
        self.stack.enter_context(patch.object(ui.operator, 'secure'))
        self.stack.enter_context(patch.object(ui.operator, 'lock', side_effect=nullcontext))
        self.stack.enter_context(patch.object(ui.operator.os, 'setns', create=True))
        self.stack.enter_context(patch.object(ui.operator, 'prepared', return_value={'pin': 'build'}))
        self.stack.enter_context(patch.object(ui.operator, 'artifact_hashes', return_value={'old': 'sha'}))
        self.stack.enter_context(patch.object(ui.operator, 'live_snapshot', return_value=b'unit'))
        self.retained = self.stack.enter_context(patch.object(ui.operator, 'preserved_state', return_value={'tts': 10}))
        self.stack.enter_context(patch.object(ui.operator, 'properties', return_value={'ActiveState': 'inactive'}))
        self.requests = self.stack.enter_context(patch.object(ui, 'requests_clear'))
        self.corpus = self.stack.enter_context(patch.object(ui, 'load_corpus', return_value=object()))
        self.sha = 'a' * 64
        self.proof = {'build': {'pin': 'build'}, 'baseline': {'passed': True, 'manifestSha256': self.sha},
                      'candidate': {'passed': True, 'manifestSha256': self.sha}, 'comparison': {'passed': True},
                      'unitSha256': ui.operator.digest(b'unit'), 'oldBinaries': {'old': 'sha'},
                      'retained': {'tts': 10}, 'verifiedAt': time.time()}
        ui.operator.save(self.root / 'verified.json', self.proof)

    def grant(self):
        return ui.authorize(self.sha)

    def test_no_window_cannot_be_applied_or_invented_by_status(self):
        before = list(self.root.iterdir())
        self.assertEqual(ui.status()['code'], 'maintenance-required')
        self.assertFalse(ui.status()['ready'])
        self.assertEqual(list(self.root.iterdir()), before)

    def test_authorize_binds_exact_proof_and_expires(self):
        grant = self.grant()
        self.assertTrue(ui.status()['ready'])
        with patch.object(ui.time, 'time', return_value=grant['expiresAt']):
            self.assertEqual(ui.status()['code'], 'maintenance-required')
        self.proof['verifiedAt'] += 1
        ui.operator.save(self.root / 'verified.json', self.proof)
        self.assertFalse(ui.status()['ready'])

    def test_changed_corpus_unit_old_binary_or_models_cannot_be_ready(self):
        self.grant()
        for name, value in (('unitSha256', 'wrong'), ('oldBinaries', {}), ('retained', {}), ('build', {})):
            changed = dict(self.proof, **{name: value})
            ui.operator.save(self.root / 'verified.json', changed)
            self.assertFalse(ui.status()['ready'], name)
        ui.operator.save(self.root / 'verified.json', self.proof)
        self.corpus.side_effect = ValueError('Changed WAV')
        self.assertFalse(ui.status()['ready'])

    def test_failed_or_other_corpus_voice_proof_cannot_authorize(self):
        for report in ({'passed': False, 'manifestSha256': self.sha},
                       {'passed': True, 'manifestSha256': 'b' * 64}):
            ui.operator.save(self.root / 'verified.json', dict(self.proof, candidate=report))
            with self.assertRaisesRegex(RuntimeError, 'corpus'):
                self.grant()
        self.assertFalse((self.root / 'ui-window.json').exists())

    def test_interrupted_operation_or_candidate_blocks_status(self):
        self.grant()
        ui.MAINTENANCE.write_text('{}')
        self.assertEqual(ui.status()['code'], 'recovery-required')
        ui.MAINTENANCE.unlink()
        ui.operator.PRIVATE_UNIT.write_text('unit')
        self.assertEqual(ui.status()['code'], 'recovery-required')

    def test_another_operations_marker_is_never_removed(self):
        ui.MAINTENANCE.write_text(json.dumps({'version': '1.9.4', 'actionId': 'foreign'}))
        ui.operator.save(self.root / 'ui-action.json', {'actionId': 'ours'})
        with self.assertRaisesRegex(RuntimeError, 'another operation'):
            ui.finish_maintenance()
        self.assertTrue(ui.MAINTENANCE.exists())

    def test_unsupported_target_does_not_acquire_lock(self):
        with patch.object(ui, 'voice_lock') as lock:
            with self.assertRaisesRegex(RuntimeError, 'target'):
                ui.activate('1.9.5', 'itsaplan')
            lock.assert_not_called()

    def test_success_consumes_window_and_runs_real_operator_entry(self):
        self.grant()
        observed = []
        @contextmanager
        def locked(_):
            observed.append('locked')
            try:
                yield lambda: None
            finally:
                observed.append('released')
        def accept(corpus, *, activate):
            self.assertTrue(activate)
            self.assertTrue(ui.MAINTENANCE.exists())
            self.assertFalse((self.root / 'ui-window.json').exists())
            self.assertEqual(observed, ['locked'])
            ui.operator.save(self.root / 'transaction.json', {'phase': 'active', 'createdAt': time.time()})
        with patch.object(ui, 'voice_lock', side_effect=locked), patch.object(ui.operator, 'acceptance', side_effect=accept) as action:
            result = ui.activate('1.9.4', 'itsaplan')
        self.assertTrue(result['ok'])
        self.assertTrue(result['result']['speechVerified'])
        self.assertEqual(observed, ['locked', 'released'])
        action.assert_called_once()
        self.assertFalse(ui.MAINTENANCE.exists())
        self.assertFalse(ui.status()['ready'])

    def test_busy_transcription_preserves_grant_and_never_runs_operator(self):
        self.grant()
        with patch.object(ui, 'voice_lock', side_effect=ui.NotReady('voice-busy', 'busy')), patch.object(ui.operator, 'acceptance') as action:
            with self.assertRaisesRegex(RuntimeError, 'busy'):
                ui.activate('1.9.4', 'itsaplan')
        action.assert_not_called()
        self.assertTrue((self.root / 'ui-window.json').exists())
        self.assertFalse(ui.MAINTENANCE.exists())

    def test_failure_reports_actual_rollback_state_and_retains_uncertain_hold(self):
        for phase in ('restored-verified', 'restored-health-only', 'restoring'):
            with self.subTest(phase=phase):
                for name in ('ui-action.json', 'transaction.json', 'maintenance.json'):
                    (self.root / name).unlink(missing_ok=True)
                self.grant()
                def fail(*_, **__):
                    ui.operator.save(self.root / 'transaction.json', {'phase': phase, 'createdAt': time.time()})
                    raise RuntimeError('speech comparison failed')
                with patch.object(ui, 'voice_lock', side_effect=lambda _: nullcontext(lambda: None)), patch.object(ui.operator, 'acceptance', side_effect=fail):
                    result = ui.activate('1.9.4', 'itsaplan')
                self.assertFalse(result['ok'])
                self.assertEqual(result['result']['phase'], phase)
                self.assertEqual(result['result']['speechVerified'], phase == 'restored-verified')
                self.assertEqual(ui.MAINTENANCE.exists(), phase != 'restored-verified')

    def test_previous_restored_proof_is_not_claimed_for_a_new_baseline_failure(self):
        ui.operator.save(self.root / 'transaction.json', {'phase': 'restored-verified', 'createdAt': 1})
        self.grant()
        with patch.object(ui, 'voice_lock', side_effect=lambda _: nullcontext(lambda: None)), patch.object(ui.operator, 'acceptance', side_effect=RuntimeError('baseline failed')):
            result = ui.activate('1.9.4', 'itsaplan')
        self.assertFalse(result['ok'])
        self.assertEqual(result['result']['phase'], 'not-activated')
        self.assertFalse(result['result']['speechVerified'])
        self.assertEqual(ui.operator.read_record(self.root / 'transaction.json')['createdAt'], 1)

    def test_late_request_or_lost_lease_cannot_start_acceptance(self):
        for fault in ('token', 'connection'):
            with self.subTest(fault=fault):
                for name in ('ui-action.json', 'transaction.json', 'maintenance.json'):
                    (self.root / name).unlink(missing_ok=True)
                self.requests.side_effect = None
                self.grant()
                if fault == 'token':
                    self.requests.side_effect = [None, ui.NotReady('voice-busy', 'late transcription')]
                def verify():
                    if fault == 'connection':
                        raise ui.NotReady('recovery-required', 'lost connection')
                with patch.object(ui, 'voice_lock', side_effect=lambda _: nullcontext(verify)), patch.object(ui.operator, 'acceptance') as action:
                    answer = ui.activate('1.9.4', 'itsaplan')
                self.assertFalse(answer['ok'])
                action.assert_not_called()
                self.assertTrue((self.root / 'ui-window.json').exists())
                self.assertFalse(ui.MAINTENANCE.exists())

    def test_changed_active_unit_cannot_resume_voice(self):
        ui.MAINTENANCE.write_text(json.dumps({'version': '1.9.4', 'actionId': 'fixture'}))
        ui.operator.save(self.root / 'ui-action.json', {'actionId': 'fixture', 'state': 'running'})
        ui.operator.save(self.root / 'transaction.json', {'phase': 'active', 'afterSha256': 'wrong'})
        with self.assertRaisesRegex(RuntimeError, 'unit changed'):
            ui.resume(self.sha)
        self.assertTrue(ui.MAINTENANCE.exists())

    def test_resume_after_health_only_requires_new_matching_speech_proof(self):
        self.grant()
        ui.MAINTENANCE.write_text(json.dumps({'version': '1.9.4', 'actionId': 'fixture'}))
        ui.operator.save(self.root / 'ui-action.json', {'actionId': 'fixture', 'state': 'running', 'startedAt': self.proof['verifiedAt'] + 1})
        ui.operator.save(self.root / 'transaction.json', {'phase': 'restored-health-only'})
        with self.assertRaisesRegex(RuntimeError, 'new verified'):
            ui.resume(self.sha)
        self.assertTrue(ui.MAINTENANCE.exists())
        self.proof['verifiedAt'] += 2
        ui.operator.save(self.root / 'verified.json', self.proof)
        self.assertTrue(ui.resume(self.sha)['voiceResumed'])
        self.assertFalse(ui.MAINTENANCE.exists())


class AdmissionTest(unittest.TestCase):
    def process(self, answer):
        process = Mock()
        process.stdout.readline.return_value = answer
        process.poll.return_value = None
        return process

    def test_exclusive_lock_is_nonblocking_and_lasts_through_work(self):
        process = self.process('t\n')
        with patch.object(ui.subprocess, 'Popen', return_value=process), patch.object(ui.select, 'select', return_value=([process.stdout], [], [])):
            with ui.voice_lock('itsaplan'):
                process.communicate.assert_not_called()
            statement = process.stdin.write.call_args.args[0]
            self.assertIn('pg_try_advisory_xact_lock(748220, 13306)', statement)
            self.assertIn('idle_in_transaction_session_timeout=0', statement)
            process.communicate.assert_called_once_with('ROLLBACK;\n', timeout=5)

    def test_busy_and_lost_connection_are_not_success(self):
        for response in ('f\n', ''):
            process = self.process(response)
            with patch.object(ui.subprocess, 'Popen', return_value=process), patch.object(ui.select, 'select', return_value=([process.stdout], [], [])):
                with self.assertRaisesRegex(RuntimeError, 'transcription'):
                    with ui.voice_lock('itsaplan'):
                        self.fail('Must not start')
        process = self.process('t\n')
        process.poll.return_value = 1
        with patch.object(ui.subprocess, 'Popen', return_value=process), patch.object(ui.select, 'select', return_value=([process.stdout], [], [])):
            with self.assertRaisesRegex(RuntimeError, 'lost'):
                with ui.voice_lock('itsaplan'):
                    pass

    def test_database_argument_cannot_be_a_command(self):
        with patch.object(ui.subprocess, 'Popen') as process:
            with self.assertRaisesRegex(RuntimeError, 'database'):
                with ui.voice_lock('itsaplan;drop'):
                    pass
            process.assert_not_called()
