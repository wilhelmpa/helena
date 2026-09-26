"""Preview boundaries, actual readiness and byte forwarding without privileged services."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import signal
import socket
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import helena_previews as previews
import helena_preview_firewall as firewall
import helena_preview_worker as worker
from isolation_common import IsolationError
import launcher as launcher_module


class PreviewCommandsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def package(self, name='astro', script='astro dev'):
        (self.root / 'package.json').write_text(json.dumps({'scripts': {'dev': script}, 'dependencies': {name: '*'}}))
        binary = self.root / 'node_modules/.bin' / name
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.touch()

    def test_detects_three_installed_frameworks_and_overrides_host_and_port(self):
        for name, script, flag in [('astro', 'astro dev', '--host'), ('vite', 'vite', '--host'),
                                   ('next', 'next dev', '--hostname')]:
            self.package(name, script)
            args, display = previews.development_command(str(self.root), None, 24008)
            self.assertIn(flag, args)
            self.assertIn('127.0.0.1', args)
            self.assertIn('24008', args)
            self.assertEqual(display, script)
            self.assertEqual('--strictPort' in args, name == 'vite')

    def test_package_manager_dev_aliases_resolve_to_local_binary_without_install(self):
        self.package()
        for value in ('npm run dev', 'bun run dev'):
            args, _ = previews.development_command(str(self.root), value, 24000)
            self.assertEqual(args[0], str(self.root / 'node_modules/.bin/astro'))

    def test_safe_framework_flags_are_preserved_but_network_flags_are_owned(self):
        self.package('vite', 'vite --mode development --config vite.config.ts --base /app')
        args, display = previews.development_command(str(self.root), None, 24000)
        self.assertIn('--mode', args)
        self.assertIn('vite.config.ts', args)
        self.assertIn('--base /app', display)
        for command in ('vite --port 80', 'vite --host', 'vite --config ../other/config.ts',
                        'vite --config /etc/anything', 'vite --open'):
            with self.assertRaises(IsolationError):
                previews.development_command(str(self.root), command, 24000)

    def test_refuses_shell_injection_downloads_and_custom_hosts(self):
        self.package()
        for command in ('npm install && astro dev', 'npx astro dev', 'astro dev; curl bad',
                        'astro dev --host 0.0.0.0', 'env TOKEN=secret astro dev', 'cat /etc/shadow', 12):
            with self.assertRaises(IsolationError):
                previews.development_command(str(self.root), command, 24000)

    def test_missing_dependencies_are_actionable_without_installing(self):
        self.package()
        (self.root / 'node_modules/.bin/astro').unlink()
        with self.assertRaisesRegex(IsolationError, 'dependencies are missing'):
            previews.development_command(str(self.root), None, 24000)

    def test_relative_cwd_cannot_escape_or_follow_symlink(self):
        (self.root / 'app').mkdir()
        self.assertEqual(previews.working_directory(str(self.root), 'app'), str(self.root / 'app'))
        (self.root / 'linked').symlink_to('/tmp')
        for value in ('../other', '/etc', 'linked', 'missing', 'app/../../other', 4):
            with self.assertRaises(IsolationError):
                previews.working_directory(str(self.root), value)

    def test_reads_regular_bounded_json_only(self):
        secret = self.root / 'other'
        secret.write_text('{"content":"not-to-read"}')
        (self.root / 'link').symlink_to(secret)
        self.assertEqual(previews.read_json(self.root / 'link'), {})
        self.assertEqual(previews.read_json(secret, maximum=4), {})
        self.assertEqual(previews.read_json(self.root), {})

    def test_finds_unique_nested_app_and_refuses_ambiguous_apps(self):
        app = self.root / 'homepage/homepage'
        app.mkdir(parents=True)
        (app / 'package.json').write_text(json.dumps({'scripts': {'dev': 'astro dev'}}))
        self.assertEqual(previews.discover_directory(str(self.root)), str(app))
        other = self.root / 'other'
        other.mkdir()
        (other / 'package.json').write_text(json.dumps({'scripts': {'dev': 'vite'}}))
        with self.assertRaisesRegex(IsolationError, 'no unique'):
            previews.discover_directory(str(self.root))

    def test_app_discovery_does_not_follow_symlinks_or_scan_node_modules(self):
        outside = self.root / 'node_modules/vendor'
        outside.mkdir(parents=True)
        (outside / 'package.json').write_text(json.dumps({'scripts': {'dev': 'astro dev'}}))
        (self.root / 'linked').symlink_to(outside)
        with self.assertRaises(IsolationError):
            previews.discover_directory(str(self.root))

    def test_port_ranges_are_unique_and_bounded(self):
        assigned = [set(previews.ports(uid, 58000)) for uid in range(58000, 58900)]
        self.assertEqual(sum(len(value) for value in assigned), 7200)
        self.assertEqual(len(set.union(*assigned)), 7200)
        self.assertEqual(min(assigned[0]), 24000)
        self.assertEqual(max(assigned[-1]), 31199)

    def test_only_allowlisted_operations_and_fields(self):
        self.assertEqual(set(previews.OPS), {'preview-start', 'preview-stop', 'preview-status', 'preview-logs'})
        for keys in previews.OPS.values():
            self.assertTrue({'v', 'op', 'slug'} <= keys)
            self.assertTrue({'user', 'env', 'properties', 'port', 'socket'} .isdisjoint(keys))

    def test_log_redaction_and_line_limit(self):
        line = worker.clean_line('token=abc password=hunter2 api_key=xyz https://user:pass@example.com \x1b[31mred')
        self.assertNotIn('abc', line)
        self.assertNotIn('hunter2', line)
        self.assertNotIn('xyz', line)
        self.assertNotIn('user:pass', line)
        self.assertNotIn('\x1b', line)
        self.assertEqual(len(worker.clean_line('a' * 10000)), 1000)


class PreviewFirewallTest(unittest.TestCase):
    def test_rules_allow_only_matching_browser_cgroup_and_own_port_block(self):
        config = types.SimpleNamespace(uid_range=(58000, 58899))
        path = 'system.slice/system-volition\\x2dproject\\x2dbrowser\\x2dchromium.slice/volition-project-browser-chromium@vol.service'
        text = firewall.rules(config, [('vol', path, 123, 58004)], 995, 33)
        self.assertIn('tcp dport 24032-24039 socket cgroupv2 level 3 "' + path + '" accept', text)
        self.assertIn('meta skuid 995 tcp dport', text)
        self.assertIn('iifname != "lo" tcp dport 24000-31199 reject', text)
        self.assertIn('reject with tcp reset comment "helena:preview-own-project"', text)
        self.assertNotIn('meta skuid 995 accept', text)
        self.assertNotIn('\\\\x2d', text)

    def test_an_empty_cgroup_list_keeps_default_deny(self):
        text = firewall.rules(types.SimpleNamespace(uid_range=(58000, 58899)), [], 995, 33)
        self.assertNotIn('socket cgroupv2', text)
        self.assertIn('helena:preview-own-project', text)


class PreviewIOTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()

    async def asyncTearDown(self):
        self.temporary.cleanup()

    async def test_readiness_waits_for_http_success(self):
        async def respond(reader, writer):
            await reader.readuntil(b'\r\n\r\n')
            writer.write(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok')
            await writer.drain()
            writer.close()
        server = await asyncio.start_server(respond, '127.0.0.1', 0)
        port = server.sockets[0].getsockname()[1]
        self.assertTrue(await worker.ready(port))
        server.close()
        await server.wait_closed()
        self.assertFalse(await worker.ready(port))

    async def test_readiness_does_not_accept_a_tcp_listener_or_503(self):
        async def respond(reader, writer):
            await reader.read(1024)
            writer.write(b'HTTP/1.1 503 Not Ready\r\n\r\n')
            await writer.drain()
            writer.close()
        server = await asyncio.start_server(respond, '127.0.0.1', 0)
        self.assertFalse(await worker.ready(server.sockets[0].getsockname()[1]))
        server.close()
        await server.wait_closed()

    async def test_unix_byte_proxy_preserves_websocket_upgrade_and_frames(self):
        supervisor = worker.Supervisor(str(self.root), 0, 60, [])
        async def echo(reader, writer):
            while data := await reader.read(4096):
                writer.write(data)
                await writer.drain()
            writer.close()
        upstream = await asyncio.start_server(echo, '127.0.0.1', 0)
        supervisor.port = upstream.sockets[0].getsockname()[1]
        proxy = await asyncio.start_unix_server(supervisor.connection, path=str(self.root / 'http.sock'))
        reader, writer = await asyncio.open_unix_connection(str(self.root / 'http.sock'))
        value = b'GET / HTTP/1.1\r\nUpgrade: websocket\r\n\r\n\x81\x02ok'
        writer.write(value)
        await writer.drain()
        self.assertEqual(await asyncio.wait_for(reader.readexactly(len(value)), 2), value)
        writer.close()
        await writer.wait_closed()
        proxy.close()
        upstream.close()
        await proxy.wait_closed()
        await upstream.wait_closed()

    async def test_log_ring_remains_bounded_with_unterminated_output(self):
        supervisor = worker.Supervisor(str(self.root), 1, 60, [])
        reader = asyncio.StreamReader()
        reader.feed_data(('password=secret\n' * 250 + 'x' * 12000).encode())
        reader.feed_eof()
        await supervisor.logs(reader)
        self.assertEqual(len(supervisor.lines), 200)
        self.assertTrue(all(len(value) <= 1000 for value in supervisor.lines))
        self.assertNotIn('secret', '\n'.join(supervisor.lines))

    async def test_firewall_failure_is_not_ignored(self):
        config = types.SimpleNamespace(browser={'user': 'browser'}, uid_range=(58000, 58899))
        with patch.object(firewall, 'browser_groups', return_value=[]), \
                patch.object(firewall.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=995)), \
                patch.object(firewall, 'nft', new=AsyncMock(return_value=1)):
            with self.assertRaisesRegex(IsolationError, 'firewall could not'):
                await firewall.sync(config, None)

    async def test_browser_cgroup_recreation_refreshes_rules(self):
        config = types.SimpleNamespace(browser={'user': 'browser'}, uid_range=(58000, 58899))
        nft = AsyncMock(return_value=0)
        with patch.object(firewall, 'browser_groups', return_value=[('vol', 'a/b', 1, 58004)]) as groups, \
                patch.object(firewall.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=995)), \
                patch.object(firewall, 'nft', new=nft):
            previous = await firewall.sync(config, None)
            groups.return_value = [('vol', 'a/b', 2, 58004)]
            await firewall.sync(config, previous)
        self.assertEqual(nft.await_count, 2)
        self.assertTrue(all(call.args == ('-f', '-') for call in nft.await_args_list))

    async def test_real_supervisor_survives_request_and_stops_after_idle(self):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        supervisor = worker.Supervisor(str(self.root), port, 1,
                                       [sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'])
        task = asyncio.create_task(supervisor.run())
        try:
            for _ in range(100):
                if supervisor.state['status'] == 'running':
                    break
                await asyncio.sleep(.05)
            self.assertEqual(supervisor.state['status'], 'running')
            reader, writer = await asyncio.open_unix_connection(str(self.root / 'http.sock'))
            writer.write(b'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
            await writer.drain()
            self.assertIn(b'200 OK', await reader.read(10000))
            writer.close()
            await writer.wait_closed()
            self.assertFalse(task.done())
            await asyncio.wait_for(task, 4)
            self.assertEqual(supervisor.state['status'], 'stopped')
            self.assertIn('inactivity', supervisor.state['error'])
            self.assertFalse((self.root / 'http.sock').exists())
        finally:
            supervisor.stop.set()
            await task
            for signum in (signal.SIGINT, signal.SIGTERM):
                asyncio.get_running_loop().remove_signal_handler(signum)

    async def test_failed_readiness_terminates_child_and_preserves_log_tail(self):
        supervisor = worker.Supervisor(str(self.root), 1, 60,
                                       [sys.executable, '-u', '-c', 'import time; print("starting"); time.sleep(30)'],
                                       timeout=.2)
        try:
            self.assertEqual(await supervisor.run(), 1)
            state = previews.read_json(self.root / 'status.json')
            self.assertEqual(state['status'], 'failed')
            self.assertIn('readiness', state['error'])
            self.assertIn('starting', state['lines'])
            self.assertFalse((self.root / 'http.sock').exists())
        finally:
            for signum in (signal.SIGINT, signal.SIGTERM):
                asyncio.get_running_loop().remove_signal_handler(signum)

    async def test_second_start_waits_for_the_first_start_readiness(self):
        launcher = types.SimpleNamespace(config=types.SimpleNamespace())
        manager = previews.Previews(launcher)
        manager.snapshot = lambda _value: {'status': 'starting'}
        manager.await_ready = AsyncMock(return_value={'preview': {'status': 'running'}})
        existing = {'name': 'main', 'slug': 'vol', 'cwd': 'homepage', 'command': 'astro dev'}
        value = await manager.start({'slug': 'vol'}, None, [], existing)
        self.assertEqual(value['preview']['status'], 'running')
        manager.await_ready.assert_awaited_once_with(existing)

    async def test_retired_slot_cannot_inherit_the_replacement_status_or_logs(self):
        manager = previews.Previews(types.SimpleNamespace(config=types.SimpleNamespace()))
        manager.runtime = self.root
        directory = self.root / 'vol/24032'
        directory.mkdir(parents=True)
        previews.write_json(directory / 'status.json', {'status': 'running', 'heartbeatAt': worker.now(),
                                                       'lines': ['new preview output']})
        old = {'name': 'old', 'slug': 'vol', 'port': 24032, 'retired': True}
        self.assertEqual(manager.snapshot(old)['status'], 'stopped')
        self.assertEqual(manager.lines(old, 20), [])

    async def test_stale_heartbeat_does_not_report_a_crashed_preview_running(self):
        manager = previews.Previews(types.SimpleNamespace(config=types.SimpleNamespace()))
        manager.runtime = self.root
        directory = self.root / 'vol/24032'
        directory.mkdir(parents=True)
        previews.write_json(directory / 'status.json', {'status': 'running', 'heartbeatAt': worker.now() - 11000})
        self.assertEqual(manager.snapshot({'name': 'main', 'slug': 'vol', 'port': 24032})['status'], 'failed')

    async def test_unicode_logs_fit_the_launcher_reply_limit(self):
        supervisor = worker.Supervisor(str(self.root), 1, 60, [])
        supervisor.lines.extend(['𝒜' * 1000] * 200)
        supervisor.save()
        self.assertLess((self.root / 'status.json').stat().st_size, 256 * 1024)
        self.assertTrue(previews.read_json(self.root / 'status.json')['lines'])

    async def test_api_socket_identity_is_limited_to_preview_operations(self):
        instance = launcher_module.Launcher.__new__(launcher_module.Launcher)
        instance.config = types.SimpleNamespace(callers=('volition-hermes',))
        instance.previews = types.SimpleNamespace(request=AsyncMock(return_value={'previews': []}))
        class Writer:
            def __init__(self):
                self.data = b''
            def get_extra_info(self, _name):
                return None
            def write(self, data):
                self.data += data
            async def drain(self):
                pass
            def close(self):
                pass
            async def wait_closed(self):
                pass
        for request, expected in [({'v': 1, 'op': 'preview-status', 'slug': 'vol'}, launcher_module.T_RESULT),
                                  ({'v': 1, 'op': 'ensure-project-user', 'slug': 'vol'}, launcher_module.T_ERROR),
                                  ({'v': 1, 'op': 'preview-start', 'slug': 'vol', 'port': 80}, launcher_module.T_ERROR)]:
            reader = asyncio.StreamReader()
            reader.feed_data(json.dumps(request).encode() + b'\n')
            writer = Writer()
            with patch.object(launcher_module, 'peer_credentials', return_value=(1, 1234, 1)), \
                    patch.object(launcher_module.pwd, 'getpwuid', return_value=types.SimpleNamespace(pw_name='volition-plan')):
                await instance.handle(reader, writer)
            self.assertEqual(writer.data[0], expected)
        self.assertEqual(instance.previews.request.await_count, 1)

    @unittest.skipUnless(hasattr(socket, 'SO_PEERCRED'), 'Linux peer credentials')
    async def test_replaced_socket_cannot_forward_to_another_identity(self):
        received = []
        async def endpoint(reader, writer):
            data = await reader.read(100)
            received.append(data)
            if data:
                writer.write(b'own-project-response')
                await writer.drain()
            writer.close()
        server = await asyncio.start_unix_server(endpoint, str(self.root / 'actual.sock'))
        manager = previews.Previews(types.SimpleNamespace(config=types.SimpleNamespace()))
        manager.runtime = self.root
        directory = self.root / 'vol/24032'
        directory.mkdir(parents=True)
        (directory / 'http.sock').symlink_to(self.root / 'actual.sock')
        preview = {'slug': 'vol', 'port': 24032}
        proxy = await asyncio.start_server(lambda r, w: manager.connection(preview, r, w), '127.0.0.1', 0)
        try:
            for expected_uid, expected_response in [(os.getuid() + 1, b''), (os.getuid(), b'own-project-response')]:
                manager.launcher.project_account = lambda _slug: types.SimpleNamespace(pw_uid=expected_uid)
                reader, writer = await asyncio.open_connection('127.0.0.1', proxy.sockets[0].getsockname()[1])
                writer.write(b'project-request')
                await writer.drain()
                self.assertEqual(await asyncio.wait_for(reader.read(100), 2), expected_response)
                writer.close()
                await writer.wait_closed()
            self.assertEqual(received, [b'', b'project-request'])
        finally:
            proxy.close()
            server.close()
            await proxy.wait_closed()
            await server.wait_closed()


if __name__ == '__main__':
    unittest.main()
