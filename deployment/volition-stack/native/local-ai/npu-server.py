#!/usr/bin/python3
"""Authenticated loopback gateway for the small, preinstalled FLM models."""
import hmac
import http.client
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODELS = {'qwen3.5:4b': 7 * 1024**3, 'qwen3.5:2b': 5 * 1024**3,
          'gemma4-it:e2b': 7 * 1024**3, 'gemma4-it:e4b': 10 * 1024**3}
EMBED = 'embed-gemma:300m'
# Voice proxies occupy 13306/13307 in both local profiles.
GATEWAY_PORT = 13309
WORKER_PORT = 13310


class Gateway(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def forward(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + self.server.key):
            self.send_error(401)
            return
        expected = {'/v1/models': 'GET', '/v1/chat/completions': 'POST', '/v1/embeddings': 'POST'}
        if expected.get(self.path) != self.command:
            self.send_error(404)
            return
        try:
            if self.command == 'POST':
                maintenance = Path('/var/lib/volition/model-maintenance/state.json')
                if maintenance.exists() and json.loads(maintenance.read_text()).get('proxyPaused'):
                    self.send_error(503, 'Model maintenance is pending')
                    return
            size = int(self.headers.get('Content-Length', '0'))
            if self.headers.get('Transfer-Encoding') or not 0 <= size <= 131072:
                self.send_error(413)
                return
            self.connection.settimeout(180)
            raw = self.rfile.read(size)
            if self.command == 'POST':
                data = json.loads(raw)
                model = EMBED if self.path.endswith('/embeddings') else self.server.model
                if data.get('model') != model:
                    self.send_error(400, 'Model is not active in this profile')
                    return
                if model != EMBED:
                    if not isinstance(data.get('max_tokens', 512), int) or not 1 <= data.get('max_tokens', 512) <= 1024:
                        self.send_error(400, 'Small NPU requests require at most 1024 output tokens')
                        return
                    data['max_tokens'] = data.get('max_tokens', 512)
                raw = json.dumps(data).encode()
            upstream = http.client.HTTPConnection('127.0.0.1', WORKER_PORT, timeout=180)
            try:
                upstream.request(self.command, self.path, body=raw or None, headers={'Content-Type': 'application/json'})
                response = upstream.getresponse()
                if self.path == '/v1/models' and response.status == 200:
                    response.read()
                    payload = json.dumps({'data': [
                        {'id': self.server.model, 'context_length': 8192},
                        {'id': EMBED, 'context_length': 2048},
                    ]}).encode()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                else:
                    self.send_response(response.status)
                    self.send_header('Content-Type', response.getheader('Content-Type', 'application/json'))
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    while chunk := response.read1(65536):
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    self.close_connection = True
            finally:
                upstream.close()
        except (ValueError, OSError, http.client.HTTPException):
            self.close_connection = True


def main():
    model = json.loads(Path('/var/lib/volition-npu/model.json').read_text())['model']
    if model not in MODELS:
        raise SystemExit('Only the small NPU models are allowed')
    memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    available = int(memory['MemAvailable'].split()[0]) * 1024
    footprint = MODELS[model]
    if available < 12 * 1024**3 + footprint:
        raise SystemExit('NPU memory reserve is unavailable')
    installed = subprocess.run(['/usr/bin/flm', 'list', '--filter', 'installed', '--json'],
                               check=True, capture_output=True, text=True)
    # Verify both tags before serve can attempt a download; the unit also denies external IPs.
    catalog = json.loads(installed.stdout)
    rows = catalog.get('models', [])
    tags = {row if isinstance(row, str) else row.get('tag', row.get('id', row.get('name'))) for row in rows}
    if not {model, EMBED}.issubset(tags):
        raise SystemExit('Required NPU models are not installed')
    key = (Path(os.environ['CREDENTIALS_DIRECTORY']) / 'npu.key').read_text().strip()
    if not key:
        raise SystemExit('Empty NPU key')
    child = subprocess.Popen(['/usr/bin/flm', 'serve', model, '--host', '127.0.0.1', '--port', str(WORKER_PORT),
                              '--ctx-len', '8192', '--embed', '1', '--cors', '0', '--q-len', '2'])
    server = ThreadingHTTPServer(('127.0.0.1', GATEWAY_PORT), Gateway)
    server.key, server.model = key, model
    threading.Thread(target=lambda: (child.wait(), server.shutdown()), daemon=True).start()
    try:
        server.serve_forever()
    finally:
        child.terminate()
        child.wait(timeout=30)
        server.server_close()


if __name__ == '__main__':
    main()
