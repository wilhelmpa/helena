"""Unit tests of helena-lan6-sync (the home networks for the firewall and the owner sign-in)
and of the owner map local-owner/configure.py writes. Run:

    python3 -m unittest discover -s deployment/volition-stack/native/hardening/tests -v

The end-to-end proof with a real nginx is tests/owner-lan6-selftest.sh.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SYNC = os.path.join(HERE, '..', 'files', 'helena-lan6-sync')
_loader = importlib.machinery.SourceFileLoader('helena_lan6_sync', SYNC)
_spec = importlib.util.spec_from_loader('helena_lan6_sync', _loader)
sync = importlib.util.module_from_spec(_spec)
_loader.exec_module(sync)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'local-owner'))
import configure  # noqa: E402

GUA = '2003:c3:172e:f989:1c2d:3e4f:5a6b:7c8d'
TEMP = '2003:c3:172e:f989:9999:8888:7777:6666'


def addr(family, local, prefixlen, scope='global', **flags):
    return {'family': family, 'local': local, 'prefixlen': prefixlen, 'scope': scope, **flags}


# `ip -j addr show` of a machine like Kingston, with a privacy address, a tentative one, a
# libvirt bridge with its own IPv4 and a ULA, and loopback.
LINKS = [
    {'ifname': 'lo', 'addr_info': [addr('inet', '127.0.0.1', 8, 'host'), addr('inet6', '::1', 128, 'host')]},
    {'ifname': 'eno1', 'addr_info': [
        addr('inet', '192.168.2.58', 24, dynamic=True),
        addr('inet6', GUA, 64, dynamic=True),
        addr('inet6', TEMP, 64, temporary=True, dynamic=True),
        addr('inet6', '2003:c3:172e:f989::abcd', 64, tentative=True),
        addr('inet6', 'fe80::2d71:51ad:1055:b798', 64, 'link'),
    ]},
    {'ifname': 'virbr0', 'addr_info': [addr('inet', '192.168.122.1', 24), addr('inet6', 'fd11:22::1', 64)]},
]
ROUTES6 = [{'dst': 'default', 'gateway': 'fe80::1', 'dev': 'eno1'}]
ROUTES4 = [{'dst': 'default', 'gateway': '192.168.2.1', 'dev': 'eno1'}]


class NetworksTests(unittest.TestCase):
    def test_the_home_prefixes_come_from_the_lan_interface_only(self):
        prefixes, own = sync.owner_networks(LINKS, sync.lan_interface(ROUTES6, ROUTES4))
        # virbr0's ULA is not the home network; the tentative address changes nothing.
        self.assertEqual(prefixes, ['2003:c3:172e:f989::/64'])
        # Every address of the machine, on every interface, a privacy address included; never
        # loopback, link-local or a tentative one. IPv4 first, sorted.
        self.assertEqual(own, ['192.168.2.58/32', '192.168.122.1/32', f'{GUA}/128', f'{TEMP}/128',
                               'fd11:22::1/128'])

    def test_a_ula_on_the_lan_interface_counts(self):
        links = [dict(LINKS[1], addr_info=LINKS[1]['addr_info'] + [addr('inet6', 'fd00:1::58', 64)])]
        prefixes, _ = sync.owner_networks(links, 'eno1')
        self.assertEqual(prefixes, ['2003:c3:172e:f989::/64', 'fd00:1::/64'])

    def test_the_lan_interface_falls_back_to_ipv4(self):
        self.assertEqual(sync.lan_interface([], ROUTES4), 'eno1')
        self.assertIsNone(sync.lan_interface([], []))
        prefixes, own = sync.owner_networks(LINKS, None)
        self.assertEqual(prefixes, [])
        self.assertIn(f'{GUA}/128', own)

    def test_the_firewall_sets_stay_as_before(self):
        v6, v4 = sync.firewall_networks(LINKS, ROUTES4)
        self.assertEqual(v6, ['2003:c3:172e:f989::/64'])
        self.assertEqual(v4, ['192.168.2.0/24'])
        script = sync.nft_script(v6, v4)
        self.assertIn('add element inet helena_hardening lan6 { fe80::/10, fc00::/7, 2003:c3:172e:f989::/64 }', script)
        self.assertIn('add element inet helena_hardening lan4 { 192.168.2.0/24 }', script)
        self.assertNotIn('lan4', sync.nft_script(v6, []))  # never emptied on a link flap

    def test_prefix_change_with_noprefixroute_addresses(self):
        fixture = json.loads('''[{"ifname":"eno1","addr_info":[
          {"family":"inet6","local":"2003:c3:1111:2222::58","prefixlen":64,"scope":"global",
           "flags":["dynamic","deprecated","noprefixroute"],"preferred_life_time":0},
          {"family":"inet6","local":"2003:c3:3333:4444::58","prefixlen":64,"scope":"global",
           "flags":["dynamic","noprefixroute"],"preferred_life_time":3600},
          {"family":"inet6","local":"fd00:1::58","prefixlen":64,"scope":"global"},
          {"family":"inet6","local":"fe80::58","prefixlen":64,"scope":"link"}]},
          {"ifname":"virbr0","addr_info":[{"family":"inet6","local":"2003:c3:aaaa:bbbb::1",
           "prefixlen":64,"scope":"global"}]}]''')
        v6, _ = sync.firewall_networks(fixture, [])
        self.assertEqual(v6, ['2003:c3:3333:4444::/64'])
        self.assertIn('fe80::/10, fc00::/7', sync.nft_script(v6, []))
        prefixes, own = sync.owner_networks(fixture, 'eno1')
        self.assertNotIn('2003:c3:1111:2222::/64', prefixes)
        self.assertIn('2003:c3:1111:2222::58/128', own)

    def test_the_include(self):
        text = sync.render_nginx(['2003:c3:172e:f989::/64'], ['192.168.2.58/32', f'{GUA}/128'], 'eno1')
        lines = [line for line in text.splitlines() if not line.startswith('#')]
        self.assertEqual(lines, ['2003:c3:172e:f989::/64 1;', '192.168.2.58/32 0;', f'{GUA}/128 0;'])


class WriteTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='lan6-sync-')
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.path = os.path.join(self.dir, 'helena-owner-networks.conf')
        self.calls: list[list[str]] = []
        self.nginx_ok = True
        original = sync.run

        def fake(argv, **kwargs):
            self.calls.append(list(argv))
            if argv[:2] == ['nginx', '-t']:
                return subprocess.CompletedProcess(argv, 0 if self.nginx_ok else 1, '', 'emerg: bad')
            if argv[:2] == ['systemctl', 'is-active']:
                return subprocess.CompletedProcess(argv, 0, '', '')
            if argv[:2] == ['systemctl', 'reload']:
                return subprocess.CompletedProcess(argv, 0, '', '')
            return original(argv, **kwargs)
        sync.run = fake
        self.addCleanup(setattr, sync, 'run', original)

    def read(self):
        with open(self.path) as handle:
            return handle.read()

    def test_written_tested_reloaded_and_left_alone_when_equal(self):
        self.assertEqual(sync.sync_nginx('a 1;\n', path=self.path, dry_run=False, reload=True), 0)
        self.assertEqual(self.read(), 'a 1;\n')
        self.assertEqual(oct(os.stat(self.path).st_mode & 0o777), '0o644')
        self.assertIn(['systemctl', 'reload', 'nginx'], self.calls)
        self.calls.clear()
        self.assertEqual(sync.sync_nginx('a 1;\n', path=self.path, dry_run=False, reload=True), 0)
        self.assertEqual(self.calls, [])  # unchanged: no test, no reload

    def test_a_failed_nginx_test_puts_the_old_file_back(self):
        sync.sync_nginx('old 1;\n', path=self.path, dry_run=False, reload=True)
        self.nginx_ok = False
        self.calls.clear()
        self.assertEqual(sync.sync_nginx('new 1;\n', path=self.path, dry_run=False, reload=True), 1)
        self.assertEqual(self.read(), 'old 1;\n')
        self.assertNotIn(['systemctl', 'reload', 'nginx'], self.calls)

    def test_a_failed_test_of_a_first_file_removes_it(self):
        self.nginx_ok = False
        self.assertEqual(sync.sync_nginx('new 1;\n', path=self.path, dry_run=False, reload=True), 1)
        self.assertFalse(os.path.exists(self.path))

    def test_dry_run_and_no_reload(self):
        self.assertEqual(sync.sync_nginx('x 1;\n', path=self.path, dry_run=True, reload=True), 0)
        self.assertFalse(os.path.exists(self.path))
        self.assertEqual(sync.sync_nginx('x 1;\n', path=self.path, dry_run=False, reload=False), 0)
        self.assertEqual(self.read(), 'x 1;\n')
        self.assertEqual(self.calls, [])

    def test_no_nginx_no_file(self):
        missing = os.path.join(self.dir, 'nope', 'helena-owner-networks.conf')
        self.assertEqual(sync.sync_nginx('x 1;\n', path=missing, dry_run=False, reload=True), 0)
        self.assertFalse(os.path.exists(missing))

    def test_arguments(self):
        self.assertEqual(sync.main(['--firewall-only', '--nginx-only']), 2)
        self.assertEqual(sync.main(['--bogus']), 2)


class AuditIncludeCheckTests(unittest.TestCase):
    """audit.sh net.local_owner's IPv6 part (the python between <<'PY' and PY after
    owner_include), run with a fake `ip` that answers like LINKS/ROUTES above."""

    def setUp(self):
        with open(os.path.join(HERE, '..', 'audit.sh')) as handle:
            audit = handle.read()
        start = audit.index("<<'PY'", audit.index('owner_include=')) + len("<<'PY'\n")
        self.snippet = audit[start:audit.index('\nPY\n', start)]
        self.dir = tempfile.mkdtemp(prefix='audit-owner-')
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        answers = {'addr show': LINKS, '-6 route show default': ROUTES6, '-4 route show default': ROUTES4}
        fake = os.path.join(self.dir, 'ip')
        with open(fake, 'w') as handle:
            handle.write('#!/usr/bin/env python3\nimport json, sys\n'
                         f'answers = {json.dumps(answers)!r}\n'
                         'print(json.dumps(json.loads(answers)[" ".join(sys.argv[2:])]))\n')
        os.chmod(fake, 0o755)

    def check(self, include: str) -> list[str]:
        path = os.path.join(self.dir, 'owner-networks.conf')
        with open(path, 'w') as handle:
            handle.write(include)
        env = {**os.environ, 'PATH': self.dir + os.pathsep + os.environ.get('PATH', '')}
        result = subprocess.run([sys.executable, '-I', '-', path], input=self.snippet, capture_output=True,
                                text=True, env=env, check=True)
        return [line for line in result.stdout.splitlines() if line]

    def test_the_rendered_include_passes(self):
        prefixes, own = sync.owner_networks(LINKS, 'eno1')
        self.assertEqual(self.check(sync.render_nginx(prefixes, own, 'eno1')), [])

    def test_a_stale_or_dangerous_include_is_named(self):
        prefixes, own = sync.owner_networks(LINKS, 'eno1')
        stale = sync.render_nginx(prefixes, [n for n in own if not n.startswith(GUA)], 'eno1')
        self.assertEqual(self.check(stale),
                         [f'the machine address {GUA} is not excluded from the owner sign-in (helena-lan6-sync)'])
        # A missing privacy address is tolerated (it may lag the 5-minute sync).
        self.assertEqual(self.check(sync.render_nginx(prefixes, [n for n in own if not n.startswith(TEMP)], 'eno1')),
                         [])
        bad = sync.render_nginx(prefixes + ['fe80::/10', 'fd11:22::/64'], own, 'eno1')
        problems = self.check(bad)
        self.assertIn('the owner networks include gives the owner sign-in to fe80::/10', problems)
        self.assertIn('the owner networks include gives the owner sign-in to fd11:22::/64, not on the LAN interface',
                      problems)


class OwnerMapTests(unittest.TestCase):
    def test_the_geo_includes_the_networks_and_keeps_the_rest(self):
        text = configure.owner_map('kingston-server.local', '80', 'f' * 64, '/etc/nginx/helena-owner-networks.conf')
        geo = text.split('}\n', 1)[0]
        self.assertIn('    default 0;\n    192.168.2.0/24 1;\n    include /etc/nginx/helena-owner-networks.conf;\n', geo)
        self.assertIn('map "$remote_addr|$server_addr" $volition_local_self {', text)
        self.assertIn('"kingston-server.local:1:80:0" "' + 'f' * 64 + '";', text)
        # The kiosk's own listener, unchanged (the host name as re.escape writes it).
        self.assertIn('"~^(kingston-server\\.local|kingston\\-server\\.local):[01]:8088:[01]$"', text)
        https = configure.owner_map('helena.volition.one', '443', 'f' * 64)
        self.assertIn('"helena.volition.one:1:443:0"', https)
        self.assertIn(f'include {configure.OWNER_NETWORKS};', https)


if __name__ == '__main__':
    unittest.main()
