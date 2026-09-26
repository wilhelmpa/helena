#!/usr/bin/env python3
"""Execute the owner launcher with private CLI and tmux fixtures, without a login or provider."""

import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class OwnerCodexRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='owner-codex-', dir='/tmp')
        self.root = Path(self.temporary.name).resolve()
        self.home = self.root / 'home'
        (self.home / 'volition/plan').mkdir(parents=True)
        self.codex_home = self.home / 'custom-codex-home'
        self.codex_home.mkdir()
        self.history = self.codex_home / 'history.jsonl'
        self.history.write_text('synthetic existing conversation\n')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.bind(str(self.root / 'tmux.sock'))
        legacy = self.home / '.local/bin/codex'
        legacy.parent.mkdir(parents=True)
        self.write_cli(legacy, '0.156.1')
        self.managed = self.bin / 'codex'
        self.select_version('0.156.1')
        tmux = self.root / 'tmux'
        tmux.write_text('''#!/usr/bin/env python3
import json, os, subprocess, sys
args = sys.argv[1:]
with open(os.environ['TEST_TMUX_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
if 'has-session' in args:
    sys.exit(0 if os.environ['TEST_TMUX_EXISTS'] == '1' else 1)
assert 'new-session' in args and '-A' in args, args
if os.environ['TEST_TMUX_EXISTS'] == '1':
    print('attached-existing-session')
    sys.exit(0)
work = args.index('-c')
sys.exit(subprocess.run(args[work + 2:], cwd=args[work + 1]).returncode)
''')
        tmux.chmod(0o755)
        # Map only host executables into the fixture; preserve the launcher's decisions.
        script = (HERE / 'owner-terminal-shell').read_text()
        self.shell = self.root / 'owner-terminal-shell'
        self.shell.write_text(script.replace('/usr/bin/tmux', str(tmux))
                             .replace('/usr/local/bin/codex', str(self.managed)))
        self.env = {
            'HOME': str(self.home), 'CODEX_HOME': str(self.codex_home),
            'PATH': f'{legacy.parent}:{os.environ["PATH"]}',
            'OWNER_TERMINAL_TMUX_SOCKET': str(self.root / 'tmux.sock'),
            'TEST_TMUX_LOG': str(self.root / 'tmux.log'), 'TEST_TMUX_EXISTS': '0',
        }

    def tearDown(self):
        self.socket.close()
        self.temporary.cleanup()

    def write_cli(self, file, version):
        file.write_text('#!/usr/bin/env python3\nimport json, os, sys\n'
                        f'print(json.dumps({{"version": {version!r}, "args": sys.argv[1:], '
                        '"home": os.environ["HOME"], "codexHome": os.environ.get("CODEX_HOME"), '
                        '"cwd": os.getcwd()}))\n')
        file.chmod(0o755)

    def select_version(self, version):
        binary = self.root / f'codex-{version}'
        self.write_cli(binary, version)
        next_link = self.bin / 'codex.next'
        next_link.symlink_to(binary)
        next_link.replace(self.managed)

    def launch(self, kind):
        return subprocess.run(['bash', str(self.shell), kind, 'fixture'], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def test_home_and_development_follow_managed_update_preserving_owner_state(self):
        for version in ('0.156.1', '0.157.1'):
            self.select_version(version)
            for kind in ('codex', 'helena-dev-codex'):
                with self.subTest(version=version, kind=kind):
                    result = self.launch(kind)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    actual = json.loads(result.stdout)
                    self.assertEqual(actual['version'], version)
                    self.assertEqual(actual['args'], ['resume', '--last'])
                    self.assertEqual(actual['home'], str(self.home))
                    self.assertEqual(actual['codexHome'], str(self.codex_home))
                    self.assertEqual(actual['cwd'], str(self.home if kind == 'codex'
                                                       else self.home / 'volition/plan'))
                    self.assertEqual(self.history.read_text(), 'synthetic existing conversation\n')

    def test_existing_sessions_are_attached_without_restarting_the_cli(self):
        self.env['TEST_TMUX_EXISTS'] = '1'
        self.managed.unlink()
        for kind in ('codex', 'helena-dev-codex'):
            with self.subTest(kind=kind):
                result = self.launch(kind)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), 'attached-existing-session')
        calls = [json.loads(line) for line in (self.root / 'tmux.log').read_text().splitlines()]
        self.assertEqual(len(calls), 4)
        self.assertTrue(all('has-session' in call or 'new-session' in call for call in calls))
        self.assertEqual(self.history.read_text(), 'synthetic existing conversation\n')

    def test_missing_managed_cli_does_not_fall_back_to_an_unmanaged_old_copy(self):
        self.managed.unlink()
        for kind in ('codex', 'helena-dev-codex'):
            with self.subTest(kind=kind):
                result = self.launch(kind)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('0.156.1', result.stdout)


if __name__ == '__main__':
    unittest.main()
