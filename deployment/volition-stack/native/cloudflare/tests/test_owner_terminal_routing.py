"""Exercise the tunnel template with private nginx and synthetic HTTP/Unix upstreams."""

import http.client
import http.server
import pathlib
import shutil
import socket
import socketserver
import subprocess
import tempfile
import threading
import time
import unittest


HERE = pathlib.Path(__file__).resolve().parent.parent
KINDS = ('shell', 'claude', 'codex', 'helena-dev-claude', 'helena-dev-codex',
         'local-qwen36', 'local-qwen38', 'local-flash')


class SyntheticUpstream(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.server.requests.append((self.path, dict(self.headers)))
        status, body = 200, b'web fallback'
        headers = {}
        if self.server.role == 'api':
            status, body = 418, b'unexpected API route'
            if self.path.startswith('/auth/verify/'):
                edge = (self.headers.get('Cf-Access-Jwt-Assertion') == 'synthetic-access'
                        and self.headers.get('X-Helena-Entry') == 'tunnel')
                status = 204 if edge else 403
                if edge and '/owner-terminal/' in self.path:
                    status = 204 if self.headers.get('Cookie') == 'grant=synthetic' else 401
                    headers['X-Owner-Terminal-Token'] = 'synthetic-' + self.path.rsplit('/', 1)[1]
                body = b''
        elif self.server.role == 'terminal':
            kind = self.path.split('/')[3]
            status = 200 if self.headers.get('X-Owner-Terminal-Token') == 'synthetic-' + kind else 403
            body = self.path.encode()
            if status == 200 and self.headers.get('Upgrade') == 'websocket':
                status, body = 101, b''
                headers.update({'Upgrade': 'websocket', 'Connection': 'upgrade'})
        else:
            headers['Content-Security-Policy'] = "frame-ancestors 'none'"
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class TunnelOwnerTerminalRouting(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        nginx = shutil.which('nginx') or '/usr/sbin/nginx'
        if not pathlib.Path(nginx).is_file():
            raise RuntimeError('This routing proof requires the already installed nginx binary')
        scratch = tempfile.TemporaryDirectory(prefix='helena-terminal-nginx-')
        cls.addClassCleanup(scratch.cleanup)
        root = pathlib.Path(scratch.name)
        cls.upstreams = {}
        for role in ('api', 'web', 'terminal'):
            if role == 'terminal':
                server = socketserver.ThreadingUnixStreamServer(str(root / 'terminal.sock'), SyntheticUpstream)
            else:
                server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), SyntheticUpstream)
            server.role, server.requests = role, []
            server.daemon_threads = True
            cls.upstreams[role] = server
            cls.addClassCleanup(server.server_close)
            cls.addClassCleanup(server.shutdown)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0))
            cls.port = reserve.getsockname()[1]
        (root / 'headers.conf').write_text((HERE / 'helena-tunnel-headers.conf').read_text())
        (root / 'security.conf').write_text((HERE.parent / 'nginx/tool-proxy-security.conf').read_text())
        site = (HERE / 'nginx-tunnel.conf.in').read_text()
        substitutions = {
            '@HOST@': 'terminal.test', '@PORT@': str(cls.port),
            '/etc/nginx/snippets/helena-tunnel-headers.conf': str(root / 'headers.conf'),
            '/etc/nginx/snippets/volition-tool-proxy-security.conf': str(root / 'security.conf'),
            '/run/volition-owner-terminal/term.sock': str(root / 'terminal.sock'),
            '127.0.0.1:3000': '127.0.0.1:' + str(cls.upstreams['api'].server_port),
            '127.0.0.1:3001': '127.0.0.1:' + str(cls.upstreams['web'].server_port),
        }
        for source, target in substitutions.items():
            site = site.replace(source, target)
        config = root / 'nginx.conf'
        config.write_text(f'''
pid {root}/nginx.pid;
error_log {root}/error.log;
events {{}}
http {{
    access_log off;
    client_body_temp_path {root}/body;
    proxy_temp_path {root}/proxy;
    fastcgi_temp_path {root}/fastcgi;
    uwsgi_temp_path {root}/uwsgi;
    scgi_temp_path {root}/scgi;
    map $host $helena_edge_entry_token {{ default ""; }}
    {site}
}}
''')
        subprocess.run([nginx, '-t', '-p', str(root), '-c', str(config)],
                       check=True, capture_output=True)
        process = subprocess.Popen([nginx, '-p', str(root), '-c', str(config), '-g', 'daemon off;'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def stop_nginx():
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        cls.addClassCleanup(stop_nginx)
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=0.1):
                    return
            except OSError:
                if process.poll() is not None:
                    raise RuntimeError((root / 'error.log').read_text())
                time.sleep(0.01)
        raise RuntimeError('Private nginx did not become ready')

    def request(self, path, **overrides):
        headers = {'Host': 'terminal.test', 'Origin': 'https://terminal.test',
                   'Cookie': 'grant=synthetic', 'Authorization': 'Bearer synthetic-browser',
                   'Cf-Access-Jwt-Assertion': 'synthetic-access'}
        headers.update(overrides)
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request('GET', path, headers=headers)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_all_presets_reach_terminal_html_assets_and_websocket(self):
        for kind in KINDS:
            for suffix, headers, status in (
                ('', {}, 200), ('client/main.js', {}, 200),
                ('socket.io/?EIO=4&transport=websocket', {'Upgrade': 'websocket', 'Connection': 'Upgrade'}, 101),
            ):
                with self.subTest(kind=kind, suffix=suffix):
                    path = f'/focus/owner-terminal/{kind}/main/{suffix}'
                    self.assertEqual(self.request(path, **headers)[0], status)
                    upstream_path, upstream_headers = self.upstreams['terminal'].requests[-1]
                    self.assertEqual(upstream_path, path)
                    self.assertEqual(upstream_headers.get('X-Owner-Terminal-Token'), 'synthetic-' + kind)
                    self.assertNotIn('Cookie', upstream_headers)
                    self.assertNotIn('Authorization', upstream_headers)
                    self.assertEqual(self.upstreams['api'].requests[-1][0], '/auth/verify/owner-terminal/' + kind)

    def test_missing_edge_missing_grant_and_wrong_origin_never_reach_terminal(self):
        for kind in ('shell', 'local-qwen36', 'local-qwen38', 'local-flash'):
            for headers, status in (({'Cf-Access-Jwt-Assertion': ''}, 403),
                                    ({'Cookie': ''}, 401), ({'Origin': 'https://other.test'}, 403)):
                with self.subTest(kind=kind, headers=headers):
                    before = len(self.upstreams['terminal'].requests)
                    self.assertEqual(self.request(f'/focus/owner-terminal/{kind}/main/', **headers)[0], status)
                    self.assertEqual(len(self.upstreams['terminal'].requests), before)

    def test_public_model_capabilities_never_reach_api_or_terminal(self):
        for prefix in ('/', '/backend/', '/api/'):
            for suffix in ('bootstrap', 'synthetic-capability/v1/responses'):
                with self.subTest(prefix=prefix, suffix=suffix):
                    before = {role: len(server.requests) for role, server in self.upstreams.items()}
                    self.assertEqual(self.request(prefix + 'owner-terminal/local/' + suffix)[0], 404)
                    self.assertEqual({role: len(server.requests) for role, server in self.upstreams.items()}, before)

    def test_unknown_preset_never_reaches_terminal(self):
        before = len(self.upstreams['terminal'].requests)
        self.assertEqual(self.request('/focus/owner-terminal/unknown/main/'), (200, b'web fallback'))
        self.assertEqual(len(self.upstreams['terminal'].requests), before)


if __name__ == '__main__':
    unittest.main()
