import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

DEPLOY = Path(__file__).resolve().parents[1] / 'deploy.sh'
TEXT = DEPLOY.read_text()
PREFIX = TEXT[TEXT.index('after=$(as_owner'):TEXT.index('\nif changed bun.lock; then')]


class DeployOrderTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='helena-deploy-order-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Synthetic fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.write('original', 'old')
        self.before = self.commit()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        stub = self.bin / 'python3'
        stub.write_text('#!/bin/bash\nset -eu\n'
                        'git -C "$TEST_REPO" rev-parse HEAD > "$TEST_LOG"\n'
                        'printf "%s\\n" "$@" >> "$TEST_LOG"\n'
                        'exit "${TEST_REFUSE:-0}"\n')
        stub.chmod(0o755)
        self.log = self.root / 'log'

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args],
                                       text=True, stderr=subprocess.PIPE).strip()

    def write(self, path, text='new'):
        file = self.repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)

    def commit(self):
        self.git('add', '--all')
        self.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def run_prefix(self, changed, refuse=0):
        self.write(changed)
        target = self.commit()
        self.git('checkout', '-q', '--detach', self.before)
        script = self.root / 'deploy-prefix.sh'
        script.write_text('\n'.join([
            'set -euo pipefail', 'as_owner() { "$@"; }',
            'live=' + shlex.quote(str(self.repo)),
            'head=' + self.before, 'before=' + self.before, 'branch=' + target,
            # deploy.sh sets these before the prefix (options and the --continue re-exec).
            'continue_run=0', 'web_artifact=', 'rollback_to=', 'expect=', 'force_local_build=0',
            PREFIX,
        ]))
        result = subprocess.run(['bash', str(script)], text=True, capture_output=True, env={
            **os.environ, 'PATH': str(self.bin) + ':' + os.environ['PATH'],
            'TEST_REPO': str(self.repo), 'TEST_LOG': str(self.log), 'TEST_REFUSE': str(refuse),
        })
        return target, result

    def test_runner_target_drains_old_checkout_before_fast_forward(self):
        target, result = self.run_prefix('packages/runner/src/cli.ts')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text().splitlines()[0], self.before)
        self.assertIn('--target\n' + target, self.log.read_text())
        self.assertIn('--before\n' + self.before, self.log.read_text())
        self.assertEqual(self.git('rev-parse', 'HEAD'), target)

    def test_deadline_refusal_leaves_checkout_untouched(self):
        _, result = self.run_prefix('packages/runner/src/cli.ts', refuse=23)
        self.assertEqual(result.returncode, 23)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.before)

    def test_independent_browser_change_does_not_drain_runner(self):
        target, result = self.run_prefix('deployment/volition-stack/browser/router.mjs')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.log.exists())
        self.assertEqual(self.git('rev-parse', 'HEAD'), target)

    def test_mail_only_change_does_not_signal_runner(self):
        target, result = self.run_prefix('apps/api/src/modules/mail/history.ts')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.log.exists())
        self.assertEqual(self.git('rev-parse', 'HEAD'), target)

    def test_runner_unit_change_uses_same_guard(self):
        _, result = self.run_prefix('deployment/volition-stack/native/systemd/volition-hermes-runner.service', refuse=23)
        self.assertEqual(result.returncode, 23)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.before)

    def run_activation(self, healthy=True):
        start = TEXT.index('if $runner_affected; then\n  without_runner=')
        suffix = TEXT[start:TEXT.index('\n# Every service', start)]
        script = self.root / 'deploy-activation.sh'
        script.write_text('\n'.join([
            'set -euo pipefail',
            'runner_affected=true; after=synthetic; runner_drain=/synthetic/runner-drain.py',
            'restart=(volition-hermes-runner.service volition-plan-api.service volition-hermes-runner.service)',
            'systemctl() { printf \"systemctl %s\\n\" \"$*\"; }',
            'python3() { printf \"helper %s\\n\" \"$*\"; }',
            'curl() { echo health; return ' + ('0' if healthy else '23') + '; }',
            suffix,
        ]))
        return subprocess.run(['bash', str(script)], text=True, capture_output=True)

    def test_only_explicit_activation_starts_runner_after_api_readiness(self):
        result = self.run_activation()
        self.assertEqual(result.returncode, 0, result.stderr)
        actions = [line for line in result.stdout.splitlines() if line.startswith(('systemctl ', 'helper ', 'health'))]
        self.assertEqual(actions, ['systemctl restart volition-plan-api.service', 'health',
                                  'helper /synthetic/runner-drain.py ready --target synthetic',
                                  'helper /synthetic/runner-drain.py activate --target synthetic'])

    def test_api_probe_has_bounded_connect_attempt_and_total_retry_budget(self):
        start = TEXT.index('if $runner_affected; then\n  curl ')
        end = TEXT.index('\n  python3 "$runner_drain" ready', start)
        args = shlex.split(TEXT[start:end].split('then', 1)[1].replace('\\\n', ' '))
        def number(option):
            value = args[args.index(option) + 1]
            self.assertRegex(value, r'^\d+(?:\.\d+)?$')
            return float(value)
        connect = number('--connect-timeout')
        attempt = number('--max-time')
        retry_window = number('--retry-max-time')
        retries = number('--retry')
        delay = number('--retry-delay')
        self.assertGreater(connect, 0)
        self.assertLessEqual(connect, attempt)
        self.assertLessEqual(attempt, 5)
        self.assertGreater(retry_window, 0)
        self.assertLessEqual(retry_window + attempt, 35)
        # Even a peer that accepts TCP forever cannot outlive the finite attempts.
        self.assertLessEqual((retries + 1) * attempt + retries * delay, 35)

    def test_failed_api_health_leaves_runner_unactivated(self):
        result = self.run_activation(healthy=False)
        self.assertEqual(result.returncode, 23)
        self.assertNotIn('helper ', result.stdout)

    def test_bundled_agent_runtime_change_uses_same_guard(self):
        _, result = self.run_prefix('packages/agent-runtime/src/tools/builtin.ts', refuse=23)
        self.assertEqual(result.returncode, 23)
        self.assertTrue(self.log.exists())
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.before)

    def test_agent_runtime_change_rebuilds_the_installed_runner_bundle(self):
        self.write('packages/agent-runtime/src/tools/builtin.ts')
        target = self.git('rev-parse', 'HEAD')
        start = TEXT.index('runner_bundle=$live/packages/runner/dist/cli.js')
        stop = TEXT.index('\nif changed deployment/volition-stack/integration;', start)
        script = self.root / 'bundle-choice.sh'
        script.write_text('\n'.join([
            'set -euo pipefail',
            'live=' + shlex.quote(str(self.root)),
            'before=' + self.before + '; after=' + target,
            'rollback_to=; rollback_dir=' + shlex.quote(str(self.root / 'rollback')),
            'owner=synthetic',
            'changed() { ! git -C "$live" diff --quiet "$before" "$after" -- "$@"; }',
            'runuser() { mktemp --suffix=.js; }',
            'as_owner() { echo bundle-built; }',
            'install() { echo bundle-installed; }',
            TEXT[start:stop],
        ]))
        result = subprocess.run(['bash', str(script)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('bundle-built', result.stdout)
        self.assertIn('bundle-installed', result.stdout)

    def test_bundled_sdk_change_uses_same_guard(self):
        _, result = self.run_prefix('packages/sdk/src/index.ts', refuse=23)
        self.assertEqual(result.returncode, 23)
        self.assertTrue(self.log.exists())
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.before)


if __name__ == '__main__':
    unittest.main()
