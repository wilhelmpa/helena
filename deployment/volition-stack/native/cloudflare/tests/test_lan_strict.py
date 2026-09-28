"""Strict LAN nginx rendering and installer tests; never touches host nginx."""
from __future__ import annotations

import importlib.util
import contextlib
import http.client
import http.server
import io
import json
import pathlib
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent
CLOUDFLARE = HERE.parent
spec = importlib.util.spec_from_file_location('lan_strict', CLOUDFLARE / 'lan_strict.py')
lan_strict = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lan_strict)


class StrictLanRender(unittest.TestCase):
    def setUp(self):
        self.template = lan_strict.TUNNEL.read_text()
        self.site = lan_strict.render(self.template, pathlib.Path('/tmp/certs'))

    def test_all_routes_inherit_the_gate_or_run_a_gated_helena_check(self):
        self.assertIn('auth_request /_helena_lan;', self.site)
        self.assertIn('proxy_pass http://127.0.0.1:3000/auth/verify/lan;', self.site)
        self.assertEqual(self.site.count('auth_request /_plan_auth;'),
                         self.template.count('auth_request /_plan_auth;'))
        self.assertEqual(self.site.count('auth_request /_owner_terminal_auth;'),
                         self.template.count('auth_request /_owner_terminal_auth;'))
        self.assertIn('rewrite ^ /browser/ last;', self.site)
        self.assertIn('rewrite ^ /code/ last;', self.site)
        self.assertNotIn('return 301 /browser/;', self.site)
        self.assertNotIn('X-Volition-Local-Access $helena_owner_capability', self.site)

    def test_public_callbacks_have_one_fixed_upstream_and_strict_tls(self):
        self.assertIn('location ^~ /cdn-cgi/', self.site)
        self.assertIn('error_page 403 = @helena_public_edge;', self.site)
        self.assertIn('location @helena_public_edge', self.site)
        self.assertIn('resolver 1.1.1.1 1.0.0.1 ipv6=off', self.site)
        self.assertIn('proxy_ssl_verify on;', self.site)
        self.assertIn('proxy_ssl_name helena.volition.one;', self.site)
        self.assertIn('proxy_pass https://$helena_public_host$request_uri;', self.site)
        callback = self.site.split('location ^~ /cdn-cgi/', 1)[1].split('    }', 1)[0]
        for header in ('Cf-Access-Client-Id', 'Cf-Access-Client-Secret',
                       'Cf-Connecting-IP', 'X-Volition-Local-Access',
                       'X-Helena-Edge-Entry', 'X-Forwarded-For'):
            self.assertIn(f'proxy_set_header {header} "";', callback)
        self.assertEqual(self.site.count('proxy_pass https://$helena_public_host$request_uri;'), 2)
        self.assertIn('access_log off;', self.site)

    def test_old_site_and_entry_map_are_extended_once(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('lan_https', CLOUDFLARE / 'lan_https.py')
        lan_https = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(lan_https)
        old = lan_https.edit((HERE / 'fixtures/lan-site.conf').read_text(),
                             'helena-home.volition.one')
        redirected = lan_strict.redirect_legacy(old)
        self.assertIn('if ($server_port = 443) { return 308 https://helena.volition.one$request_uri; }',
                      redirected)
        self.assertEqual(lan_strict.redirect_legacy(redirected), redirected)
        token = 'a' * 64  # synthetic fixture, never a live secret
        original = ('map "$server_addr:$server_port:$proxy_host" $helena_edge_entry_token {\n'
                    '    default "";\n'
                    f'    "127.0.0.1:8090:127.0.0.1:3001" "{token}";\n}}\n')
        extended = lan_strict.extend_entry_map(original, '192.168.2.58')
        self.assertIn(f'"192.168.2.58:443:127.0.0.1:3001" "{token}";', extended)
        self.assertEqual(lan_strict.extend_entry_map(extended, '192.168.2.58'), extended)

    def test_installer_dry_mode_reads_no_proof_and_changes_nothing(self):
        spec = importlib.util.spec_from_file_location('lan_https', CLOUDFLARE / 'lan_https.py')
        lan_https = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(lan_https)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            legacy = root / 'legacy.conf'
            legacy.write_text(lan_https.edit((HERE / 'fixtures/lan-site.conf').read_text(),
                                             'helena-home.volition.one'))
            original = legacy.read_text()
            args = ['lan_strict.py', '--legacy', str(legacy), '--site', str(root / 'strict.conf'),
                    '--entry-map', str(root / 'missing-proof.conf'),
                    '--snippet', str(root / 'headers.conf'),
                    '--enabled', str(root / 'enabled.conf')]
            output = io.StringIO()
            with patch.object(lan_strict.sys, 'argv', args), contextlib.redirect_stdout(output):
                self.assertEqual(lan_strict.main(), 0)
            self.assertIn('dry run; no files changed', output.getvalue())
            self.assertEqual(legacy.read_text(), original)
            self.assertEqual(list(root.glob('*')), [legacy])

    def test_nginx_accepts_the_rendered_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'snippets').mkdir()
            certs = root / 'certs'
            certs.mkdir()
            subprocess.run([
                'openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt',
                'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
                '-subj', '/CN=helena.volition.one', '-keyout', str(certs / 'privkey.pem'),
                '-out', str(certs / 'fullchain.pem'),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            snippets = root / 'snippets'
            (snippets / 'helena-lan-strict-headers.conf').write_text(
                lan_strict.HEADERS.read_text())
            for name in ('helena-tls', 'volition-tool-proxy-security'):
                (snippets / f'{name}.conf').write_text('')
            site = lan_strict.render(self.template, certs,
                                     snippets / 'helena-lan-strict-headers.conf')
            site = site.replace('/etc/nginx/snippets/', str(snippets) + '/')
            site = site.replace('listen 443 ssl;', 'listen 127.0.0.1:18443 ssl;')
            site = site.replace('listen [::]:443 ssl;', 'listen [::1]:18443 ssl;')
            (root / 'strict.conf').write_text(site)
            (root / 'nginx.conf').write_text(f'''pid {root}/nginx.pid;
daemon off;
master_process off;
error_log {root}/error.log;
events {{}}
http {{
    access_log off;
    map "$server_addr:$server_port:$proxy_host" $helena_edge_entry_token {{
        volatile; default "";
    }}
    map $http_origin $helena_tunnel_origin_ok {{ default 0; "" 1;
        "https://helena.volition.one" 1; }}
    include {root}/strict.conf;
}}
''')
            result = subprocess.run(['/usr/sbin/nginx', '-t', '-c', str(root / 'nginx.conf'),
                                     '-p', str(root)], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_nginx_accepts_strict_and_redirecting_legacy_sites_together(self):
        spec = importlib.util.spec_from_file_location('lan_https', CLOUDFLARE / 'lan_https.py')
        lan_https = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(lan_https)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            snippets = root / 'snippets'
            snippets.mkdir()
            certs = root / 'certs'
            certs.mkdir()
            subprocess.run([
                'openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt',
                'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
                '-subj', '/CN=helena.volition.one', '-keyout', str(certs / 'privkey.pem'),
                '-out', str(certs / 'fullchain.pem'),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            (snippets / 'helena-lan-strict-headers.conf').write_text(
                lan_strict.HEADERS.read_text())
            for name in ('helena-tls', 'volition-tool-proxy-security',
                         'volition-project-terminal', 'volition-owner-terminal'):
                (snippets / f'{name}.conf').write_text('')
            strict = lan_strict.render(self.template, certs,
                                       snippets / 'helena-lan-strict-headers.conf')
            strict = strict.replace('/etc/nginx/snippets/', str(snippets) + '/')
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                tls_port = reservation.getsockname()[1]
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                http_port = reservation.getsockname()[1]
            strict = strict.replace('listen 443 ssl;',
                                    f'listen 127.0.0.1:{tls_port} ssl;')
            strict = strict.replace('listen [::]:443 ssl;', '')
            legacy = lan_https.edit((HERE / 'fixtures/lan-site.conf').read_text(),
                                    'helena-home.volition.one', certs)
            legacy = lan_strict.redirect_legacy(legacy)
            legacy = legacy.replace('/etc/nginx/snippets/', str(snippets) + '/')
            legacy = legacy.replace('listen 80 default_server;',
                                    f'listen 127.0.0.1:{http_port} default_server;')
            legacy = legacy.replace('listen [::]:80 default_server;', '')
            legacy = legacy.replace('listen 443 ssl default_server;',
                                    f'listen 127.0.0.1:{tls_port} ssl default_server;')
            legacy = legacy.replace('listen [::]:443 ssl default_server;', '')
            legacy = legacy.replace('if ($server_port = 443)',
                                    f'if ($server_port = {tls_port})')
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                kiosk_port = reservation.getsockname()[1]
            legacy = legacy.replace('listen 127.0.0.1:8088;',
                                    f'listen 127.0.0.1:{kiosk_port};')
            # Never let a scratch vhost forward a failed test to the running stack.
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                fake_api_port = reservation.getsockname()[1]
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                fake_web_port = reservation.getsockname()[1]
            legacy = legacy.replace('127.0.0.1:3000', f'127.0.0.1:{fake_api_port}')
            legacy = legacy.replace('127.0.0.1:3001', f'127.0.0.1:{fake_web_port}')
            strict = strict.replace('127.0.0.1:3000', f'127.0.0.1:{fake_api_port}')
            strict = strict.replace('127.0.0.1:3001', f'127.0.0.1:{fake_web_port}')
            (root / 'strict.conf').write_text(strict)
            (root / 'legacy.conf').write_text(legacy)
            (root / 'nginx.conf').write_text(f'''pid {root}/nginx.pid;
daemon off;
master_process off;
error_log {root}/error.log;
events {{}}
http {{
    access_log off;
    map "$server_addr:$server_port:$proxy_host" $helena_edge_entry_token {{
        volatile; default "";
    }}
    map $remote_addr $helena_owner_capability {{ default ""; }}
    map $remote_addr $helena_client_addr {{ default $remote_addr; }}
    map "$server_port:$server_addr" $helena_lan_https_redirect {{ default 0; }}
    map "$https:$upstream_http_strict_transport_security" $helena_lan_hsts {{ default ""; }}
    map $http_origin $helena_tunnel_origin_ok {{ default 0; "" 1;
        "https://helena.volition.one" 1; }}
    include {root}/legacy.conf;
    include {root}/strict.conf;
}}
''')
            result = subprocess.run(['/usr/sbin/nginx', '-t', '-c', str(root / 'nginx.conf'),
                                     '-p', str(root)], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            process = subprocess.Popen(['/usr/sbin/nginx', '-c', str(root / 'nginx.conf'),
                                        '-p', str(root)], stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL)
            try:
                for attempt in range(20):
                    try:
                        connection = http.client.HTTPSConnection('127.0.0.1', tls_port,
                            context=ssl._create_unverified_context(), timeout=2)
                        connection.request('GET', '/private', headers={
                            'Host': 'helena-home.volition.one'})
                        response = connection.getresponse()
                        response.read()
                        self.assertEqual(response.status, 308)
                        self.assertEqual(response.getheader('Location'),
                                         'https://helena.volition.one/private')
                        connection.close()
                        break
                    except ConnectionRefusedError:
                        if attempt == 19:
                            raise
                        time.sleep(.05)
                    except TimeoutError as error:
                        raise AssertionError((root / 'error.log').read_text()) from error
            finally:
                process.terminate()
                process.wait(timeout=3)

    def test_nginx_gates_requests_and_replaces_forged_headers(self):
        def free_port():
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                return sock.getsockname()[1]

        api_port, web_port, tool_port, edge_port, nginx_port = (
            free_port(), free_port(), free_port(), free_port(), free_port())

        class Upstream(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                cookie = '; '.join(self.headers.get_all('Cookie', []))
                if self.path == '/auth/verify/lan':
                    self.send_response(204 if cookie.count('CF_Authorization=') == 1 and
                                       'CF_Authorization=valid' in cookie else 403)
                    self.end_headers()
                    return
                if self.path == '/auth/verify':
                    self.send_response(204 if 'session=valid' in cookie else 403)
                    self.end_headers()
                    return
                if self.path == '/auth/verify/owner-terminal/shell':
                    ok = 'session=valid' in cookie and 'CF_Authorization=valid' in cookie
                    self.send_response(204 if ok else 403)
                    if ok:
                        self.send_header('X-Owner-Terminal-Token', 'synthetic-owner-token')
                    self.end_headers()
                    return
                data = json.dumps({key: self.headers.get(key, '') for key in (
                    'X-Helena-Entry', 'X-Helena-Edge-Entry', 'Cf-Access-Jwt-Assertion',
                    'X-Volition-Local-Access', 'X-Real-IP', 'X-Forwarded-For',
                    'Cf-Connecting-IP', 'X-Owner-Terminal-Token',
                    'X-Volition-Agent-Project',
                    'Cookie',
                    'X-Forwarded-Prefix',
                )}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *_args):
                pass

        class PublicEdge(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                data = json.dumps({
                    'path': self.path,
                    'host': self.headers.get('Host'),
                    'entry': self.headers.get('X-Helena-Entry'),
                }).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *_args):
                pass

        api = http.server.ThreadingHTTPServer(('127.0.0.1', api_port), Upstream)
        web = http.server.ThreadingHTTPServer(('127.0.0.1', web_port), Upstream)
        tool = http.server.ThreadingHTTPServer(('127.0.0.1', tool_port), Upstream)
        edge = http.server.ThreadingHTTPServer(('127.0.0.1', edge_port), PublicEdge)
        threads = [threading.Thread(target=server.serve_forever, daemon=True)
                   for server in (api, web, tool, edge)]
        for thread in threads:
            thread.start()
        process = None
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                snippets = root / 'snippets'
                snippets.mkdir()
                certs = root / 'certs'
                certs.mkdir()
                subprocess.run([
                    'openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt',
                    'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
                    '-subj', '/CN=helena.volition.one', '-keyout', str(certs / 'privkey.pem'),
                    '-out', str(certs / 'fullchain.pem'),
                ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                (snippets / 'helena-lan-strict-headers.conf').write_text(
                    lan_strict.HEADERS.read_text())
                (snippets / 'helena-tls.conf').write_text('')
                (snippets / 'volition-tool-proxy-security.conf').write_text(
                    (CLOUDFLARE.parent / 'nginx/tool-proxy-security.conf').read_text())
                site = lan_strict.render(self.template, certs,
                                         snippets / 'helena-lan-strict-headers.conf')
                site = site.replace('/etc/nginx/snippets/', str(snippets) + '/')
                site = site.replace('listen 443 ssl;', f'listen 127.0.0.1:{nginx_port} ssl;')
                site = site.replace('listen [::]:443 ssl;', '')
                site = site.replace('127.0.0.1:3000', f'127.0.0.1:{api_port}')
                site = site.replace('127.0.0.1:3001', f'127.0.0.1:{web_port}')
                site = site.replace('127.0.0.1:6082', f'127.0.0.1:{tool_port}')
                site = site.replace('http://unix:/run/volition-owner-terminal/term.sock:',
                                    f'http://127.0.0.1:{tool_port}')
                site = site.replace('https://$helena_public_host$request_uri',
                                    f'http://127.0.0.1:{edge_port}$request_uri')
                (root / 'strict.conf').write_text(site)
                (root / 'nginx.conf').write_text(f'''pid {root}/nginx.pid;
daemon off;
master_process off;
error_log {root}/error.log;
events {{}}
http {{
    map "$server_addr:$server_port:$proxy_host" $helena_edge_entry_token {{
        volatile; default "";
        "127.0.0.1:{nginx_port}:127.0.0.1:{web_port}" "synthetic-proof";
    }}
    map $http_origin $helena_tunnel_origin_ok {{ default 0; "" 1;
        "https://helena.volition.one" 1; }}
    include {root}/strict.conf;
}}
''')
                subprocess.run(['/usr/sbin/nginx', '-t', '-c', str(root / 'nginx.conf'),
                                '-p', str(root)], check=True, capture_output=True)
                process = subprocess.Popen(['/usr/sbin/nginx', '-c', str(root / 'nginx.conf'),
                                            '-p', str(root)], stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL)
                context = ssl._create_unverified_context()

                def get(path, cookie='', extra=None):
                    for attempt in range(20):
                        try:
                            connection = http.client.HTTPSConnection('127.0.0.1', nginx_port,
                                                                     context=context, timeout=2)
                            connection.request('GET', path, headers={
                                'Host': 'helena.volition.one', 'Cookie': cookie, **(extra or {})})
                            response = connection.getresponse()
                            body = response.read()
                            connection.close()
                            return response.status, body, response.getheader('Location')
                        except ConnectionRefusedError:
                            if attempt == 19:
                                raise
                            time.sleep(.05)

                for path, cookie in (('/', ''), ('/', 'CF_Authorization=expired'),
                                     ('/backend/anything', ''),
                                     ('/cdn-cgi/access/login?next=one', '')):
                    status, body, _ = get(path, cookie)
                    self.assertEqual(status, 200)
                    forwarded = json.loads(body)
                    self.assertEqual(forwarded['path'], path)
                    self.assertEqual(forwarded['host'], 'helena.volition.one')
                    self.assertIsNone(forwarded['entry'])
                connection = http.client.HTTPSConnection('127.0.0.1', nginx_port,
                                                         context=context, timeout=2)
                connection.putrequest('GET', '/', skip_host=True)
                connection.putheader('Host', 'helena.volition.one')
                connection.putheader('Cookie', 'CF_Authorization=valid; CF_Binding=b')
                connection.putheader('Cookie', 'CF_Authorization=forged')
                connection.endheaders()
                duplicate = connection.getresponse()
                duplicate.read()
                self.assertEqual(duplicate.status, 200)
                connection.close()
                self.assertEqual(get('/browser', 'CF_Authorization=valid')[0], 200)
                status, body, _ = get('/browser/',
                                      'CF_Authorization=valid; CF_Binding=b; session=valid')
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body)['Cookie'], '')
                self.assertEqual(json.loads(body)['X-Helena-Edge-Entry'], '')
                self.assertEqual(json.loads(body)['X-Forwarded-Prefix'], '/browser')
                status, body, _ = get('/focus/owner-terminal/shell/test',
                                      'CF_Authorization=valid; CF_Binding=b; session=valid')
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body)['X-Owner-Terminal-Token'],
                                 'synthetic-owner-token')
                self.assertEqual(json.loads(get('/cdn-cgi/access/unknown')[1])['path'],
                                 '/cdn-cgi/access/unknown')
                forged = {'X-Helena-Entry': 'tunnel', 'X-Helena-Edge-Entry': 'forged',
                          'Cf-Access-Jwt-Assertion': 'forged',
                          'X-Volition-Local-Access': 'forged',
                          'Cf-Connecting-IP': '10.0.0.1',
                          'X-Volition-Agent-Project': 'home',
                          'X-Owner-Terminal-Token': 'forged',
                          'X-Forwarded-For': '10.0.0.1'}
                forged['X-Forwarded-Prefix'] = '/forged'
                status, body, _ = get('/', 'CF_Authorization=valid; CF_Binding=b', forged)
                self.assertEqual(status, 200)
                headers = json.loads(body)
                self.assertEqual(headers['X-Helena-Entry'], 'lan')
                self.assertEqual(headers['X-Helena-Edge-Entry'], 'synthetic-proof')
                self.assertEqual(headers['Cf-Access-Jwt-Assertion'], 'valid')
                self.assertEqual(headers['X-Volition-Local-Access'], '')
                self.assertEqual(headers['Cf-Connecting-IP'], '')
                self.assertEqual(headers['X-Owner-Terminal-Token'], '')
                self.assertEqual(headers['X-Volition-Agent-Project'], '')
                self.assertEqual(headers['X-Forwarded-For'], '127.0.0.1')
                self.assertEqual(headers['X-Forwarded-Prefix'], '')
                status, body, _ = get('/backend/anything',
                                      'CF_Authorization=valid; CF_Binding=b', forged)
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body)['X-Helena-Edge-Entry'], '')
        finally:
            if process is not None:
                process.terminate()
                process.wait(timeout=3)
            for server in (api, web, tool, edge):
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
