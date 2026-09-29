import http.client
import importlib.util
import subprocess
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('npu', HERE / 'npu-server.py')
npu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(npu)


class NpuTest(unittest.TestCase):
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
