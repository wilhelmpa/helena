"""Offline operator checks. Never invoke systemd, Git, GPU code or a real HTTP server."""

import base64
from contextlib import ExitStack, nullcontext
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / 'whisper_update.py'
SPEC = importlib.util.spec_from_file_location('whisper_update', SCRIPT)
update = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(update)

UNIT = f'''[Unit]
Description=Helena STT
[Service]
ExecStart={update.OLD} --model {update.MODELS}/german.bin --language de \\
  --host 127.0.0.1 --port 13306 --request-path /v1 --inference-path /audio/transcriptions \\
  --threads 4 --flash-attn --suppress-nst --no-timestamps --vad --vad-model {update.MODELS}/vad.bin
User=helena-voice
Group=helena-voice
MemoryMax=6G
Environment=HSA_ENABLE_SDMA=0
[Install]
WantedBy=multi-user.target
'''.encode()


class UnitParsingTest(unittest.TestCase):
    def test_changes_only_executable_and_roundtrips(self):
        changed = update.replace_executable(UNIT, update.OLD, update.NEW)
        self.assertEqual(changed, UNIT.replace(update.OLD.encode(), update.NEW.encode()))
        self.assertEqual(update.replace_executable(changed, update.NEW, update.OLD), UNIT)

    def test_rejects_ambiguous_or_changed_configuration(self):
        for changed in (UNIT + b'ExecStart=/bin/false\n',
                        UNIT.replace(b'--host 127.0.0.1', b'--host 0.0.0.0'),
                        UNIT.replace(b'--language de', b'--language en'),
                        UNIT.replace(b'--port 13306', b'--port 13307'),
                        UNIT.replace(b'--vad ', b''),
                        UNIT.replace(b'--threads 4', b'--threads $THREADS'),
                        UNIT.replace(b'german.bin', b'../german.bin'),
                        UNIT + b'ExecStartPre=/usr/bin/true\n',
                        UNIT + b'EnvironmentFile=/etc/private\n'):
            with self.subTest(unit=changed), self.assertRaises(RuntimeError):
                update.exec_args(changed, update.OLD)

    def test_unloaded_unit_edits_block_acceptance(self):
        unit = Mock()
        unit.stat.return_value.st_gid = 0
        props = {'FragmentPath': str(unit), 'DropInPaths': '', 'NeedDaemonReload': 'yes'}
        with patch.object(update, 'UNIT', unit), patch.object(update, 'secure'), \
                patch.object(update, 'properties', return_value=props):
            with self.assertRaisesRegex(RuntimeError, 'unloaded'):
                update.live_snapshot(update.OLD)

    def test_private_candidate_waits_for_exec_and_has_isolated_network(self):
        data = update.private_unit_bytes(UNIT)
        self.assertIn(b'[Service]\nType=exec\nPrivateNetwork=yes\n', data)
        self.assertIn(b'--port 13316', data)
        self.assertIn(update.NEW.encode(), data)
        for extra in (b'Type=simple\n', b'PrivateNetwork=no\n', b' Type = exec\n'):
            with self.assertRaisesRegex(RuntimeError, 'configuration'):
                update.private_unit_bytes(UNIT + extra)


class BuildTest(unittest.TestCase):
    def test_build_is_offline_unprivileged_and_cpu_bounded(self):
        command = update.build_command('/source', 'isolated-build')
        for prop in ('DynamicUser=yes', 'PrivateDevices=yes', 'PrivateNetwork=yes',
                     'MemoryHigh=12G', 'MemoryMax=16G', 'CPUWeight=20',
                     'CPUQuota=200%', 'TasksMax=64', 'ProtectSystem=strict'):
            self.assertIn(prop, command)
        self.assertIn('--parallel 2', command[-1])
        self.assertIn('-DGGML_HIP=ON', command[-1])
        self.assertIn('-DGGML_STATIC=OFF', command[-1])
        self.assertIn('-DBUILD_SHARED_LIBS=OFF', command[-1])
        self.assertIn('-DAMDGPU_TARGETS=gfx1151', command[-1])
        self.assertIn('-DFETCHCONTENT_FULLY_DISCONNECTED=ON', command[-1])
        self.assertNotIn('apt ', command[-1])
        self.assertNotIn('--help', command[-1])
        self.assertNotIn('rocwmma', command[-1].lower())

    def test_wrong_source_pin_fails_before_archive(self):
        with patch.object(update, 'secure'), patch.object(update, 'run', return_value='wrong') as run:
            with self.assertRaisesRegex(RuntimeError, 'HEAD'):
                update.source_archive(Path('/reviewed-source'))
        self.assertEqual(run.call_count, 1)

    def test_export_uses_exact_git_object_and_never_worktree_filters(self):
        with patch.object(update, 'secure'), patch.object(update, 'run', side_effect=[
            update.COMMIT, 'https://github.com/ggml-org/whisper.cpp.git', '', b'archive'
        ]) as run:
            self.assertEqual(update.source_archive(Path('/reviewed-source')), b'archive')
        commands = [call.args[0] for call in run.call_args_list]
        self.assertIn(['archive', '--format=tar', update.COMMIT], [c[-3:] for c in commands])
        self.assertTrue(any('fsck' in c for c in commands))
        self.assertFalse(any('status' in c or 'checkout' in c or 'fetch' in c for c in commands))

    def test_rejects_unexpected_origin(self):
        with patch.object(update, 'secure'), patch.object(update, 'run', side_effect=[
            update.COMMIT, 'https://example.invalid/other.git'
        ]):
            with self.assertRaisesRegex(RuntimeError, 'origin'):
                update.source_archive(Path('/reviewed-source'))

    def test_tar_traversal_and_links_are_rejected(self):
        for name, kind in (('../escape', tarfile.REGTYPE), ('/escape', tarfile.REGTYPE),
                           ('link', tarfile.SYMTYPE), ('device', tarfile.CHRTYPE)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                blob = io.BytesIO()
                with tarfile.open(fileobj=blob, mode='w') as archive:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = '/escape'
                    archive.addfile(member)
                with self.assertRaisesRegex(RuntimeError, 'Unsafe'):
                    update.unpack_source(blob.getvalue(), Path(directory))

    def test_exported_source_is_root_written_not_archive_owned(self):
        with tempfile.TemporaryDirectory() as directory:
            blob = io.BytesIO()
            with tarfile.open(fileobj=blob, mode='w') as archive:
                member = tarfile.TarInfo('nested/CMakeLists.txt')
                member.size = 4
                member.mode = 0o666
                member.uid = 1234
                archive.addfile(member, io.BytesIO(b'test'))
            previous = os.umask(0o077)
            try:
                update.unpack_source(blob.getvalue(), Path(directory))
            finally:
                os.umask(previous)
            target = Path(directory) / 'nested/CMakeLists.txt'
            self.assertEqual(target.read_bytes(), b'test')
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)
            self.assertEqual(target.parent.stat().st_mode & 0o777, 0o755)
            self.assertEqual(Path(directory).stat().st_mode & 0o777, 0o755)

    def test_commands_never_inherit_credentials(self):
        result = subprocess.CompletedProcess(['true'], 0, b'ok', b'')
        with patch.object(update.subprocess, 'run', return_value=result) as run:
            self.assertEqual(update.run(['/usr/bin/true']), 'ok')
        self.assertEqual(run.call_args.kwargs['env'], update.ENV)
        self.assertNotIn('SSH_AUTH_SOCK', run.call_args.kwargs['env'])


class PrivateNetworkTest(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(update, 'properties', return_value={
            'ActiveState': 'active', 'MainPID': '123'}))
        self.stack.enter_context(patch.object(update.os, 'readlink', return_value=update.NEW))
        self.open = self.stack.enter_context(patch.object(update.os, 'open', side_effect=[10, 11]))
        self.close = self.stack.enter_context(patch.object(update.os, 'close'))
        self.stats = self.stack.enter_context(patch.object(update.os, 'fstat', side_effect=[
            types.SimpleNamespace(st_ino=1), types.SimpleNamespace(st_ino=2)]))
        self.setns = self.stack.enter_context(patch.object(update.os, 'setns', create=True))

    def test_failed_candidate_request_restores_original_namespace(self):
        with self.assertRaisesRegex(RuntimeError, 'request failed'):
            with update.candidate_network():
                raise RuntimeError('request failed')
        self.assertEqual([call.args for call in self.setns.call_args_list], [(11, 0), (10, 0)])
        self.assertEqual([call.args for call in self.close.call_args_list], [(11,), (10,)])

    def test_host_namespace_is_never_accepted_as_private(self):
        self.stats.side_effect = [types.SimpleNamespace(st_ino=1), types.SimpleNamespace(st_ino=1)]
        with self.assertRaisesRegex(RuntimeError, 'private network'):
            with update.candidate_network():
                self.fail('Must not enter candidate')
        self.setns.assert_not_called()

    def test_missing_target_closes_original_descriptor(self):
        self.open.side_effect = [10, FileNotFoundError('process gone')]
        with self.assertRaises(FileNotFoundError):
            with update.candidate_network():
                self.fail('Must not enter candidate')
        self.close.assert_called_once_with(10)


class PreparePackageTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.temporary.name)
        self.destination = root / 'voice/whisper-1.9.4'
        self.destination.parent.mkdir()
        self.state = root / 'state'
        self.state.mkdir()
        self.build = root / 'build'
        self.calls = []
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as tar:
            member = tarfile.TarInfo('CMakeLists.txt')
            member.size = 4
            tar.addfile(member, io.BytesIO(b'test'))
        for name, value in {
            'DEST': self.destination, 'STATE': self.state, 'CACHE': root / 'cache',
            'BUILD_ROOT': self.build, 'secure': Mock(),
            'source_archive': Mock(return_value=archive.getvalue()),
            'run': Mock(side_effect=self.command),
            'properties': Mock(return_value={'ActiveState': 'inactive'})
        }.items():
            self.stack.enter_context(patch.object(update, name, value))

    def command(self, args, **kwargs):
        self.calls.append(args)
        if args[0] == 'systemd-run':
            name = next(a.split('=', 1)[1] for a in args if a.startswith('--unit='))
            directory = self.build / name / 'bin'
            directory.mkdir(parents=True)
            for filename in ('whisper-server', 'whisper-cli'):
                (directory / filename).write_bytes(b'\x7fELF' + b'fixture' * 1000)
            return ''
        if args[:2] == ['readelf', '-h']:
            return 'Advanced Micro Devices X86-64'
        if args[:2] == ['readelf', '-d']:
            return f'{update.SDK}/lib libamdhip64 librocblas libhipblas'
        self.fail(f'Unexpected command: {args}')

    def test_prepare_is_readable_under_private_umask_and_repeat_does_not_build(self):
        previous = os.umask(0o077)
        try:
            record = update.prepare(Path('/reviewed'))
        finally:
            os.umask(previous)
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.destination / 'whisper-server').stat().st_mode & 0o777, 0o755)
        count = len(self.calls)
        self.assertEqual(update.prepare(Path('/reviewed')), record)
        self.assertEqual(len(self.calls), count)
        self.assertEqual(sum(c[0] == 'systemd-run' for c in self.calls), 1)

    def test_tampered_existing_candidate_is_not_rebuilt_or_overwritten(self):
        update.prepare(Path('/reviewed'))
        binary = self.destination / 'whisper-server'
        binary.write_bytes(b'\x7fELF' + b'tampered' * 1000)
        count = len(self.calls)
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            update.prepare(Path('/reviewed'))
        self.assertEqual(len(self.calls), count)
        self.assertIn(b'tampered', binary.read_bytes())


class TransactionTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.temporary.name)
        self.unit = root / 'stt.service'
        self.unit.write_bytes(UNIT)
        self.state = root / 'state'
        self.state.mkdir()
        self.private = root / 'candidate.service'
        self.commands = []
        self.proof = {'baseline': {'passed': True}, 'retained': {'unchanged': True},
                      'build': {'commit': update.COMMIT}, 'oldBinaries': {'old': 'hash'}}
        self.acceptance = types.SimpleNamespace(
            run_server=Mock(return_value={'passed': True}),
            compare_reports=Mock(return_value={'passed': True}))
        patches = {
            'UNIT': self.unit, 'STATE': self.state, 'PRIVATE_UNIT': self.private,
            'secure': Mock(), 'idle': Mock(), 'wait_health': Mock(),
            'live_snapshot': Mock(side_effect=self.snapshot),
            'preserved_state': Mock(return_value=self.proof['retained']),
            'artifact_hashes': Mock(return_value=self.proof['oldBinaries']),
            'prepared': Mock(return_value=self.proof['build']),
            'candidate_network': Mock(return_value=nullcontext()),
            'properties': Mock(side_effect=self.props),
            'run': Mock(side_effect=lambda command, **kwargs: self.commands.append(command) or '')
        }
        for key, value in patches.items():
            self.stack.enter_context(patch.object(update, key, value))
        self.stack.enter_context(patch.dict(sys.modules, {'whisper_acceptance': self.acceptance}))
        self.stack.enter_context(patch.object(update.os, 'setns', Mock(), create=True))

    def snapshot(self, expected):
        value = self.unit.read_bytes()
        update.exec_args(value, expected)
        return value

    def props(self, unit):
        path = self.private if unit == update.CANDIDATE else self.unit
        return {'FragmentPath': str(path) if path.exists() else '', 'DropInPaths': '',
                'ActiveState': 'inactive' if unit == update.CANDIDATE else 'active'}

    def record(self):
        return json.loads((self.state / 'transaction.json').read_bytes())

    def test_journal_exists_before_any_unit_mutation(self):
        original = update.atomic_write

        def write(path, data, mode=0o600):
            if path == self.unit:
                record = self.record()
                self.assertEqual(record['phase'], 'prepared')
                self.assertEqual(base64.b64decode(record['before']), UNIT)
            original(path, data, mode)

        with patch.object(update, 'atomic_write', side_effect=write):
            update.switch(UNIT, self.proof, object())
        self.assertEqual(self.record()['phase'], 'active')
        self.assertEqual(self.unit.read_bytes(), UNIT.replace(update.OLD.encode(), update.NEW.encode()))
        self.assertEqual([c for c in self.commands if 'restart' in c], [['systemctl', 'restart', update.STT]])

    def test_durable_journal_failure_leaves_live_unit_untouched(self):
        with patch.object(update, 'save', side_effect=OSError('fsync failed')):
            with self.assertRaises(OSError):
                update.switch(UNIT, self.proof, object())
        self.assertEqual(self.unit.read_bytes(), UNIT)
        self.assertFalse(self.commands)

    def test_failed_transcription_restores_exact_unit_and_verifies_old_server(self):
        self.acceptance.run_server.side_effect = [{'passed': False}, {'passed': True}]
        with self.assertRaisesRegex(RuntimeError, 'Speech acceptance'):
            update.switch(UNIT, self.proof, object())
        self.assertEqual(self.unit.read_bytes(), UNIT)
        self.assertEqual(self.record()['phase'], 'restored-verified')
        self.assertEqual(self.acceptance.run_server.call_count, 2)
        self.assertFalse(any(update.TTS in c for c in self.commands))

    def test_startup_failure_restores_old_unit(self):
        update.wait_health.side_effect = [RuntimeError('startup failed'), None]
        with self.assertRaisesRegex(RuntimeError, 'startup failed'):
            update.switch(UNIT, self.proof, object())
        self.assertEqual(self.unit.read_bytes(), UNIT)
        self.assertEqual(self.record()['phase'], 'restored-verified')

    def test_model_or_tts_change_triggers_rollback(self):
        update.preserved_state.return_value = {'changed': True}
        with self.assertRaisesRegex(RuntimeError, 'metadata changed'):
            update.switch(UNIT, self.proof, object())
        self.assertEqual(self.unit.read_bytes(), UNIT)

    def test_crash_recovery_uses_disk_record(self):
        update.switch(UNIT, self.proof, object())
        record = self.record()
        record['phase'] = 'prepared'
        update.restore(record)
        self.assertEqual(self.unit.read_bytes(), UNIT)
        self.assertEqual(self.record()['phase'], 'restored-health-only')

    def test_external_unit_change_is_never_overwritten(self):
        update.switch(UNIT, self.proof, object())
        self.unit.write_bytes(b'externally changed')
        with self.assertRaisesRegex(RuntimeError, 'externally'):
            update.restore(self.record())
        self.assertEqual(self.unit.read_bytes(), b'externally changed')

    def test_changed_old_binary_blocks_rollback(self):
        update.switch(UNIT, self.proof, object())
        update.artifact_hashes.return_value = {'old': 'changed'}
        with self.assertRaisesRegex(RuntimeError, 'Previous binaries'):
            update.restore(self.record())
        self.assertIn(update.NEW.encode(), self.unit.read_bytes())

    def test_corrupt_rollback_record_is_rejected(self):
        update.switch(UNIT, self.proof, object())
        record = self.record()
        record['before'] = base64.b64encode(UNIT + b'changed').decode()
        with self.assertRaisesRegex(RuntimeError, 'Invalid rollback'):
            update.restore(record)

    def test_external_dropin_blocks_rollback(self):
        update.switch(UNIT, self.proof, object())
        update.properties.side_effect = None
        update.properties.return_value = {'FragmentPath': str(self.unit), 'DropInPaths': '/override.conf'}
        with self.assertRaisesRegex(RuntimeError, 'override'):
            update.restore(self.record())

    def test_candidate_failure_stops_only_candidate_and_keeps_live_untouched(self):
        self.acceptance.run_server.side_effect = [{'passed': True}, {'passed': False}]
        with self.assertRaisesRegex(RuntimeError, 'acceptance'):
            update.acceptance(object())
        self.assertEqual(self.unit.read_bytes(), UNIT)
        self.assertFalse(self.private.exists())
        self.assertIn(['systemctl', 'stop', update.CANDIDATE], self.commands)
        self.assertFalse(any('restart' in c for c in self.commands))
        update.candidate_network.assert_called_once()

    def test_candidate_cleanup_refuses_foreign_unit(self):
        self.private.write_bytes(b'foreign')
        update.save(self.state / 'candidate-unit.json', {'sha256': update.digest(b'ours')})
        with self.assertRaisesRegex(RuntimeError, 'externally'):
            update.cleanup_candidate()
        self.assertEqual(self.private.read_bytes(), b'foreign')
        self.assertFalse(self.commands)


if __name__ == '__main__':
    unittest.main()
