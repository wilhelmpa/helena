#!/usr/bin/env python3
"""Exercise the installed CLI against synthetic Responses in a loopback-only namespace."""

import http.server
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import uuid

HERE = Path(__file__).resolve().parent
CODEX = Path('/usr/local/bin/codex')


@unittest.skipUnless(os.environ.get('HELENA_CODEX_CONTRACT_TEST') == '1',
                     'Run explicitly inside an isolated network namespace')
class LocalCodexContractTest(unittest.TestCase):
    def test_installed_cli_reads_and_writes_with_local_function_tools(self):
        interfaces = json.loads(subprocess.check_output(['ip', '-j', 'link'], text=True))
        self.assertEqual([interface['ifname'] for interface in interfaces], ['lo'])
        self.assertTrue(CODEX.is_file())
        for kind in ('local-qwen36', 'local-qwen38'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory(prefix='local-codex-') as temp:
                root = Path(temp)
                for name in ('home', 'codex', 'work'):
                    (root / name).mkdir()
                marker = uuid.uuid4().hex
                (root / 'work/input.txt').write_text(marker)
                requests = []
                failures = []

                class Handler(http.server.BaseHTTPRequestHandler):
                    def log_message(self, *_args):
                        pass

                    def do_POST(self):
                        try:
                            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                            requests.append(body)
                            if len(requests) == 1:
                                item = {
                                    'type': 'function_call', 'id': 'fc_synthetic',
                                    'call_id': 'call_synthetic', 'name': 'exec_command',
                                    'arguments': json.dumps({
                                        'cmd': 'cat input.txt && cp input.txt output.txt',
                                        'workdir': str(root / 'work'), 'max_output_tokens': 1000,
                                    }), 'status': 'completed',
                                }
                            else:
                                item = {
                                    'type': 'message', 'id': 'msg_synthetic', 'role': 'assistant',
                                    'status': 'completed', 'content': [{
                                        'type': 'output_text', 'text': 'SYNTHETIC_OK', 'annotations': [],
                                    }],
                                }
                            response = {
                                'id': f'resp_{len(requests)}', 'object': 'response',
                                'status': 'completed', 'output': [item],
                                'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2},
                            }
                            events = [
                                {'type': 'response.output_item.done', 'output_index': 0, 'item': item},
                                {'type': 'response.completed', 'response': response},
                            ]
                            self.send_response(200)
                            self.send_header('Content-Type', 'text/event-stream')
                            self.end_headers()
                            for event in events:
                                self.wfile.write(f'data: {json.dumps(event)}\n\n'.encode())
                        except Exception as error:
                            failures.append(str(error))
                            raise

                server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    script = (
                        "import { localCodexArguments } from './owner-local-model.mjs';"
                        f"console.log(JSON.stringify(localCodexArguments({json.dumps(kind)})));"
                    )
                    args = json.loads(subprocess.check_output(
                        ['node', '--input-type=module', '-e', script], cwd=HERE, text=True))
                    args = [arg.replace(f'http://127.0.0.1:3000/owner-terminal/local/{kind}',
                                        f'http://127.0.0.1:{server.server_port}') for arg in args]
                    args += ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write',
                             'Read input.txt and copy its content into output.txt using exec_command.']
                    env = {
                        'HOME': str(root / 'home'), 'CODEX_HOME': str(root / 'codex'),
                        'PATH': '/usr/local/bin:/usr/bin:/bin', 'TERM': 'xterm-256color',
                        'LANG': 'C.UTF-8', 'HELENA_OWNER_LOCAL_TOKEN': 'synthetic-only',
                    }
                    print(subprocess.check_output([str(CODEX), '--version'], env=env,
                                                  text=True).strip())
                    result = subprocess.run([str(CODEX), *args], cwd=root / 'work', env=env,
                                            capture_output=True, text=True, timeout=45)
                    self.assertEqual(failures, [])
                    self.assertEqual(result.returncode, 0, result.stderr[-4000:])
                    self.assertEqual(len(requests), 2, result.stderr[-4000:])
                    expected_model = {'local-qwen36': 'Qwen3.6-35B-A3B-MTP-GGUF',
                                      'local-qwen38': 'Qwen3.8-27B-GGUF'}[kind]
                    for request in requests:
                        self.assertEqual(request['model'], expected_model)
                        self.assertFalse(request['store'])
                        self.assertTrue(request['stream'])
                        self.assertTrue(request['tools'])
                        self.assertTrue(all(t['type'] in ('function', 'custom')
                                            for t in request['tools']))
                        self.assertIn('exec_command', [t.get('name') for t in request['tools']])
                    outputs = [item['output'] for item in requests[1]['input']
                               if item['type'] == 'function_call_output']
                    self.assertTrue(any(marker in output for output in outputs), outputs)
                    self.assertEqual((root / 'work/output.txt').read_text(), marker)
                    self.assertIn('SYNTHETIC_OK', result.stdout)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()


if __name__ == '__main__':
    unittest.main()
