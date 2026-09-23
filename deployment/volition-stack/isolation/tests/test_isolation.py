"""Unit tests of the agent isolation's pieces: what can be checked without root and without
systemd. The proofs with real users, units and sockets are in ../proof (run on Kingston)."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ISOLATION = HERE.parent
sys.path.insert(0, str(ISOLATION))

import isolation_common as common  # noqa: E402
import egress  # noqa: E402
import plan_proxy  # noqa: E402
import sandbox  # noqa: E402


def config_file(directory: Path, **overrides) -> Path:
    with open(ISOLATION / 'launcher.json', encoding='utf-8') as handle:
        config = json.load(handle)
    config.update(overrides)
    path = directory / 'launcher.json'
    path.write_text(json.dumps(config))
    return path


class NamesTest(unittest.TestCase):
    def test_slugs(self):
        for slug in ('verve', 'vol', 'a', 'a-b', 'x' * 29):
            self.assertTrue(common.valid_slug(slug), slug)
        for slug in ('', 'Verve', '-a', 'a-', 'a--b', '../x', 'x' * 30, 'root', 'hermes', 'a b', 'a_b'):
            self.assertFalse(common.valid_slug(slug), slug)

    def test_profiles(self):
        self.assertEqual(common.profile_slug('verve'), 'verve')
        self.assertEqual(common.profile_slug('verve_11'), 'verve')
        self.assertIsNone(common.profile_slug('verve_0'))
        self.assertIsNone(common.profile_slug('../verve'))

    def test_unit_names_carry_project_agent_and_run(self):
        name = common.unit_name('volition-agent-', 'vol', 12, 'r', 345, 'abcdef012345')
        self.assertEqual(name, 'volition-agent-vol--a12-r345-abcdef012345.service')
        self.assertEqual(common.parse_unit(name, 'volition-agent-'),
                         {'unit': name, 'slug': 'vol', 'agentId': 12, 'kind': 'r', 'runId': 345, 'messageId': None})
        chat = common.unit_name('volition-agent-', 'home', None, 'c', 9, 'abcdef012345')
        self.assertEqual(common.parse_unit(chat, 'volition-agent-')['messageId'], 9)
        self.assertIsNone(common.parse_unit(name, 'vpt-agent-'))
        self.assertIsNone(common.parse_unit('volition-terminal-vol.service', 'volition-agent-'))


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_reads_the_shipped_configuration(self):
        config = common.load_config(str(config_file(self.dir)), require_root=False)
        self.assertEqual(config.user_prefix, 'vp-')
        self.assertEqual(config.forwards, {'egress': 3128, 'plan': 3000})
        self.assertEqual(set(config.runtimes), {'hermes', 'claude', 'codex', 'profile-helper'})
        self.assertIn('/var/lib/volition', config.hide)
        self.assertIn('/etc/volition', config.inaccessible)
        self.assertFalse(config.runtimes['profile-helper'].caller_args)

    def test_refuses_a_file_others_can_write_when_root_reads_it(self):
        path = config_file(self.dir)
        os.chmod(path, 0o666)
        with self.assertRaises(common.IsolationError):
            common.load_config(str(path), require_root=True)

    def test_refuses_invalid_values(self):
        for overrides in ({'userPrefix': 'root'}, {'uidRange': [0, 10]}, {'forwards': {'egress': 80}},
                          {'forwards': {'nope': 4000}}, {'workspaceRoot': 'relative'}, {'callers': []}):
            with self.subTest(overrides=overrides), self.assertRaises(common.IsolationError):
                common.load_config(str(config_file(self.dir, **overrides)), require_root=False)


class AclTest(unittest.TestCase):
    def test_round_trip_and_mask(self):
        base = common._base_entries(0o700)
        entries = common.acl_with(base, {(common.ACL_USER, 58001): 7, (common.ACL_GROUP, 990): 5})
        decoded = common.acl_decode(common.acl_encode(entries))
        self.assertEqual(sorted(decoded), sorted(entries))
        mask = [p for t, p, _ in decoded if t == common.ACL_MASK]
        self.assertEqual(mask, [7])
        # Named entries are replaced, not repeated, and others survive.
        again = common.acl_with(decoded, {(common.ACL_USER, 58001): 5})
        self.assertEqual([e for e in again if e[0] == common.ACL_USER], [(common.ACL_USER, 5, 58001)])
        self.assertIn((common.ACL_GROUP, 5, 990), again)

    def test_removing_the_last_named_entry_drops_the_mask(self):
        base = common.acl_with(common._base_entries(0o750), {(common.ACL_USER, 1): 7})
        stripped = common.acl_with(base, {}, remove={(common.ACL_USER, 1)})
        self.assertFalse(any(t in (common.ACL_MASK, common.ACL_USER) for t, _, _ in stripped))

    def test_refuses_malformed_data(self):
        with self.assertRaises(ValueError):
            common.acl_decode(b'\x02\x00\x00\x00\x01')


class HttpHeadTest(unittest.TestCase):
    def test_reads_a_strict_head(self):
        head = common.parse_request_head(b'GET /me HTTP/1.1\r\nHost: x\r\nX-Api-Key: k\r\n\r\n')
        self.assertEqual((head.method, head.target, head.version), ('GET', '/me', 'HTTP/1.1'))
        self.assertEqual(head.get('x-api-key'), ['k'])

    def test_refuses_what_proxies_disagree_on(self):
        for raw in (b'GET /me HTTP/1.1\r\nHost: x\r\n y: z\r\n\r\n',
                    b'GET /me HTTP/1.1\r\nHost : x\r\n\r\n',
                    b'GET /me HTTP/1.1\r\nA: b\nC: d\r\n\r\n',
                    b'GET /me HTTP/2\r\n\r\n',
                    b'GET  /me HTTP/1.1\r\n\r\n',
                    b'GET /m\x7fe HTTP/1.1\r\n\r\n'):
            with self.subTest(raw=raw), self.assertRaises(common.HttpError):
                common.parse_request_head(raw)

    def test_hosts(self):
        self.assertEqual(common.split_host_port('Example.COM:443', None), ('example.com', 443))
        self.assertEqual(common.split_host_port('[::1]:80', None), ('::1', 80))
        self.assertEqual(common.split_host_port('bücher.de', 80), ('xn--bcher-kva.de', 80))
        for value in ('evil.com:443:1', 'a b:80', 'x:0', 'x:99999', '2130706433', 'x:', '[::1'):
            with self.subTest(value=value), self.assertRaises(common.HttpError):
                common.split_host_port(value, 80 if ':' not in value else None)


class EgressTest(unittest.TestCase):
    def test_only_public_addresses(self):
        policy = egress.AddressPolicy()
        policy.local = {egress.ipaddress.ip_address('203.0.114.7')}
        policy.refreshed = float('inf')
        for address in ('93.184.215.14', '1.1.1.1', '2606:4700::1111'):
            self.assertTrue(policy.public(address), address)
        for address in ('127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.122.1', '169.254.169.254',
                        '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1',
                        'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:a00:1::1',
                        '2001::1', '198.18.0.1', '203.0.114.7', 'not-an-ip'):
            self.assertFalse(policy.public(address), address)

    def test_modes_ports_and_lists(self):
        open_policy = {'mode': 'open', 'deny': ['bank.example'], 'allow': [], 'mailPorts': False, 'agents': {}}
        self.assertIsNone(egress.decide(open_policy, 'example.com', 443))
        self.assertEqual(egress.decide(open_policy, 'online.bank.example', 443), 'denylisted')
        self.assertEqual(egress.decide(open_policy, 'smtp.example.com', 587), 'port')
        self.assertEqual(egress.decide(open_policy, 'example.com', 22), 'port')
        mail = {**open_policy, 'mailPorts': True}
        for port in (465, 587, 993):
            self.assertIsNone(egress.decide(mail, 'imap.example.com', port))
        allow = {**open_policy, 'mode': 'allowlist', 'allow': ['github.com'], 'deny': ['gist.github.com']}
        self.assertIsNone(egress.decide(allow, 'api.github.com', 443))
        self.assertEqual(egress.decide(allow, 'gist.github.com', 443), 'denylisted')
        self.assertEqual(egress.decide(allow, 'github.com.evil.com', 443), 'not-allowlisted')
        blocked = {**open_policy, 'mode': 'blocked'}
        self.assertEqual(egress.decide(blocked, 'example.com', 443), 'blocked')

    def test_an_agent_mode_beats_the_project_mode(self):
        policy = {'mode': 'open', 'allow': ['example.net'], 'deny': [], 'agents': {'7': 'blocked', '8': 'allowlist'}}
        self.assertEqual(egress.decide(policy, 'example.com', 443, 7), 'blocked')
        self.assertEqual(egress.decide(policy, 'example.com', 443, 8), 'not-allowlisted')
        self.assertIsNone(egress.decide(policy, 'example.net', 443, 8))
        self.assertIsNone(egress.decide(policy, 'example.com', 443, 9))
        self.assertIsNone(egress.decide(policy, 'example.com', 443, None))
        self.assertEqual(egress.effective_mode({'mode': 'weird'}, None), 'open')

    def test_the_model_endpoints_stay_reachable(self):
        blocked = {'mode': 'blocked', 'allow': [], 'deny': ['anthropic.com'], 'agents': {}}
        models = ('api.anthropic.com', 'chatgpt.com')
        self.assertIsNone(egress.decide(blocked, 'api.anthropic.com', 443, None, models))
        self.assertEqual(egress.decide(blocked, 'api.anthropic.com', 80, None, models), 'blocked')
        self.assertEqual(egress.decide(blocked, 'example.com', 443, None, models), 'blocked')

    def test_reads_the_shipped_settings(self):
        settings = egress.load_settings(str(ISOLATION / 'egress.json'))
        self.assertIn('api.anthropic.com', settings['modelHosts'])
        self.assertEqual(egress.load_settings('/nonexistent')['modelHosts'], ())


class PlanProxyBodyTest(unittest.TestCase):
    def forwarded(self, data: bytes, length: int, chunked: bool) -> bytes:
        async def scenario():
            reader = asyncio.StreamReader()
            reader.feed_data(data)
            reader.feed_eof()
            sent = bytearray()
            upstream = types.SimpleNamespace(write=sent.extend, drain=lambda: asyncio.sleep(0))
            proxy = plan_proxy.PlanProxy(('127.0.0.1', 3000), 'vp-', 'volition-agent-', 'volition-agents')
            await proxy.body(reader, upstream, length, chunked)
            return bytes(sent), await reader.read()

        return asyncio.run(scenario())

    def test_forwards_exactly_one_body(self):
        sent, left = self.forwarded(b'abcdGET /projects HTTP/1.1\r\n\r\n', 4, False)
        self.assertEqual(sent, b'abcd')
        self.assertEqual(left, b'GET /projects HTTP/1.1\r\n\r\n')

    def test_reframes_a_chunked_body_and_drops_trailers(self):
        sent, left = self.forwarded(b'3;x=y\r\nabc\r\n0\r\nX-Trailer: 1\r\n\r\nGET / HTTP/1.1\r\n\r\n', 0, True)
        self.assertEqual(sent, b'3\r\nabc\r\n0\r\n\r\n')
        self.assertEqual(left, b'GET / HTTP/1.1\r\n\r\n')

    def test_refuses_a_broken_chunk(self):
        for data in (b'zz\r\n', b'3\r\nabcX\r\n', b'fffffffff\r\n'):
            with self.subTest(data=data), self.assertRaises((common.HttpError, asyncio.IncompleteReadError)):
                self.forwarded(data, 0, True)


class SandboxTest(unittest.TestCase):
    def test_splits_options_from_the_command(self):
        args = sandbox.parse(['run', '--forward', '3128=/run/x.sock', '--link', 'a=/b', '--env-header', '--',
                              '/bin/hermes', 'chat', '--forward', 'x'])
        self.assertEqual(args.forward, ['3128=/run/x.sock'])
        self.assertEqual(args.command, ['/bin/hermes', 'chat', '--forward', 'x'])

    def test_proxy_environment(self):
        env = sandbox.proxy_environment({3128: '/e', 3000: '/p'})
        self.assertEqual(env['HTTPS_PROXY'], 'http://127.0.0.1:3128')
        self.assertEqual(env['NODE_USE_ENV_PROXY'], '1')
        self.assertIn('127.0.0.1', env['NO_PROXY'])
        self.assertNotIn('HTTPS_PROXY', sandbox.proxy_environment({3000: '/p'}))

    def test_reads_the_variable_header_to_the_byte(self):
        read_end, write_end = os.pipe()
        header = json.dumps({'ITSAPLAN_API_KEY': 'k'}).encode()
        os.write(write_end, b'%010d\n' % len(header) + header + b'the task')
        os.close(write_end)
        saved = os.dup(0)
        os.dup2(read_end, 0)
        try:
            self.assertEqual(sandbox.read_env_header(), {'ITSAPLAN_API_KEY': 'k'})
            self.assertEqual(os.read(0, 100), b'the task')
        finally:
            os.dup2(saved, 0)
            os.close(saved)
            os.close(read_end)


class LauncherRequestTest(unittest.TestCase):
    """The launcher's checks of a run request, against folders of a temporary tree."""

    def setUp(self):
        import launcher  # noqa: PLC0415

        self.launcher_module = launcher
        self.dir = Path(tempfile.mkdtemp()).resolve()
        for path in ('registry', 'workspaces/alpha/src', 'profiles/alpha', 'profiles/alpha_7', 'vault/Projects/ALPHA',
                     'workspaces/beta', 'profiles/beta'):
            (self.dir / path).mkdir(parents=True, exist_ok=True)
        (self.dir / 'registry/alpha.json').write_text(json.dumps({'slug': 'alpha', 'project': {'id': 1, 'key': 'ALPHA'}}))
        path = config_file(self.dir, registryRoot=str(self.dir / 'registry'), workspaceRoot=str(self.dir / 'workspaces'),
                           profilesRoot=str(self.dir / 'profiles'), vaultRoot=str(self.dir / 'vault'),
                           homeWorkspace=str(self.dir / 'home'))
        config = common.load_config(str(path), require_root=False)
        worker = launcher.Launcher.__new__(launcher.Launcher)
        worker.config = config
        me = types.SimpleNamespace(pw_name='vp-alpha', pw_uid=os.getuid(), pw_gid=os.getgid())
        worker.project_account = lambda slug: me
        self.worker = worker
        self.base = {'v': 1, 'op': 'run', 'slug': 'alpha', 'profile': 'alpha', 'runtime': 'hermes', 'args': ['chat'],
                     'env': {'ITSAPLAN_API_KEY': 'k'}, 'cwd': str(self.dir / 'workspaces/alpha/src')}

    def tearDown(self):
        shutil.rmtree(self.dir)

    def refused(self, **changes) -> str:
        with self.assertRaises(common.IsolationError) as caught:
            self.worker.check_run({**self.base, **changes})
        return caught.exception.message

    def test_accepts_a_run_of_the_project(self):
        checked = self.worker.check_run(self.base)
        self.assertEqual(checked['home'], str(self.dir / 'profiles/alpha'))
        self.assertEqual(checked['cwd'], str(self.dir / 'workspaces/alpha/src'))
        self.assertEqual(checked['vault_rw'], [str(self.dir / 'vault/Projects/ALPHA')])

    def test_refuses_what_is_not_the_project(self):
        self.assertIn('does not belong', self.refused(profile='beta'))
        self.assertIn('outside', self.refused(cwd=str(self.dir / 'workspaces/beta')))
        self.assertIn('plain absolute', self.refused(cwd=str(self.dir / 'workspaces/alpha/../beta')))
        self.assertIn('unknown runtime', self.refused(runtime='bash'))
        self.assertIn('not provisioned', self.refused(slug='beta', profile='beta'))
        self.assertIn('may not set', self.refused(env={'HTTPS_PROXY': 'x'}))
        self.assertIn('may not set', self.refused(env={'VOLITION_X': 'x'}))
        self.assertIn('another agent', self.refused(profile='alpha_7', agentId=8))
        self.assertIn('takes no arguments', self.refused(runtime='profile-helper', args=['x']))

    def test_a_linked_folder_runs_in_the_workspace(self):
        link = self.dir / 'workspaces/alpha/escape'
        link.symlink_to(self.dir / 'workspaces/beta')
        checked = self.worker.check_run({**self.base, 'cwd': str(link)})
        self.assertEqual(checked['cwd'], str(self.dir / 'workspaces/alpha'))

    def test_the_properties_are_the_launchers(self):
        checked = self.worker.check_run(self.base)
        props = self.worker.sandbox_properties(checked['account'], [checked['workspace']], [], checked['limits'])
        for required in ('PrivateNetwork=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes',
                         'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'RestrictSUIDSGID=yes',
                         'TemporaryFileSystem=/run:ro', 'TemporaryFileSystem=/var/lib/volition:ro',
                         'TemporaryFileSystem=/srv/volition:ro', 'InaccessiblePaths=-/etc/volition',
                         'User=vp-alpha', 'KillSignal=SIGINT'):
            self.assertIn(required, props)
        self.assertTrue(all('\n' not in p for p in props))

    def test_request_fields(self):
        keys = self.launcher_module.REQUEST_KEYS['run']
        self.assertNotIn('properties', keys)
        self.assertNotIn('user', keys)


class MigrateTest(unittest.TestCase):
    def test_dry_run_lists_changes_and_skips_links(self):
        import migrate  # noqa: PLC0415

        directory = Path(tempfile.mkdtemp()).resolve()
        try:
            (directory / 'tree/sub').mkdir(parents=True)
            (directory / 'tree/file').write_text('x')
            (directory / 'secret').write_text('s')
            os.link(directory / 'secret', directory / 'tree/hardlink')
            (directory / 'tree/link').symlink_to(directory / 'secret')
            changes = migrate.Changes(True)
            migrate.own_tree(str(directory / 'tree'), os.getuid() + 1, os.getgid(), changes)
            self.assertEqual(changes.count, 3)  # tree, sub, file; not the links
            self.assertTrue(any('hardlink' in entry for entry in changes.skipped))
            self.assertEqual(os.stat(directory / 'tree/file').st_uid, os.getuid())
        finally:
            shutil.rmtree(directory)


@unittest.skipUnless(sys.platform.startswith('linux') and shutil.which('bash'), 'isolation.sh runs on Linux')
class IsolationScriptTest(unittest.TestCase):
    """isolation.sh against a temporary tree, with systemctl and the account tools stubbed."""

    def test_install_and_dry_runs(self):
        directory = Path(tempfile.mkdtemp()).resolve()
        try:
            stubs = directory / 'bin'
            stubs.mkdir()
            log = directory / 'calls.log'
            for tool in ('systemctl', 'groupadd', 'useradd', 'usermod', 'runuser'):
                (stubs / tool).write_text(f'#!/bin/sh\necho "{tool} $*" >> {log}\nexit 0\n')
                (stubs / tool).chmod(0o755)
            (stubs / 'getent').write_text('#!/bin/sh\n[ "$2" = volition-browser ] && echo x && exit 0\nexit 2\n')
            (stubs / 'getent').chmod(0o755)
            (stubs / 'id').write_text('#!/bin/sh\necho volition\n')
            (stubs / 'id').chmod(0o755)
            env = {
                'PATH': f'{stubs}:/usr/bin:/bin', 'ISOLATION_TEST': '1', 'ISOLATION_LIB': str(directory / 'lib'),
                'ISOLATION_UNITS': str(directory / 'units'), 'ISOLATION_TOKEN': str(directory / 'token'),
                'ISOLATION_HERMES_HOME': str(directory / 'hermes'), 'ISOLATION_BROWSER_STATE': str(directory / 'browser'),
            }
            script = ISOLATION.parent / 'native' / 'isolation.sh'
            dry = subprocess.run(['bash', str(script), 'install', '--dry-run'], env=env, capture_output=True, text=True)
            self.assertEqual(dry.returncode, 0, dry.stderr)
            self.assertIn('would create group volition-agents', dry.stdout)
            self.assertFalse((directory / 'lib').exists())
            self.assertFalse((directory / 'token').exists())
            done = subprocess.run(['bash', str(script), 'install'], env=env, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertTrue((directory / 'lib/launcher.py').is_file())
            self.assertTrue((directory / 'units/volition-egress.socket').is_file())
            self.assertEqual(stat.S_IMODE((directory / 'token').stat().st_mode), 0o600)
            self.assertIn('LoadCredential=agent_egress_token',
                          (directory / 'units/volition-plan-api.service.d/agent-egress.conf').read_text())
            again = subprocess.run(['bash', str(script), 'install', '--dry-run'], env=env, capture_output=True, text=True)
            self.assertNotIn('would install', again.stdout)
            calls = log.read_text()
            self.assertIn('groupadd --system volition-agents', calls)
            self.assertIn('usermod -aG volition-launcher volition-hermes', calls)
        finally:
            shutil.rmtree(directory)


if __name__ == '__main__':
    unittest.main()
