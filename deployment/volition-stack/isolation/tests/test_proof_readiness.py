"""Proof fixtures, bounded CLI cleanup and GitHub SSH compatibility without live services."""

import asyncio
import contextlib
import io
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import Mock, patch

ISOLATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ISOLATION))
sys.path.insert(0, str(ISOLATION / 'proof'))
import egress
import harness
import proof_agent_env
import proof_function
from test_review_r2 import client_hello, reader_for


class ConnectPreambleTest(unittest.IsolatedAsyncioTestCase):
    async def test_github_ssh_443_accepts_only_bounded_ssh_and_preserves_remaining_bytes(self):
        banner = b'SSH-2.0-OpenSSH_9.2\r\n'
        reader = reader_for(banner + b'next-packet')
        self.assertEqual(await egress.checked_connect_preamble(reader, 'ssh.github.com'), banner)
        self.assertEqual(await reader.read(), b'next-packet')
        for invalid in (client_hello('ssh.github.com'), b'SSH-2.0-x\n', b'SSH-2.0-\r\n',
                        b'SSH-2.0-x\rBAD\r\n', b'SSH-2.0-x\x00\r\n', b'SSH-2.0-' + b'x' * 248 + b'\r\n'):
            with self.subTest(invalid=invalid[:16]), self.assertRaises(egress.HttpError):
                await egress.checked_connect_preamble(reader_for(invalid), 'ssh.github.com')

    async def test_other_hosts_keep_tls_sni_and_do_not_accept_ssh(self):
        hello = client_hello('example.com')
        self.assertEqual(await egress.checked_connect_preamble(reader_for(hello), 'example.com'), hello)
        for host in ('github.com', 'sub.ssh.github.com', 'ssh.github.com.attacker.test', 'example.com'):
            with self.subTest(host=host), self.assertRaises(egress.HttpError):
                await egress.checked_connect_preamble(reader_for(b'SSH-2.0-OpenSSH_9.2\r\n'), host)
        with self.assertRaises(egress.HttpError):
            await egress.checked_connect_preamble(reader_for(hello), 'other.test')

    async def test_ssh_destination_still_respects_domain_and_agent_policy(self):
        for policy, agent, reason in (({'mode': 'blocked'}, 1, 'blocked'),
                                      ({'mode': 'allowlist', 'allow': ['example.com']}, 1, 'not-allowlisted'),
                                      ({'mode': 'open', 'deny': ['github.com']}, 1, 'denylisted'),
                                      ({'mode': 'open', 'agents': {'1': 'blocked'}}, None, 'blocked')):
            self.assertEqual(egress.decide(policy, 'ssh.github.com', 443, agent), reason)


class ProofRuntimeTest(unittest.TestCase):
    def test_codex_resolves_installed_runtime_and_copies_platform_dependency(self):
        base = '/opt/helena/runtimes/codex/1.2.3/node_modules/@openai'
        with patch.object(os.path, 'realpath', return_value=f'{base}/codex/bin/codex.js'), \
             patch.object(os.path, 'isdir', side_effect=lambda path: path == f'{base}/codex-linux-x64'), \
             patch.object(os, 'uname', return_value=types.SimpleNamespace(machine='x86_64')), \
             patch.object(harness, 'require_trusted_path') as trusted, \
             patch.object(harness.shutil, 'copytree') as copy, patch.object(os, 'walk', return_value=[]):
            harness.copy_codex_runtime()
        self.assertEqual([call.args[0] for call in copy.call_args_list], [f'{base}/codex', f'{base}/codex-linux-x64'])
        self.assertEqual(len(trusted.call_args_list), 3)
        self.assertTrue(all(call.args[1].startswith(f'{harness.ROOT}/codex/node_modules/@openai/') for call in copy.call_args_list))

    def test_untrusted_codex_source_is_never_copied(self):
        with patch.object(os.path, 'realpath', return_value='/tmp/untrusted/codex/bin/codex.js'), \
             patch.object(harness, 'require_trusted_path', side_effect=SystemExit('untrusted')), \
             patch.object(harness.shutil, 'copytree') as copy:
            with self.assertRaises(SystemExit):
                harness.copy_codex_runtime()
            copy.assert_not_called()

    def test_cli_timeout_kills_child_holding_stdout_and_finishes_with_a_bound(self):
        program = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"]); print("started",flush=True); time.sleep(30)'
        process = subprocess.Popen([sys.executable, '-c', program], stdout=subprocess.PIPE, start_new_session=True)
        started = time.monotonic()
        output = proof_function.bounded_cli_output(process, ('401',), timeout=0.2, drain_timeout=0.2)
        self.assertLess(time.monotonic() - started, 2)
        self.assertIn(b'started', output)
        self.assertIsNotNone(process.poll())
        self.assertTrue(process.stdout.closed)

    def test_cli_drain_is_bounded_even_when_descendant_opens_another_session(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'child.pid'
            program = f'import subprocess,sys; p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"],start_new_session=True); open({str(marker)!r},"w").write(str(p.pid)); print("401 synthetic refusal",flush=True)'
            process = subprocess.Popen([sys.executable, '-c', program], stdout=subprocess.PIPE, start_new_session=True)
            started = time.monotonic()
            try:
                output = proof_function.bounded_cli_output(process, ('401',), timeout=1, drain_timeout=0.1)
                self.assertLess(time.monotonic() - started, 2)
                self.assertIn(b'401', output)
            finally:
                if marker.exists():
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(int(marker.read_text()), signal.SIGKILL)

    def test_clone_fixture_initialization_uses_project_sandbox_and_fails_early(self):
        probe = Mock(return_value={})
        client = Mock()
        sh = Mock()
        report = harness.Report()
        with contextlib.redirect_stdout(io.StringIO()):
            proof_agent_env.run_clone_proofs(report, probe, client, sh, harness.ROOT)
        probe.assert_called_once_with('alpha', 'alpha', [f'exec:git,init,-q,--bare,{harness.ROOT}/workspaces/projects/alpha/.proof-source.git'])
        sh.assert_not_called()
        client.assert_not_called()
        self.assertFalse(report.results[0]['ok'])


if __name__ == '__main__':
    unittest.main()
