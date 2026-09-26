"""Regression coverage for privilege boundaries, bounded resource use and launcher shutdown."""

import asyncio
import contextlib
import http.client
import io
import json
import os
from pathlib import Path
import ssl
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

ISOLATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ISOLATION))
sys.path.insert(0, str(ISOLATION / 'proof'))

import egress
import harness
import isolation_common as common
import launcher
import migrate
import plan_proxy
import runtime_modes


def reader_for(data):
    reader = asyncio.StreamReader()
    reader.feed_data(data)
    reader.feed_eof()
    return reader


def client_hello(host):
    outgoing = ssl.MemoryBIO()
    connection = ssl.create_default_context().wrap_bio(ssl.MemoryBIO(), outgoing, server_hostname=host)
    try:
        connection.do_handshake()
    except ssl.SSLWantReadError:
        pass
    return outgoing.read()


class NetworkTest(unittest.IsolatedAsyncioTestCase):
    async def test_large_chunks_are_read_and_written_in_bounded_pieces(self):
        size = 2 * 1024 * 1024
        reader = reader_for(b'200000\r\n' + b'x' * size + b'\r\n0\r\n\r\n')
        original = reader.readexactly
        requested = []

        async def read(amount):
            requested.append(amount)
            return await original(amount)

        reader.readexactly = read
        writes = []
        upstream = types.SimpleNamespace(write=lambda value: writes.append(len(value)), drain=AsyncMock())
        proxy = plan_proxy.PlanProxy(('127.0.0.1', 3000), 'vp-', 'volition-agent-', 'volition-agents')
        await proxy.body(reader, upstream, 0, True)
        self.assertLessEqual(max(requested), 65536)
        self.assertLessEqual(max(writes), 65536)
        self.assertEqual(sum(writes), size + len(b'200000\r\n\r\n0\r\n\r\n'))

    async def test_plan_connection_caps_and_release_on_disconnect(self):
        proxy = plan_proxy.PlanProxy(('127.0.0.1', 3000), 'vp-', 'volition-agent-', 'volition-agents')
        proxy.identify = lambda writer: ('alpha', '')
        proxy.per_project = 1
        writer = types.SimpleNamespace(write=Mock(), drain=AsyncMock(), close=Mock())
        first = asyncio.create_task(proxy.handle(asyncio.StreamReader(), writer))
        await asyncio.sleep(0)
        second = types.SimpleNamespace(write=Mock(), drain=AsyncMock(), close=Mock())
        await proxy.handle(asyncio.StreamReader(), second)
        self.assertIn(b'503', second.write.call_args.args[0])
        proxy.identify = lambda writer: ('beta', '')
        proxy.max_connections = 1
        await proxy.handle(asyncio.StreamReader(), second)
        self.assertEqual(second.write.call_count, 2)
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        self.assertEqual(proxy.connections, {})

    async def test_tls_connect_requires_matching_sni(self):
        hello = client_hello('chatgpt.com')
        self.assertEqual(await egress.checked_client_hello(reader_for(hello), 'chatgpt.com'), hello)
        with self.assertRaises(common.HttpError):
            await egress.checked_client_hello(reader_for(hello), 'other.example')

    async def test_tls_client_hello_can_span_records(self):
        hello = client_hello('chatgpt.com')
        body = hello[5:]
        fragments = [body[:2], body[2:20], body[20:]]
        fragmented = b''.join(b'\x16\x03\x01' + len(part).to_bytes(2, 'big') + part for part in fragments)
        self.assertEqual(await egress.checked_client_hello(reader_for(fragmented), 'chatgpt.com'), fragmented)

    async def test_tls_rejects_plaintext_missing_sni_and_oversized_records(self):
        for payload in (b'GET /', b'\x16\x03\x01\xff\xff', client_hello('1.1.1.1')):
            with self.subTest(payload=payload[:5]), self.assertRaises(common.HttpError):
                await egress.checked_client_hello(reader_for(payload), 'chatgpt.com')

    async def test_tls_rejects_encrypted_and_duplicate_server_names(self):
        name = b'chatgpt.com'
        names = b'\x00' + len(name).to_bytes(2, 'big') + name
        sni = len(names).to_bytes(2, 'big') + names
        extension = b'\x00\x00' + len(sni).to_bytes(2, 'big') + sni
        for extensions in (extension * 2, extension + b'\xfe\x0d\x00\x00'):
            body = b'\x03\x03' + bytes(32) + b'\x00\x00\x02\x13\x01\x01\x00'
            body += len(extensions).to_bytes(2, 'big') + extensions
            handshake = b'\x01' + len(body).to_bytes(3, 'big') + body
            hello = b'\x16\x03\x01' + len(handshake).to_bytes(2, 'big') + handshake
            with self.assertRaises(common.HttpError):
                await egress.checked_client_hello(reader_for(hello), 'chatgpt.com')

    async def test_policy_loop_survives_plan_http_failure(self):
        plan = egress.Plan('http://127.0.0.1:3000', None, None)
        plan.refresh = AsyncMock(side_effect=[http.client.BadStatusLine('bad'), None])
        plan.flush = AsyncMock()
        sleep = AsyncMock(side_effect=[None, asyncio.CancelledError])
        with patch.object(egress.asyncio, 'sleep', sleep), patch.object(egress, 'log') as log:
            with self.assertRaises(asyncio.CancelledError):
                await plan.loop(refresh_sec=-1)
        self.assertEqual(plan.refresh.call_count, 2)
        plan.flush.assert_awaited_once()
        log.assert_called_once()


class PolicyTest(unittest.TestCase):
    def test_unknown_projects_and_unknown_modes_are_blocked(self):
        plan = egress.Plan('http://127.0.0.1:3000', None, None)
        self.assertEqual(egress.decide(plan.policy('new'), 'example.com', 443), 'blocked')
        self.assertEqual(egress.decide({'mode': 'unknown'}, 'example.com', 443, 9), 'blocked')

    def test_missing_pid_identity_cannot_use_the_more_open_project_policy(self):
        policy = {'mode': 'open', 'agents': {'7': 'allowlist', '8': 'blocked'}}
        proxy = egress.Egress(egress.Plan('', None, None), 'vp-', 'volition-agent-', 'agents')
        with patch.object(egress, 'peer_credentials', return_value=(123, 123, 123)), \
                patch.object(egress.pwd, 'getpwuid', return_value=types.SimpleNamespace(pw_name='vp-alpha')), \
                patch.object(egress.grp, 'getgrnam', return_value=types.SimpleNamespace(gr_mem=['vp-alpha'])), \
                patch.object(egress, 'unit_of_pid', return_value=None):
            identity = proxy.identify(Mock())
        self.assertIsNone(identity['agentId'])
        self.assertEqual(egress.decide(policy, 'example.com', 443, identity['agentId']), 'blocked')
        self.assertIsNone(egress.decide(policy, 'example.com', 443, 9))

    def test_http_exception_is_logged_without_response_contents(self):
        plan = egress.Plan('http://127.0.0.1:3000', None, None)
        plan.token = lambda: 'test-token'
        opener = Mock()
        opener.open.side_effect = http.client.BadStatusLine('private-response')
        with patch.object(egress.urllib.request, 'build_opener', return_value=opener), patch.object(egress, 'log') as log:
            self.assertIsNone(plan.request('GET', '/test'))
        self.assertNotIn('private-response', log.call_args.args[0])

    def test_identifier_newlines_are_rejected(self):
        for pattern, value in ((common.SLUG_RE, 'alpha'), (common.PROFILE_RE, 'alpha_7'),
                               (common.ENV_NAME_RE, 'ABC'), (common.PROJECT_KEY_RE, 'ABC')):
            self.assertIsNone(pattern.match(value + '\n'))
        self.assertFalse(common.valid_slug('alpha\n'))
        self.assertIsNone(common.profile_slug('alpha_7\n'))

    def test_plan_service_has_a_memory_limit(self):
        unit = (ISOLATION / 'systemd/volition-agent-plan.service').read_text()
        self.assertIn('MemoryMax=256M', unit)
        self.assertIn('LimitNOFILE=2048', unit)


class FileBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()

    def tearDown(self):
        self.temporary.cleanup()

    def test_registry_rejects_absolute_traversal_newline_and_non_dict_entries(self):
        config = types.SimpleNamespace(registry_root=str(self.root))
        invalid = [[], {'slug': 'alpha', 'project': []}, {'slug': 'alpha', 'project': {'key': '/etc'}},
                   {'slug': 'alpha', 'project': {'key': '../etc'}}, {'slug': 'alpha', 'project': {'key': 'ABC\n'}}]
        for entry in invalid:
            (self.root / 'alpha.json').write_text(json.dumps(entry))
            self.assertEqual(migrate.registry_projects(config), [])
        (self.root / 'alpha.json').write_text(json.dumps({'slug': 'alpha', 'project': {'key': 'ALPHA'}}))
        self.assertEqual(migrate.registry_projects(config), [('alpha', 'ALPHA')])

    def test_runtime_repair_does_not_make_privileged_files_public(self):
        for mode in (0o4750, 0o2750, 0o4755):
            program = self.root / 'helper'
            program.write_text('helper')
            program.chmod(mode)
            report = runtime_modes.walk(str(self.root), repair=True)
            self.assertEqual(stat.S_IMODE(program.stat().st_mode), mode)
            self.assertEqual(report.skipped, 1)
            self.assertTrue(any('privileged executable' in entry for entry in report.examples))
            self.assertEqual(runtime_modes.opened_mode(stat.S_IFREG | mode), mode)

    def test_runtime_root_cannot_have_symlink_parents(self):
        tree = self.root / 'tree'
        tree.mkdir()
        (tree / 'child').mkdir()
        (self.root / 'link').symlink_to(tree, target_is_directory=True)
        with self.assertRaises(SystemExit):
            runtime_modes.walk(str(self.root / 'link/child'), repair=True)

    def test_walkers_continue_after_an_entry_vanishes(self):
        (self.root / 'gone').write_text('gone')
        (self.root / 'kept').write_text('kept')
        original = os.stat

        def changed(path, *args, **kwargs):
            if path == 'gone':
                raise FileNotFoundError(path)
            return original(path, *args, **kwargs)

        visited = []
        with patch.object(os, 'stat', side_effect=changed):
            migrate.walk(str(self.root), lambda path, fd, info: visited.append(path))
            report = runtime_modes.walk(str(self.root))
            descriptor = common.open_path_nofollow(str(self.root))
            try:
                common.adopt_tree(descriptor, os.getuid(), os.getgid(), only_uid=os.getuid())
            finally:
                os.close(descriptor)
        self.assertIn(str(self.root / 'kept'), visited)
        self.assertEqual(report.entries, 2)

    def test_migration_walk_stops_at_depth_bound(self):
        directories = []
        path = self.root
        for _ in range(80):
            path = path / 'd'
            path.mkdir()
            directories.append(path)
        skipped = []
        visited = []
        try:
            with patch.object(os, 'fwalk', side_effect=AssertionError('recursive fwalk used')):
                migrate.walk(str(self.root), lambda path, fd, info: visited.append(path),
                             lambda path, reason: skipped.append(reason))
            self.assertEqual(len(visited), 65)
            self.assertEqual(skipped, ['depth limit'])
        finally:
            for directory in reversed(directories):
                directory.rmdir()

    def test_home_copy_refuses_root_before_any_path_write(self):
        with patch.object(os, 'geteuid', return_value=0), patch.object(os, 'mkdir') as mkdir:
            with self.assertRaises(common.IsolationError):
                migrate._copy_home_contents('/runner', '/runner/profiles/home')
        mkdir.assert_not_called()

    def test_home_copy_drops_groups_and_uid_before_copying(self):
        calls = []
        config = types.SimpleNamespace(profiles_root=str(self.root), home_slug='home', runner_user='runner')
        account = types.SimpleNamespace(pw_uid=1234, pw_gid=1234, pw_name='runner')
        class ChildExit(BaseException):
            pass
        with patch.object(migrate.pwd, 'getpwnam', return_value=account), \
                patch.object(os, 'fork', return_value=0), \
                patch.object(os, 'initgroups', side_effect=lambda *args: calls.append('groups')), \
                patch.object(os, 'setgid', side_effect=lambda *args: calls.append('gid')), \
                patch.object(os, 'setuid', side_effect=lambda *args: calls.append('uid')), \
                patch.object(migrate, '_copy_home_contents', side_effect=lambda *args: calls.append('copy')), \
                patch.object(os, '_exit', side_effect=ChildExit):
            with self.assertRaises(ChildExit):
                migrate.copy_home_profile(config, str(self.root), account, migrate.Changes(False))
        self.assertEqual(calls, ['groups', 'gid', 'uid', 'copy'])


class ProofTest(unittest.TestCase):
    def test_profile_helper_has_no_live_secret_binds_or_links(self):
        config = harness.test_config(str(ISOLATION))
        for name in ('hermes', 'profile-helper'):
            runtime = config['runtimes'][name]
            self.assertEqual(runtime['optionalReadOnly'], [])
            self.assertEqual(runtime['credentialBinds'], [])
            for value in runtime['profileLinks'].values():
                self.assertTrue(value.startswith(harness.ROOT), value)

    def test_trust_check_refuses_writable_ancestors_and_symlinks(self):
        for mode, owner in ((stat.S_IFDIR | 0o775, 0), (stat.S_IFDIR | 0o755, 1000),
                            (stat.S_IFLNK | 0o777, 0)):
            with patch.object(os, 'lstat', return_value=types.SimpleNamespace(st_mode=mode, st_uid=owner)):
                with self.assertRaises(SystemExit):
                    harness.require_trusted_path('/opt/helena-proof/harness.py')

    def test_proof_launcher_cannot_change_live_preview_state_or_firewall(self):
        self.assertIn('--property=PrivateNetwork=yes', harness.PROOF_LAUNCHER_OPTIONS)
        self.assertIn('--setenv=HELENA_PREVIEW_RUNTIME_ROOT=/run/vpt-previews', harness.PROOF_LAUNCHER_OPTIONS)
        self.assertIn('--setenv=HELENA_PREVIEW_STATE_ROOT=/srv/vpt-test/preview-state', harness.PROOF_LAUNCHER_OPTIONS)
        program = ('import helena_previews as p; print(p.RUNTIME_ROOT); print(p.STATE_ROOT)')
        environment = {**os.environ, 'PYTHONPATH': str(ISOLATION),
                       'HELENA_PREVIEW_RUNTIME_ROOT': '/run/vpt-previews',
                       'HELENA_PREVIEW_STATE_ROOT': '/srv/vpt-test/preview-state'}
        import subprocess
        done = subprocess.run([sys.executable, '-c', program], env=environment, capture_output=True, text=True, check=True)
        self.assertEqual(done.stdout.splitlines(), ['/run/vpt-previews', '/srv/vpt-test/preview-state'])

    def test_owner_files_are_opened_in_a_runuser_process(self):
        with patch.object(harness, 'sh', return_value=types.SimpleNamespace(stdout=b'{}')) as run:
            harness.owner_file('report.json', b'{}')
        args = run.call_args.args
        self.assertEqual(args[:6], ('/usr/sbin/runuser', '-u', 'wilhelmpa', '--', '/usr/bin/python3', '-I'))
        self.assertEqual(run.call_args.kwargs['input'], b'{}')
        with self.assertRaises(ValueError):
            harness.owner_file('../../anything', b'{}')

    def test_proxy_negative_proofs_require_a_real_403_and_disable_no_proxy(self):
        checks = []
        def probe(slug, profile, specs):
            checks.extend(specs)
            return {spec: {'ok': False, 'detail': 'rc=7 http=000 connect=000'} for spec in specs}
        report = harness.Report()
        with patch.object(harness, 'probe', side_effect=probe), contextlib.redirect_stdout(io.StringIO()):
            harness.prove_2_egress_blocks(report)
        self.assertTrue(all(spec.startswith('curl:--noproxy,,') for spec in checks))
        self.assertTrue(all(not result['ok'] for result in report.results))


class LauncherLifecycleTest(unittest.IsolatedAsyncioTestCase):
    def fake_process(self):
        exited = asyncio.Event()
        blocked = asyncio.Event()
        process = types.SimpleNamespace(returncode=None, stdout=asyncio.StreamReader(), stderr=asyncio.StreamReader())

        async def drain():
            blocked.set()
            await asyncio.Event().wait()

        async def wait():
            await exited.wait()
            return process.returncode

        def kill():
            process.returncode = -9
            process.stdout.feed_eof()
            process.stderr.feed_eof()
            exited.set()

        process.stdin = types.SimpleNamespace(write=Mock(), drain=drain, is_closing=lambda: False, close=Mock())
        process.wait = wait
        process.kill = Mock(side_effect=kill)
        return process, blocked

    async def test_blocked_stdin_does_not_hide_disconnect_and_late_unit_is_stopped_again(self):
        worker = launcher.Launcher.__new__(launcher.Launcher)
        worker.stop_unit = AsyncMock()
        process, blocked = self.fake_process()
        reader = asyncio.StreamReader()
        reader.feed_data(launcher.frame(launcher.T_STDIN, b'task'))
        writer = types.SimpleNamespace(write=Mock(), drain=AsyncMock())
        original = asyncio.wait_for

        async def timeout_wait(awaitable, seconds):
            if seconds == 30:
                raise asyncio.TimeoutError
            return await original(awaitable, seconds)

        with patch.object(launcher.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)), \
                patch.object(launcher.asyncio, 'wait_for', side_effect=timeout_wait):
            stream = asyncio.create_task(worker.stream(['test'], 'test.service', {}, reader, writer))
            await original(blocked.wait(), 1)
            reader.feed_eof()
            await original(stream, 1)
        process.kill.assert_called_once()
        self.assertEqual(worker.stop_unit.await_count, 2)

    async def test_output_failure_stops_the_unit_while_stdin_is_open(self):
        worker = launcher.Launcher.__new__(launcher.Launcher)
        process, _blocked = self.fake_process()
        worker.stop_unit = AsyncMock(side_effect=lambda _unit: process.kill())
        process.stdout.feed_data(b'output')
        writer = types.SimpleNamespace(write=Mock(), drain=AsyncMock(side_effect=ConnectionError))
        with patch.object(launcher.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)):
            await asyncio.wait_for(worker.stream(['test'], 'test.service', {}, asyncio.StreamReader(), writer), 1)
        worker.stop_unit.assert_awaited_once()

    async def test_busy_terminal_does_not_allocate_a_pty(self):
        worker = launcher.Launcher.__new__(launcher.Launcher)
        worker.config = common.load_config(str(ISOLATION / 'launcher.json'), require_root=False)
        account = types.SimpleNamespace(pw_name='vp-alpha')
        worker.ensure_terminal_host = AsyncMock(return_value=(account, '/terminal', '/workspace'))
        worker.sandbox_properties = Mock(return_value=[])
        worker.reserve = AsyncMock(side_effect=common.IsolationError('busy', 'busy'))
        with patch.object(os, 'openpty') as pty:
            with self.assertRaises(common.IsolationError):
                await worker.terminal({'slug': 'alpha'}, None, None, 'caller')
        pty.assert_not_called()

    async def test_standalone_socket_sets_activation_false(self):
        worker = types.SimpleNamespace(stop_orphans=AsyncMock(), handle=Mock(),
                                       previews=types.SimpleNamespace(reconcile=AsyncMock(), servers={}))
        class Server:
            async def __aenter__(self):
                raise asyncio.CancelledError
            async def __aexit__(self, *args):
                return False
        with patch.dict(os.environ, {'LISTEN_FDS': '0', 'VOLITION_LAUNCHER_SOCKET': '/test.sock'}), \
                patch.object(launcher, 'Launcher', return_value=worker), \
                patch.object(launcher.socket, 'socket', return_value=Mock()), \
                patch.object(os, 'unlink'), patch.object(os, 'chown'), patch.object(os, 'chmod'), \
                patch.object(launcher.grp, 'getgrnam', return_value=types.SimpleNamespace(gr_gid=123)), \
                patch.object(launcher, 'unix_server_options', return_value={}) as options, \
                patch.object(launcher.asyncio, 'start_unix_server', AsyncMock(return_value=Server())):
            with self.assertRaises(asyncio.CancelledError):
                await launcher.serve(Mock())
        options.assert_called_once_with(False)


if __name__ == '__main__':
    unittest.main()
