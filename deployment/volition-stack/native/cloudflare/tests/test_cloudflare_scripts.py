"""Unit tests of the home-network HTTPS and origin scripts (lan_https.py, switch_origin.py) and
of the owner map local-owner/configure.py writes for the home name. Run:

    python3 -m unittest discover -s deployment/volition-stack/native/cloudflare/tests -v

The end-to-end proof with a real nginx is tests/lan-https-selftest.sh.
"""

from __future__ import annotations

import importlib.util
import os
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve().parent
CLOUDFLARE = HERE.parent
FIXTURE = HERE / 'fixtures' / 'lan-site.conf'
HOME = 'helena-home.volition.one'


def load(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


lan_https = load('lan_https', CLOUDFLARE / 'lan_https.py')
switch_origin = load('switch_origin', CLOUDFLARE / 'switch_origin.py')
sys.path.insert(0, str(CLOUDFLARE.parent / 'local-owner'))
import configure  # noqa: E402


def block(text: str, opening: str) -> str:
    start = text.index(opening)
    return text[start:text.index('\n    }', start)]


class LanHttpsEdit(unittest.TestCase):
    def setUp(self):
        self.site = FIXTURE.read_text()
        self.edited = lan_https.edit(self.site, HOME)

    def test_listens_on_443_with_the_certificate_and_http2(self):
        for line in ('listen 443 ssl default_server;', 'listen [::]:443 ssl default_server;',
                     'http2 on;', f'ssl_certificate /etc/letsencrypt/live/{HOME}/fullchain.pem;',
                     f'ssl_certificate_key /etc/letsencrypt/live/{HOME}/privkey.pem;',
                     'include /etc/nginx/snippets/helena-tls.conf;'):
            self.assertIn(line, self.edited)
        # The kiosk's loopback entry and plain http stay.
        self.assertIn('listen 127.0.0.1:8088;', self.edited)
        self.assertIn('listen 80 default_server;', self.edited)

    def test_redirects_lan_http_and_sends_hsts(self):
        self.assertIn(f'if ($helena_lan_https_redirect) {{ return 301 https://{HOME}$request_uri; }}',
                      self.edited)
        self.assertIn('add_header Strict-Transport-Security $helena_lan_hsts always;', self.edited)

    def test_trusts_the_home_origin_for_tools_and_websockets(self):
        self.assertIn(f'"https://{HOME}" 1;', self.edited)
        self.assertIn(f'server_name kingston-server.local kingston-server {HOME};', self.edited)
        self.assertEqual(self.edited.count(f'wss://{HOME}"'), 2)

    def test_blanks_the_tunnel_entry_proof_towards_web_and_api(self):
        blank = 'proxy_set_header X-Helena-Edge-Entry "";'
        self.assertIn(blank, block(self.edited, '    location / {'))
        self.assertIn(blank, block(self.edited, '    location /backend/ {'))
        self.assertEqual(self.edited.count(blank), 2)

    def test_is_idempotent_also_after_configure_py_added_its_lines(self):
        self.assertEqual(lan_https.edit(self.edited, HOME), self.edited)
        # configure.py puts its capability line right after the location opening, above ours.
        moved = self.edited.replace(
            '    location / {\n',
            '    location / {\n        proxy_set_header X-Volition-Local-Access $helena_owner_capability;\n', 1)
        again = lan_https.edit(moved, HOME)
        self.assertEqual(again.count('proxy_set_header X-Helena-Edge-Entry "";'), 2)

    def test_refuses_a_site_it_does_not_recognise(self):
        with self.assertRaises(SystemExit):
            lan_https.edit(self.site.replace('    listen [::]:80 default_server;\n', ''), HOME)

    def test_the_maps_redirect_only_lan_listeners_on_80(self):
        text = lan_https.MAPS_TEXT
        self.assertIn('"~^80:127\\."     0;', text)
        self.assertIn('"~^80:::1$"      0;', text)
        self.assertIn('"~^80:"          1;', text)
        # The loopback exceptions come first: nginx tries regexes in order.
        self.assertLess(text.index('~^80:127'), text.index('"~^80:"'))


class LanHttpsApplyAndRollback(unittest.TestCase):
    """main() against scratch paths, with nginx -t and the reload replaced."""

    def setUp(self):
        import tempfile
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.site = self.tmp / 'volition.conf'
        self.site.write_text(FIXTURE.read_text())
        (self.tmp / 'live' / HOME).mkdir(parents=True)
        (self.tmp / 'live' / HOME / 'fullchain.pem').write_text('cert')
        self.saved = {name: getattr(lan_https, name)
                      for name in ('MAPS', 'TLS_SNIPPET', 'BACKUPS', 'LETSENCRYPT',
                                   'OLD_REDIRECT_SITE', 'OLD_REDIRECT_LINK')}
        lan_https.MAPS = self.tmp / 'helena-lan-https.conf'
        lan_https.TLS_SNIPPET = self.tmp / 'helena-tls.conf'
        lan_https.BACKUPS = self.tmp / 'backup'
        lan_https.LETSENCRYPT = self.tmp / 'live'
        lan_https.OLD_REDIRECT_SITE = self.tmp / 'old-redirect.conf'
        lan_https.OLD_REDIRECT_LINK = self.tmp / 'old-redirect-link.conf'
        self.nginx_ok = True
        self.calls = []

        def run(cmd, check=False, **_kwargs):
            self.calls.append(cmd)
            code = 0 if (cmd[0] != 'nginx' or self.nginx_ok) else 1
            if check and code:
                raise RuntimeError(cmd)
            return type('Done', (), {'returncode': code})()
        self.saved_run = lan_https.subprocess.run
        lan_https.subprocess.run = run

    def tearDown(self):
        import shutil
        for name, value in self.saved.items():
            setattr(lan_https, name, value)
        lan_https.subprocess.run = self.saved_run
        shutil.rmtree(self.tmp)

    def main(self, *args):
        import contextlib, io
        argv = sys.argv
        sys.argv = ['lan_https.py', '--site', str(self.site), *args]
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                lan_https.main()
        finally:
            sys.argv = argv
        return out.getvalue()

    def backups(self):
        return sorted((self.tmp / 'backup').glob('lan-https-*'))

    def test_dry_run_writes_nothing(self):
        out = self.main()
        self.assertIn('dry run', out)
        self.assertEqual(self.site.read_text(), FIXTURE.read_text())
        self.assertFalse(lan_https.MAPS.exists())

    def test_apply_then_nothing_to_change_then_rollback(self):
        self.main('--apply')
        self.assertIn('listen 443 ssl default_server;', self.site.read_text())
        self.assertEqual(lan_https.MAPS.read_text(), lan_https.MAPS_TEXT)
        self.assertEqual(len(self.backups()), 1)
        self.assertIn(['systemctl', 'reload', 'nginx'], self.calls)
        out = self.main('--apply')
        self.assertIn('nothing to change', out)
        self.assertEqual(len(self.backups()), 1, 'an unchanged run keeps no backup')
        self.main('--apply', '--rollback')
        self.assertEqual(self.site.read_text(), FIXTURE.read_text())
        self.assertFalse(lan_https.MAPS.exists())

    def test_a_refused_config_puts_the_old_files_back(self):
        self.nginx_ok = False
        with self.assertRaises(SystemExit):
            self.main('--apply')
        self.assertEqual(self.site.read_text(), FIXTURE.read_text())
        self.assertFalse(lan_https.MAPS.exists())
        self.assertNotIn(['systemctl', 'reload', 'nginx'], self.calls)


class SwitchOrigin(unittest.TestCase):
    ENV = [
        'DATABASE_URL=postgres://example/unchanged\n',
        'APP_URL=https://helena.volition.one\n',
        'API_URL=https://helena.volition.one/backend\n',
        'COOKIE_DOMAIN=host-only\n',
        'TERMINAL_URL=http://kingston-server.local/terminal\n',
    ]

    def rewrite(self, lines, home):
        out, changes = switch_origin.rewrite(lines, 'helena.volition.one', home)
        return {line.split('=', 1)[0]: line.split('=', 1)[1].rstrip('\n')
                for line in out if '=' in line}, changes

    def test_adds_the_home_origin(self):
        env, changes = self.rewrite(self.ENV, HOME)
        self.assertEqual(env['APP_URL'], f'https://helena.volition.one,https://{HOME}')
        self.assertEqual(env['HELENA_HOME_URL'], f'https://{HOME}')
        # One api url (the primary origin); the web app rebases it per page origin.
        self.assertEqual(env['API_URL'], 'https://helena.volition.one/backend')
        self.assertEqual(env['PASSKEY_RP_ID'], 'helena.volition.one')
        self.assertEqual(env['SSO_LOGOUT_URL'],
                         'https://helena.volition.one/cdn-cgi/access/logout')
        self.assertEqual(env['TERMINAL_URL'], 'https://helena.volition.one/terminal')
        self.assertEqual(env['DATABASE_URL'], 'postgres://example/unchanged')
        self.assertTrue(any(change.startswith('HELENA_HOME_URL=') for change in changes))
        # Nothing but names and the new (public) values is reported.
        self.assertFalse(any('postgres://' in change for change in changes))

    def test_keeps_the_home_origin_on_a_rerun_and_removes_it_on_request(self):
        first, _ = switch_origin.rewrite(self.ENV, 'helena.volition.one', HOME)
        again, _ = self.rewrite(first, None)
        self.assertEqual(again['HELENA_HOME_URL'], f'https://{HOME}')
        self.assertEqual(again['APP_URL'], f'https://helena.volition.one,https://{HOME}')
        removed, changes = self.rewrite(first, '')
        self.assertNotIn('HELENA_HOME_URL', removed)
        self.assertEqual(removed['APP_URL'], 'https://helena.volition.one')
        self.assertIn('HELENA_HOME_URL (removed)', changes)

    def test_is_idempotent(self):
        first, _ = switch_origin.rewrite(self.ENV, 'helena.volition.one', HOME)
        second, changes = switch_origin.rewrite(first, 'helena.volition.one', HOME)
        self.assertEqual(first, second)
        self.assertEqual(changes, [])


class OwnerMapOnTheHomeName(unittest.TestCase):
    def test_the_capability_only_on_443_under_the_home_name(self):
        text = configure.owner_map(HOME, '443', 'FAKE', '/tmp/networks.conf')
        self.assertIn(f'"{HOME}:1:443:0" "FAKE";', text)
        self.assertNotIn(':1:80:0', text)
        # The kiosk keeps its loopback listener for both names.
        self.assertIn('kingston-server\\.local|helena\\-home\\.volition\\.one', text)
        # Loopback and link-local are never in the geo; the machine itself is never the owner.
        self.assertNotIn('127.', text)
        self.assertNotIn('fe80', text)
        self.assertIn('"~^([^|]+)\\|\\1$" 1;', text)


if __name__ == '__main__':
    unittest.main()
