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
import launcher as launcher_module  # noqa: E402


class AreaTrashTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.launcher = launcher_module.Launcher.__new__(launcher_module.Launcher)
        self.launcher.config = types.SimpleNamespace(
            home_slug='home', workspace_root=str(self.root / 'workspaces'),
            vault_root=str(self.root / 'vault'))
        self.launcher.project_account = lambda slug: object()
        self.launcher.registry_key = lambda slug: 'DEMO'
        (self.root / 'workspaces/demo/design').mkdir(parents=True)
        (self.root / 'vault/Projects/DEMO/design').mkdir(parents=True)

    def request(self, kind, folder='design'):
        return {'slug': 'demo', 'folder': folder, 'kind': kind, 'date': '2026-09-27',
                'eventId': '123e4567-e89b-42d3-a456-426614174000'}

    def test_moves_both_area_folders_without_changing_contents(self):
        (self.root / 'workspaces/demo/design/work.txt').write_text('work')
        (self.root / 'vault/Projects/DEMO/design/brief.md').write_text('brief')
        self.assertEqual(self.launcher._trash_area(self.request('workspace')), {'present': True})
        self.assertEqual(self.launcher._trash_area(self.request('files')), {'present': True})
        name = '2026-09-27-design-123e4567-e89b-42d3-a456-426614174000'
        self.assertEqual((self.root / 'workspaces/demo/.trash' / name / 'work.txt').read_text(), 'work')
        self.assertEqual((self.root / 'vault/.trash/Projects/DEMO' / name / 'brief.md').read_text(), 'brief')
        self.assertEqual(self.launcher._trash_area(self.request('workspace')), {'present': True})

    def test_rejects_an_area_path_outside_the_project(self):
        for folder in ('../other', '.trash', 'design/nested'):
            with self.subTest(folder=folder), self.assertRaises(common.IsolationError):
                self.launcher._trash_area(self.request('workspace', folder))


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
        self.assertEqual(config.forwards, {'egress': 3128, 'plan': 3000, 'localai': 13305,
                                           'halogen': 8731, 'halogenquiet': 8733})
        self.assertEqual(config.optional_sockets, ('localai', 'halogen', 'halogenquiet'))
        self.assertEqual(set(config.runtimes), {'hermes', 'claude', 'codex', 'command', 'profile-helper'})
        self.assertIn('/srv/volition/source/plan/packages/runner/dist', config.runtimes['claude'].read_only)
        self.assertIn('/var/lib/volition', config.hide)
        self.assertIn('/etc/volition', config.inaccessible)
        self.assertFalse(config.runtimes['profile-helper'].caller_args)
        self.assertEqual(config.browser_gateway,
                         ('/run/volition-browser/gateway', '/run/volition-agents/browser'))

    def test_agents_get_the_keepers_login_views_not_the_stores(self):
        # docs/helena-decisions/token-keeper.md: an agent must never hold a refresh token.
        config = common.load_config(str(config_file(self.dir)), require_root=False)
        hermes = config.runtimes['hermes']
        self.assertNotIn('/var/lib/volition/hermes/auth.json', hermes.read_only + hermes.optional_read_only)
        self.assertEqual(dict(hermes.credential_binds), {
            '/var/lib/helena-token-keeper/view/hermes/auth.json': '/var/lib/volition/hermes/auth.json',
            '/var/lib/helena-token-keeper/view/codex': '{home}/.codex',
        })
        self.assertEqual(set(hermes.required_credentials), set(dict(hermes.credential_binds)))
        self.assertIn('/var/lib/helena-token-keeper', config.hide)
        # The profile helper (hermes doctor, limits) sees the same logins; a helper still runs
        # without them.
        helper = config.runtimes['profile-helper']
        self.assertEqual(dict(helper.credential_binds), dict(hermes.credential_binds))
        self.assertEqual(helper.required_credentials, ())
        for runtime in config.runtimes.values():
            for source, _target in runtime.credential_binds:
                self.assertTrue(source.startswith('/var/lib/helena-token-keeper/view/'), source)

    def test_profile_links_up_to_three_levels(self):
        config = common.load_config(str(config_file(self.dir)), require_root=False)
        self.assertEqual(config.runtimes['hermes'].profile_links['.local/bin/hermes'],
                         '/var/lib/volition/hermes/venv/bin/hermes')
        with open(ISOLATION / 'launcher.json', encoding='utf-8') as handle:
            shipped = json.load(handle)['runtimes']
        for name in ('a/b/c/d', '../x', 'a/../b', '/abs', 'a//b'):
            runtimes = json.loads(json.dumps(shipped))
            runtimes['hermes']['profileLinks'] = {name: '/bin/true'}
            with self.subTest(name=name), self.assertRaises(common.IsolationError):
                common.load_config(str(config_file(self.dir, runtimes=runtimes)), require_root=False)

    def test_refuses_a_required_flag_that_is_not_a_boolean(self):
        with open(ISOLATION / 'launcher.json', encoding='utf-8') as handle:
            runtimes = json.load(handle)['runtimes']
        runtimes['hermes']['credentialBinds'][0]['required'] = 'yes'
        with self.assertRaises(common.IsolationError):
            common.load_config(str(config_file(self.dir, runtimes=runtimes)), require_root=False)

    def test_refuses_a_file_others_can_write_when_root_reads_it(self):
        path = config_file(self.dir)
        os.chmod(path, 0o666)
        with self.assertRaises(common.IsolationError):
            common.load_config(str(path), require_root=True)

    def test_refuses_invalid_values(self):
        for overrides in ({'userPrefix': 'root'}, {'uidRange': [0, 10]}, {'forwards': {'egress': 80}},
                          {'forwards': {'nope': 4000}}, {'workspaceRoot': 'relative'}, {'callers': []},
                          {'browserGateway': {'root': 'relative', 'target': '/run/volition-agents/browser'}},
                          {'browserGateway': {'root': '/run/volition-browser/gateway'}},
                          {'optionalSockets': ['egress']}, {'optionalSockets': ['nope']},
                          {'optionalSockets': 'localai'}):
            with self.subTest(overrides=overrides), self.assertRaises(common.IsolationError):
                common.load_config(str(config_file(self.dir, **overrides)), require_root=False)


class ProofConfigTest(unittest.TestCase):
    """The launcher.json the proof harness writes (proof/harness.py test_config) is read by the
    launcher's own validation. It is built from the shipped file, so a field added there must
    stay valid after the harness puts its test paths in, or the test launcher exits at start."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_the_harness_config_passes_the_launchers_validation(self):
        sys.path.insert(0, str(ISOLATION / 'proof'))
        try:
            import harness  # noqa: PLC0415
        finally:
            sys.path.remove(str(ISOLATION / 'proof'))
        path = self.dir / 'launcher.json'
        path.write_text(json.dumps(harness.test_config(str(ISOLATION))))
        config = common.load_config(str(path), require_root=False)
        self.assertEqual(config.user_prefix, 'vpt-')
        self.assertEqual(config.callers, ('vpt-hermes',))
        self.assertTrue(set(config.optional_sockets) <= set(config.sockets))
        self.assertEqual(set(config.forwards), set(config.sockets))
        for runtime in ('probe', 'hermes', 'claude', 'codex', 'profile-helper'):
            self.assertIn(runtime, config.runtimes)
        for path_ in (config.workspace_root, config.profiles_root, config.registry_root):
            self.assertTrue(path_.startswith(harness.ROOT), path_)


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


class AdoptTreeTest(unittest.TestCase):
    def test_takes_over_the_tree_but_no_link_and_no_hard_link(self):
        # Without root the owner stays; a group of the caller's shows what changed hands.
        group = next((g for g in os.getgroups() if g != os.getgid()), None)
        if group is None:
            self.skipTest('the caller has no second group')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            outside = root / 'outside'
            outside.write_text('x')
            git = root / '.git'
            (git / 'objects' / 'aa').mkdir(parents=True)
            (git / 'HEAD').write_text('ref: refs/heads/main\n')
            (git / 'objects' / 'aa' / 'object').write_text('o')
            (git / 'link').symlink_to(outside)
            os.link(outside, git / 'hard')
            fd = os.open(git, common.O_DIR)
            try:
                self.assertEqual(common.adopt_tree(fd, os.getuid(), group, only_uid=os.getuid() + 1), 0)
                changed = common.adopt_tree(fd, os.getuid(), group, only_uid=os.getuid())
            finally:
                os.close(fd)
            self.assertEqual(changed, 5)  # .git, HEAD, objects, objects/aa, objects/aa/object
            for path in (git, git / 'HEAD', git / 'objects' / 'aa' / 'object'):
                self.assertEqual(path.stat().st_gid, group)
            self.assertEqual(outside.stat().st_gid, os.getgid())
            # Without a group each entry keeps its own.
            (git / 'HEAD').chmod(0o640)
            os.chown(git / 'HEAD', -1, os.getgid())
            fd = os.open(git, common.O_DIR)
            try:
                common.adopt_tree(fd, os.getuid(), None, only_uid=os.getuid())
            finally:
                os.close(fd)
            self.assertEqual((git / 'HEAD').stat().st_gid, os.getgid())
            self.assertEqual(git.stat().st_gid, group)


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
        self.assertEqual(egress.decide(policy, 'example.com', 443, None), 'blocked')
        self.assertEqual(egress.effective_mode({'mode': 'weird'}, None), 'blocked')

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

    def test_plan_environment(self):
        # The API inside the unit is the forwarder to plan.sock, not the runner's address.
        env = sandbox.plan_environment({3128: '/run/x/egress.sock', 3000: '/run/x/plan.sock'})
        self.assertEqual(env, {'ITSAPLAN_URL': 'http://127.0.0.1:3000'})
        self.assertEqual(sandbox.plan_environment({3128: '/run/x/egress.sock'}), {})

    def test_proxy_environment(self):
        env = sandbox.proxy_environment({3128: '/e', 3000: '/p'})
        self.assertEqual(env['HTTPS_PROXY'], 'http://127.0.0.1:3128')
        self.assertEqual(env['NODE_USE_ENV_PROXY'], '1')
        self.assertIn('127.0.0.1', env['NO_PROXY'])
        self.assertNotIn('HTTPS_PROXY', sandbox.proxy_environment({3000: '/p'}))

    def test_puts_the_links_back_and_keeps_what_replaced_them(self):
        home = Path(tempfile.mkdtemp())
        try:
            (home / 'plugins' / 'plan-approval-guard').mkdir(parents=True)
            (home / 'plugins' / 'plan-approval-guard' / '__init__.py').write_text('# not the guard')
            (home / 'config.yaml').symlink_to('/elsewhere')
            sandbox.ensure_links(str(home), [('plugins/plan-approval-guard', '/opt/guard'), ('config.yaml', '/etc/c.yaml'),
                                             ('.env', '/etc/e')])
            self.assertEqual(os.readlink(home / 'plugins' / 'plan-approval-guard'), '/opt/guard')
            self.assertEqual(os.readlink(home / 'config.yaml'), '/etc/c.yaml')
            self.assertEqual(os.readlink(home / '.env'), '/etc/e')
            aside = list((home / 'run').iterdir())
            self.assertEqual(len(aside), 1)
            self.assertTrue((aside[0] / '__init__.py').is_file())
        finally:
            shutil.rmtree(home)

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

    def test_command_script_stays_a_regular_file_in_the_project_workspace(self):
        script = self.dir / 'workspaces/alpha/src/review.sh'
        script.write_text('echo reviewed\n')
        checked = self.worker.check_run({**self.base, 'runtime': 'command', 'args': ['-eu', str(script)]})
        self.assertEqual(checked['args'], ['-eu', str(script)])
        self.assertIn('exactly one script', self.refused(runtime='command', args=['-eu']))
        outside = self.dir / 'workspaces/beta/foreign.sh'
        outside.write_text('echo foreign\n')
        self.assertIn('outside the workspace', self.refused(runtime='command', args=['-eu', str(outside)]))
        script.unlink()
        script.symlink_to(outside)
        self.assertIn('unavailable or linked', self.refused(runtime='command', args=['-eu', str(script)]))

    def test_refuses_what_is_not_the_project(self):
        self.assertIn('does not belong', self.refused(profile='beta'))
        self.assertIn('outside', self.refused(cwd=str(self.dir / 'workspaces/beta')))
        self.assertIn('plain absolute', self.refused(cwd=str(self.dir / 'workspaces/alpha/../beta')))
        self.assertIn('unknown runtime', self.refused(runtime='bash'))
        self.assertIn('not provisioned', self.refused(slug='beta', profile='beta'))
        self.assertIn('may not set', self.refused(env={'HTTPS_PROXY': 'x'}))
        self.assertIn('may not set', self.refused(env={'VOLITION_AGENT_SANDBOX': 'x'}))
        self.worker.check_run({**self.base, 'env': {'VOLITION_VAULT_ACCESS': '{}'}})
        self.assertIn('another agent', self.refused(profile='alpha_7', agentId=8))
        self.assertIn('takes no arguments', self.refused(runtime='profile-helper', args=['x']))

    def test_a_linked_folder_runs_in_the_workspace(self):
        link = self.dir / 'workspaces/alpha/escape'
        link.symlink_to(self.dir / 'workspaces/beta')
        checked = self.worker.check_run({**self.base, 'cwd': str(link)})
        self.assertEqual(checked['cwd'], str(self.dir / 'workspaces/alpha'))

    def test_the_properties_are_the_launchers(self):
        checked = self.worker.check_run(self.base)
        props = self.worker.sandbox_properties(
            'alpha', checked['account'], [checked['workspace']], [], checked['limits'])
        for required in ('PrivateNetwork=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes',
                         'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'RestrictSUIDSGID=yes',
                         'TemporaryFileSystem=/run:ro', 'TemporaryFileSystem=/var/lib/volition:ro',
                         'TemporaryFileSystem=/srv/volition:ro', 'InaccessiblePaths=-/etc/volition',
                         'User=vp-alpha', 'KillSignal=SIGINT'):
            self.assertIn(required, props)
        self.assertTrue(all('\n' not in p for p in props))

    def test_runtime_limit_can_only_be_shortened(self):
        self.assertEqual(self.worker.limits(None)['RuntimeMaxSec'], '7200')
        self.assertEqual(self.worker.limits({'runtimeMaxSec': 86400})['RuntimeMaxSec'], '7200')
        self.assertEqual(self.worker.limits({'runtimeMaxSec': 60})['RuntimeMaxSec'], '60')

    def test_binds_this_projects_own_browser_gateway_directory(self):
        # Per project, not shared (see isolation_common.Config.browser_gateway): the router
        # knows the caller's project from the socket that accepted the connection, so each
        # project's unit gets only its own directory, at the path the MCP shim looks in, and
        # optional, so a project without a browser still starts its agents.
        checked = self.worker.check_run(self.base)
        props = self.worker.sandbox_properties(
            'alpha', checked['account'], [checked['workspace']], [], checked['limits'])
        self.assertIn(
            'BindReadOnlyPaths=-/run/volition-browser/gateway/alpha:/run/volition-agents/browser',
            props)
        self.assertFalse(any('gateway/beta' in p for p in props))
        other = self.worker.sandbox_properties(
            'beta', checked['account'], [checked['workspace']], [], checked['limits'])
        self.assertIn(
            'BindReadOnlyPaths=-/run/volition-browser/gateway/beta:/run/volition-agents/browser',
            other)
        home = self.worker.sandbox_properties(
            'home', checked['account'], [checked['workspace']], [], checked['limits'])
        self.assertIn(
            'BindReadOnlyPaths=-/run/volition-browser/gateway/home:/run/volition-agents/browser',
            home)

    def test_local_ai_socket_is_optional_and_the_core_ones_are_not(self):
        # docs/helena-decisions/local-ai-platform.md: a machine without local AI has no
        # helena-ai.sock; its agents still start, and only egress and plan stay required.
        checked = self.worker.check_run(self.base)
        props = self.worker.sandbox_properties(
            'alpha', checked['account'], [checked['workspace']], [], checked['limits'])
        self.assertIn('BindReadOnlyPaths=-/run/volition-agents/helena-ai.sock', props)
        # Halogen (native/halogen/install.sh) the same way: its API and its address for turns
        # without thinking, both optional.
        self.assertIn('BindReadOnlyPaths=-/run/volition-agents/helena-halogen-8731.sock', props)
        self.assertIn('BindReadOnlyPaths=-/run/volition-agents/helena-halogen-8733.sock', props)
        self.assertIn('BindReadOnlyPaths=/run/volition-agents/egress.sock', props)
        self.assertIn('BindReadOnlyPaths=/run/volition-agents/plan.sock', props)

    def test_no_browser_gateway_bind_without_the_config(self):
        path = config_file(self.dir, registryRoot=str(self.dir / 'registry'),
                           workspaceRoot=str(self.dir / 'workspaces'), profilesRoot=str(self.dir / 'profiles'),
                           vaultRoot=str(self.dir / 'vault'), homeWorkspace=str(self.dir / 'home'),
                           browserGateway=None)
        config = common.load_config(str(path), require_root=False)
        self.assertIsNone(config.browser_gateway)
        worker = self.launcher_module.Launcher.__new__(self.launcher_module.Launcher)
        worker.config = config
        checked = self.worker.check_run(self.base)
        props = worker.sandbox_properties('alpha', checked['account'], [checked['workspace']], [],
                                          checked['limits'])
        self.assertFalse(any('gateway' in p for p in props))

    def test_a_run_without_the_login_view_is_refused(self):
        view = self.dir / 'keeper/view'
        (view / 'codex').mkdir(parents=True)
        runtime = common.Runtime(
            name='hermes', exec='/bin/true', fixed_args=(), caller_args=True, read_only=(), optional_read_only=(),
            env={}, credential_binds=((str(view / 'hermes/auth.json'), '/var/lib/volition/hermes/auth.json'),
                                      (str(view / 'codex'), '{home}/.codex')),
            needs_profile=True, profile_links={},
            required_credentials=(str(view / 'hermes/auth.json'), str(view / 'codex')))
        with self.assertRaises(common.IsolationError) as caught:
            self.worker.runtime_binds(runtime, str(self.dir / 'profiles/alpha'))
        self.assertEqual(caught.exception.code, 'credentials')
        (view / 'hermes').mkdir()
        (view / 'hermes/auth.json').write_text('{}')
        _ro, props = self.worker.runtime_binds(runtime, str(self.dir / 'profiles/alpha'))
        self.assertEqual(props, [
            f'BindReadOnlyPaths={view}/hermes/auth.json:/var/lib/volition/hermes/auth.json',
            f'BindReadOnlyPaths={view}/codex:{self.dir}/profiles/alpha/.codex',
        ])

    def test_request_fields(self):
        keys = self.launcher_module.REQUEST_KEYS['run']
        self.assertNotIn('properties', keys)
        self.assertNotIn('user', keys)
        self.assertIn('agentRuntime', keys)


class CredentialTargetTest(LauncherRequestTest):
    """The credential-bind targets in a profile ({home}/.codex): made or given back to the
    agent before a unit starts, so systemd never creates them as root (2026-09-25: a Codex
    agent could not store its own login in its CODEX_HOME)."""

    def setUp(self):
        super().setUp()
        self.home = self.dir / 'profiles/alpha'
        self.me = self.worker.project_account('alpha')
        self.logs: list[str] = []
        self.chowns: list[tuple] = []
        self._log = self.launcher_module.log
        self.launcher_module.log = self.logs.append
        self.addCleanup(setattr, self.launcher_module, 'log', self._log)

    def pretend_root_owns(self, path: Path) -> None:
        """What systemd left: the target owned by root. (The test runs unprivileged, so the
        owner is reported, and the launcher's chown recorded instead of done.)"""
        inode = path.stat().st_ino
        real_fstat = os.fstat

        def fstat(fd):
            info = real_fstat(fd)
            if info.st_ino != inode:
                return info
            values = list(info)
            values[stat.ST_UID] = 0
            return os.stat_result(values)
        self.worker._stat_fd = fstat
        real_fchown = self.launcher_module.os.fchown
        self.chowns = []

        def fchown(fd, uid, gid):
            if real_fstat(fd).st_ino == inode:
                self.chowns.append((uid, gid))
            else:
                real_fchown(fd, uid, gid)
        patcher = __import__('unittest.mock', fromlist=['patch']).patch.object(self.launcher_module.os, 'fchown', fchown)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_targets_are_the_profiles_codex_folder(self):
        self.assertEqual(self.worker.home_targets(), [('.codex', True)])

    def test_a_missing_target_is_made_for_the_agent(self):
        self.worker.prepare_home_targets(str(self.home), self.me)
        info = (self.home / '.codex').stat()
        self.assertTrue(stat.S_ISDIR(info.st_mode))
        self.assertEqual((info.st_uid, stat.S_IMODE(info.st_mode)), (self.me.pw_uid, 0o700))
        self.assertTrue(any('created for vp-alpha' in line for line in self.logs))
        # Once there and the agent's, nothing more happens.
        self.logs.clear()
        self.worker.prepare_home_targets(str(self.home), self.me)
        self.assertEqual(self.logs, [])

    def test_an_empty_root_owned_target_is_given_back(self):
        target = self.home / '.codex'
        target.mkdir(mode=0o755)
        self.pretend_root_owns(target)
        self.worker.prepare_home_targets(str(self.home), self.me)
        self.assertEqual(self.chowns, [(self.me.pw_uid, self.me.pw_gid)])
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
        self.assertTrue(any('empty and root-owned, given to vp-alpha' in line for line in self.logs))

    def test_a_root_owned_target_with_files_is_left_alone(self):
        target = self.home / '.codex'
        target.mkdir(mode=0o755)
        (target / 'auth.json').write_text('{}')
        self.pretend_root_owns(target)
        self.worker.prepare_home_targets(str(self.home), self.me)
        self.assertEqual(self.chowns, [])
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o755)
        self.assertTrue(any('owned by uid 0 and not empty; left as it is' in line for line in self.logs))

    def test_a_target_of_someone_else_is_left_alone(self):
        target = self.home / '.codex'
        target.mkdir(mode=0o750)
        other = types.SimpleNamespace(pw_name='vp-beta', pw_uid=os.getuid() + 1, pw_gid=os.getgid())
        self.worker.prepare_home_targets(str(self.home), other)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o750)
        self.assertTrue(any(f'owned by uid {os.getuid()}; left as it is' in line for line in self.logs))

    def test_a_link_or_a_file_stops_the_unit(self):
        (self.home / '.codex').symlink_to(self.dir / 'workspaces/beta')
        with self.assertRaises(common.IsolationError) as caught:
            self.worker.prepare_home_targets(str(self.home), self.me)
        self.assertEqual(caught.exception.code, 'credentials')
        (self.home / '.codex').unlink()
        (self.home / '.codex').write_text('x')
        with self.assertRaises(common.IsolationError):
            self.worker.prepare_home_targets(str(self.home), self.me)

    def helper_runtime(self):
        view = self.dir / 'keeper/view'
        (view / 'codex').mkdir(parents=True, exist_ok=True)
        (view / 'hermes').mkdir(exist_ok=True)
        (view / 'hermes/auth.json').write_text('{}')
        helper = self.worker.config.runtimes['profile-helper']
        return common.Runtime(**{**helper.__dict__, 'credential_binds': (
            (str(view / 'hermes/auth.json'), '/var/lib/volition/hermes/auth.json'),
            (str(view / 'codex'), '{home}/.codex'))})

    def test_the_helper_of_a_codex_or_claude_agent_gets_no_login_view(self):
        helper = self.helper_runtime()
        for agent_runtime in (None, 'hermes'):
            _ro, props = self.worker.runtime_binds(helper, str(self.home), agent_runtime)
            self.assertEqual(len(props), 2, agent_runtime)
            self.assertTrue(any(p.endswith(f'{self.home}/.codex') for p in props))
        for agent_runtime in ('codex', 'claude'):
            _ro, props = self.worker.runtime_binds(helper, str(self.home), agent_runtime)
            self.assertEqual(props, [], agent_runtime)
        # The agent's own runtime units keep theirs (Codex has none; Hermes both).
        hermes = self.worker.config.runtimes['hermes']
        self.assertEqual(hermes.credential_binds, self.worker.config.runtimes['hermes'].credential_binds)
        self.assertEqual(self.worker.config.runtimes['codex'].credential_binds, ())

    def test_agent_runtime_is_checked(self):
        checked = self.worker.check_run({**self.base, 'runtime': 'profile-helper', 'args': [], 'agentRuntime': 'codex'})
        self.assertEqual(checked['agent_runtime'], 'codex')
        self.assertIsNone(self.worker.check_run(self.base)['agent_runtime'])
        for bad in ('Codex', '../x', 7, ''):
            self.assertIn('agentRuntime is invalid', self.refused(agentRuntime=bad))

    def test_a_run_prepares_the_target_before_the_unit_starts(self):
        started: list[list[str]] = []
        helper = self.helper_runtime()
        self.worker.config.runtimes['profile-helper'] = helper

        async def stream(command, unit, env, reader, writer):
            self.assertTrue((self.home / '.codex').is_dir())  # there before systemd-run
            started.append(command)
        self.worker.stream = stream
        self.worker.preview_directory = lambda slug: None
        self.worker.lock = asyncio.Lock()
        self.worker.active, self.worker.total = {}, 0
        request = {**self.base, 'runtime': 'profile-helper', 'args': [], 'agentRuntime': 'codex',
                   'work': {'kind': 'helper', 'id': None}}
        asyncio.run(self.worker.run(request, None, None, 'test'))
        [command] = started
        self.assertFalse(any('keeper/view' in part for part in command))
        self.assertEqual(stat.S_IMODE((self.home / '.codex').stat().st_mode), 0o700)
        asyncio.run(self.worker.run({**request, 'agentRuntime': 'hermes'}, None, None, 'test'))
        self.assertTrue(any(f'keeper/view/codex:{self.home}/.codex' in part for part in started[1]))


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


    def test_dry_run_names_model_auth_before_the_group_exists(self):
        import migrate  # noqa: PLC0415

        changes = migrate.Changes(True)
        migrate.grant_model_auth(['/nonexistent/auth.json'], 'no-such-group-vpt', changes)
        self.assertEqual(changes.count, 1)
        with self.assertRaises(KeyError):
            migrate.grant_model_auth(['/nonexistent/auth.json'], 'no-such-group-vpt', migrate.Changes(False))


class SharedCodeTest(unittest.TestCase):
    """The runtimes' code every agent runs is readable by every agent (runtime_modes.py). On
    2026-09-25 docstring_parser in Hermes' venv was root 0600: the anthropic SDK imports it, so
    every agent on a Claude model failed at "credentials or agent init failed"."""

    def setUp(self):
        import runtime_modes  # noqa: PLC0415

        self.modes = runtime_modes
        self.dir = Path(tempfile.mkdtemp()).resolve()
        self.tree = self.dir / 'venv'
        site = self.tree / 'lib' / 'site-packages'
        (site / 'docstring_parser').mkdir(parents=True)
        (site / 'anthropic' / '__pycache__').mkdir(parents=True)
        self.files = {
            'ok': site / 'anthropic' / '__init__.py',
            'closed': site / 'docstring_parser' / '__init__.py',
            'pyc': site / 'anthropic' / '__pycache__' / '_client.cpython-313.pyc',
            'program': self.tree / 'hermes',
            'group_writable': site / 'anthropic' / '_client.py',
        }
        for path in self.files.values():
            path.write_text('x')
        os.chmod(self.files['ok'], 0o644)
        os.chmod(self.files['closed'], 0o600)
        os.chmod(self.files['pyc'], 0o600)
        os.chmod(self.files['program'], 0o744)
        os.chmod(self.files['group_writable'], 0o664)
        os.chmod(site / 'anthropic' / '__pycache__', 0o700)
        # Outside the tree, reached only through a link, which is never followed.
        self.secret = self.dir / 'secret.json'
        self.secret.write_text('{}')
        os.chmod(self.secret, 0o600)
        os.symlink(self.secret, site / 'linked.json')

    def tearDown(self):
        for path in self.dir.rglob('*'):
            if not path.is_symlink():
                os.chmod(path, 0o700 if path.is_dir() else 0o600)
        shutil.rmtree(self.dir)

    def mode(self, path: Path) -> int:
        return stat.S_IMODE(os.lstat(path).st_mode)

    def test_the_shipped_config_lists_the_code_the_hermes_units_bind(self):
        config = common.load_config(str(config_file(self.dir)), require_root=False)
        self.assertIn('/var/lib/volition/hermes/venv', config.shared_code)
        self.assertIn('/var/lib/volition/hermes/python', config.shared_code)
        hermes = config.runtimes['hermes']
        bound = hermes.read_only + hermes.optional_read_only
        for tree in config.shared_code:
            self.assertTrue(any(common.within(root, tree) for root in bound), tree)
        # Never a login or a secret: the views and the stores are not code.
        for tree in config.shared_code:
            self.assertNotIn('auth', tree)
            self.assertFalse(tree.endswith(('.env', 'config.yaml')), tree)

    def test_refuses_system_directories(self):
        for tree in ('/', '/etc', '/etc/volition', '/home', '/var/lib', '/usr', '/proc/self', 'relative'):
            with self.subTest(tree=tree), self.assertRaises(common.IsolationError):
                common.load_config(str(config_file(self.dir, sharedCode=[tree])), require_root=False)

    def test_check_counts_what_breaks_an_import_apart_from_the_bytecode_cache(self):
        report = self.modes.walk(str(self.tree))
        # docstring_parser/__init__.py and the program others may read but not run; the cache
        # folder and its file only cost time.
        self.assertEqual(report.sources, 2)
        self.assertEqual(report.unreadable, 4)
        self.assertEqual(report.examples, ['hermes', 'lib/site-packages/docstring_parser/__init__.py'])
        self.assertEqual(self.mode(self.files['closed']), 0o600)  # a check changes nothing

    def test_repair_opens_the_tree_to_every_reader_and_follows_no_link(self):
        os.environ['RUNTIME_MODES_TEST'] = '1'
        try:
            dry = self.modes.walk(str(self.tree), repair=True, dry_run=True)
            self.assertEqual(dry.opened, 4)
            self.assertEqual(self.mode(self.files['closed']), 0o600)
            done = self.modes.walk(str(self.tree), repair=True)
        finally:
            del os.environ['RUNTIME_MODES_TEST']
        self.assertEqual((done.opened, done.skipped), (4, 0))
        self.assertEqual(self.mode(self.files['closed']), 0o644)
        self.assertEqual(self.mode(self.files['pyc']), 0o644)
        self.assertEqual(self.mode(self.files['pyc'].parent), 0o755)
        self.assertEqual(self.mode(self.files['program']), 0o755)
        self.assertEqual(self.mode(self.files['ok']), 0o644)
        self.assertEqual(self.mode(self.files['group_writable']), 0o664)  # readable already: left as is
        self.assertEqual(self.mode(self.secret), 0o600)
        self.assertEqual(self.modes.walk(str(self.tree)).unreadable, 0)

    def test_repair_takes_write_away_from_group_and_others(self):
        self.assertEqual(self.modes.opened_mode(stat.S_IFREG | 0o620), 0o644)
        self.assertEqual(self.modes.opened_mode(stat.S_IFREG | 0o700), 0o755)
        self.assertEqual(self.modes.opened_mode(stat.S_IFDIR | 0o2770), 0o2755)

    def test_a_file_with_a_second_name_of_another_owner_is_left_alone(self):
        # The owner of a tree could link its own secret into it; only root's links are opened.
        other = self.dir / 'elsewhere'
        os.link(self.files['closed'], other)
        done = self.modes.walk(str(self.tree), repair=True)
        if os.geteuid() == 0:
            self.skipTest('as root every multi-linked file is root\'s')
        self.assertEqual(done.skipped, 1)
        self.assertEqual(self.mode(other), 0o600)

    def test_a_missing_tree_is_reported_not_an_error(self):
        report = self.modes.walk(str(self.dir / 'nothing'))
        self.assertFalse(report.exists)
        self.assertEqual(report.unreadable, 0)

    def test_command_line(self):
        import contextlib  # noqa: PLC0415
        import io  # noqa: PLC0415

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.modes.main(['check', '--config', '/nonexistent', '--tree', str(self.tree), '--json'])
        self.assertEqual(code, 1)
        tree = json.loads(out.getvalue())['trees'][0]
        self.assertEqual((tree['sources'], tree['unreadable']), (2, 4))
        os.chmod(self.files['closed'], 0o644)
        os.chmod(self.files['program'], 0o755)
        with contextlib.redirect_stdout(io.StringIO()):
            # Only the bytecode cache left: slower, not broken.
            self.assertEqual(self.modes.main(['check', '--config', '/nonexistent', '--tree', str(self.tree)]), 0)
        if os.geteuid() != 0:
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(self.modes.main(['repair', '--config', '/nonexistent', '--tree', str(self.tree)]), 2)

    def test_reads_the_trees_from_the_launcher_config(self):
        path = config_file(self.dir, sharedCode=[str(self.tree)])
        self.assertEqual(self.modes.shared_code(str(path)), (str(self.tree),))


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
                # The agents' runtime code (launcher.json sharedCode), here a tree of the test's.
                'ISOLATION_SHARED_CODE': str(directory / 'venv'), 'RUNTIME_MODES_TEST': '1',
            }
            closed = directory / 'venv' / 'docstring_parser' / '__init__.py'
            closed.parent.mkdir(parents=True)
            closed.write_text('x')
            closed.chmod(0o600)
            script = ISOLATION.parent / 'native' / 'isolation.sh'
            dry = subprocess.run(['bash', str(script), 'install', '--dry-run'], env=env, capture_output=True, text=True)
            self.assertEqual(dry.returncode, 0, dry.stderr)
            self.assertIn('would create group volition-agents', dry.stdout)
            self.assertFalse((directory / 'lib').exists())
            self.assertFalse((directory / 'token').exists())
            self.assertIn("would open the agents' shared runtime code", dry.stdout)
            self.assertEqual(stat.S_IMODE(closed.stat().st_mode), 0o600)
            done = subprocess.run(['bash', str(script), 'install'], env=env, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertTrue((directory / 'lib/runtime_modes.py').is_file())
            self.assertIn('opened 1 of 1 unreadable entries', done.stdout)
            self.assertEqual(stat.S_IMODE(closed.stat().st_mode), 0o644)
            # Every deploy opens it again, whatever installed into it since; nothing restarts.
            closed.chmod(0o600)
            before = log.read_text() if log.exists() else ''
            opened = subprocess.run(['bash', str(script), 'open-code'], env=env, capture_output=True, text=True)
            self.assertEqual(opened.returncode, 0, opened.stderr)
            self.assertEqual(stat.S_IMODE(closed.stat().st_mode), 0o644)
            self.assertEqual(log.read_text() if log.exists() else '', before)
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
