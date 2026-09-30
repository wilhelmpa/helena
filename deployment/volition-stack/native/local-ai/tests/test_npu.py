import http.client
import importlib.util
import json
import subprocess
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('npu', HERE / 'npu-server.py')
npu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(npu)


class NpuTest(unittest.TestCase):
    def test_start_and_gateway_leave_voice_ports_available(self):
        def contents(path):
            if str(path).endswith('model.json'):
                return json.dumps({'model': 'qwen3.5:2b'})
            if str(path) == '/proc/meminfo':
                return 'MemAvailable: 52428800 kB\n'
            return 'test-only-key'

        installed = MagicMock(stdout=json.dumps({'models': [
            {'name': 'qwen3.5:2b'}, {'name': npu.EMBED},
        ]}))
        with patch.object(Path, 'read_text', contents), \
             patch.dict(npu.os.environ, {'CREDENTIALS_DIRECTORY': '/test-only'}), \
             patch.object(npu.subprocess, 'run', return_value=installed), \
             patch.object(npu.subprocess, 'Popen') as child, \
             patch.object(npu, 'ThreadingHTTPServer') as server, \
             patch.object(npu.threading, 'Thread'):
            npu.main()
        server.assert_called_once_with(('127.0.0.1', 13309), npu.Gateway)
        command = child.call_args.args[0]
        self.assertEqual(command[command.index('--port') + 1], '13310')

        handler = object.__new__(npu.Gateway)
        handler.headers = {'Authorization': 'Bearer test-only-key'}
        handler.server = MagicMock(key='test-only-key', model='qwen3.5:2b')
        handler.path, handler.command = '/v1/models', 'GET'
        handler.connection, handler.rfile, handler.wfile = MagicMock(), MagicMock(), MagicMock()
        handler.rfile.read.return_value = b''
        handler.send_response = handler.send_header = handler.end_headers = MagicMock()
        with patch.object(npu.http.client, 'HTTPConnection') as connection:
            response = connection.return_value.getresponse.return_value
            response.status = 200
            handler.forward()
        connection.assert_called_once_with('127.0.0.1', 13310, timeout=180)

    def test_install_dry_run_and_preserved_key(self):
        for operation in ('install', 'uninstall'):
            result = subprocess.run([str(HERE / 'npu-install.sh'), '--dry-run', operation], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('would: systemctl start', result.stdout)
            self.assertNotIn('curl', result.stdout)
        script = (HERE / 'npu-install.sh').read_text()
        self.assertIn('[ ! -f /etc/helena/volition-npu.key ]', script)

    def test_gateway_auth_and_model_restriction(self):
        server = npu.ThreadingHTTPServer(('127.0.0.1', 0), npu.Gateway)
        server.key, server.model = 'test-only-key', 'qwen3.5:2b'
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for path, auth, body, expected in [
                ('/v1/models', '', None, 401),
                ('/api/pull', 'Bearer test-only-key', '{}', 404),
                ('/v1/chat/completions', 'Bearer test-only-key', '{"model":"qwen3.5:9b"}', 400),
                ('/v1/chat/completions', 'Bearer test-only-key', '{"model":"qwen3.5:2b","max_tokens":9999}', 400),
            ]:
                conn = http.client.HTTPConnection(*server.server_address)
                conn.request('POST' if body else 'GET', path, body, {'Authorization': auth})
                response = conn.getresponse()
                self.assertEqual(response.status, expected)
                response.read()
                conn.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
