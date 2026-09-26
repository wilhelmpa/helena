import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import unittest


DEPLOY = Path(os.environ.get(
    'DEPLOY_TEST_SOURCE', Path(__file__).resolve().parents[1] / 'deploy.sh',
)).read_text()


def section(pattern):
    match = re.search(pattern, DEPLOY, re.MULTILINE)
    if not match:
        raise AssertionError('Deployment decision block not found')
    return match.group(0)


CHANGED = section(r'^changed\(\).*')
API_CHANGED = (section(r'^api_runtime_changed\(\) \{\n[\s\S]*?^\}')
               if 'api_runtime_changed()' in DEPLOY else '')
RESTART = section(r'^if changed (?:apps/api )?apps/worker packages bun.lock[\s\S]*?^fi$')
AUDIT = section(r'^audit_script=.*\n[\s\S]*?^fi$') if 'audit_script=' in DEPLOY else ''


class DeployChangesTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='helena-deploy-diff-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Deploy fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        for path in [
            'apps/api/src/app.ts',
            'apps/api/src/modules/god/email-test.ts',
            'apps/api/src/modules/home/__tests__/unit/owner.test.ts',
            'apps/api/src/__tests__/helpers/app.ts',
            'apps/api/src/scripts/operator.test.ts',
            'apps/api/src/modules/home/__tests__/fixtures/sample.json',
            'apps/api/package.json',
            'apps/worker/src/main.ts',
            'packages/db/src/schema.ts',
            'bun.lock',
            'deployment/volition-stack/native/owner-terminal/owner-local-model.mjs',
            'deployment/volition-stack/native/hardening/audit.sh',
        ]:
            self.write(path, 'original fixture bytes\n')
        self.before = self.commit()

    def git(self, *args):
        return subprocess.check_output(
            ['git', '-C', str(self.repo), *args], text=True, stderr=subprocess.PIPE,
        ).strip()

    def write(self, path, content='updated fixture bytes\n'):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def commit(self):
        self.git('add', '--all')
        self.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def shell(self, body, after, environment=None):
        script = '\n'.join([
            'set -euo pipefail',
            'as_owner() { "$@"; }',
            'live=' + shlex.quote(str(self.repo)),
            'before=' + shlex.quote(self.before),
            'after=' + shlex.quote(after),
            CHANGED,
            API_CHANGED,
            body,
        ])
        return subprocess.check_output(
            ['bash', '-c', script], text=True, env=environment,
        ).strip()

    def restart_units(self):
        after = self.commit()
        return self.shell(
            'restart=()\n' + RESTART + '\nprintf "%s\\n" "${restart[@]-}"', after,
        ).splitlines()

    def assert_restart(self):
        self.assertEqual(self.restart_units(), [
            'volition-plan-api.service', 'volition-plan-worker.service',
        ])

    def test_api_test_changes_and_home_launcher_do_not_restart_api(self):
        for path in [
            'apps/api/src/modules/home/__tests__/unit/owner.test.ts',
            'apps/api/src/__tests__/helpers/app.ts',
            'apps/api/src/scripts/operator.test.ts',
            'apps/api/src/modules/home/__tests__/fixtures/sample.json',
            'apps/api/src/modules/home/__tests__/unit/new.test.ts',
            'deployment/volition-stack/native/owner-terminal/owner-local-model.mjs',
        ]:
            self.write(path)
        self.assertEqual(self.restart_units(), [])

    def test_production_change_restarts_api_and_worker(self):
        self.write('apps/api/src/app.ts')
        self.assert_restart()

    def test_mixed_test_and_production_change_restarts(self):
        self.write('apps/api/src/scripts/operator.test.ts')
        self.write('apps/api/src/modules/god/email-test.ts')
        self.assert_restart()

    def test_unknown_api_file_is_conservative(self):
        self.write('apps/api/new-test-config.json')
        self.assert_restart()

    def test_api_package_metadata_restarts(self):
        self.write('apps/api/package.json')
        self.assert_restart()

    def test_worker_packages_and_lockfile_remain_conservative(self):
        for path in ['apps/worker/src/test.test.ts', 'packages/db/test.test.ts', 'bun.lock']:
            with self.subTest(path=path):
                self.before = self.git('rev-parse', 'HEAD')
                self.write(path)
                self.assert_restart()

    def test_test_deletion_does_not_restart(self):
        (self.repo / 'apps/api/src/scripts/operator.test.ts').unlink()
        self.assertEqual(self.restart_units(), [])

    def test_production_deletion_restarts(self):
        (self.repo / 'apps/api/src/app.ts').unlink()
        self.assert_restart()

    def test_test_rename_does_not_restart(self):
        self.git('mv', 'apps/api/src/scripts/operator.test.ts',
                 'apps/api/src/scripts/renamed.test.ts')
        self.assertEqual(self.restart_units(), [])

    def test_production_renamed_into_test_directory_still_restarts(self):
        self.git('mv', 'apps/api/src/app.ts',
                 'apps/api/src/__tests__/previous-app.ts')
        self.assert_restart()

    def test_test_renamed_into_production_still_restarts(self):
        self.git('mv', 'apps/api/src/scripts/operator.test.ts',
                 'apps/api/src/scripts/operator.ts')
        self.assert_restart()

    def test_unknown_diff_failure_restarts_conservatively(self):
        self.assertEqual(self.shell(
            'restart=()\n' + RESTART + '\nprintf "%s\\n" "${restart[@]-}"',
            'missing-revision',
        ).splitlines(), ['volition-plan-api.service', 'volition-plan-worker.service'])

    def test_audit_refresh_only_updates_an_existing_copy(self):
        source = 'deployment/volition-stack/native/hardening/audit.sh'
        self.write(source, '#!/bin/bash\nexit 42\n')
        after = self.commit()
        target = self.root / 'installed-audit'
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        log = self.root / 'install.log'
        # The real install runs without Root-only owner flags inside this fixture.
        install = bin_dir / 'install'
        install.write_text(
            '#!/bin/bash\nset -eu\n'
            '[[ "$1 $2 $3 $4 $5 $6" == "-m 0755 -o root -g root" ]]\n'
            'printf "%s\\n" called >> "$INSTALL_LOG"\n'
            'shift 6\nexec /usr/bin/install -m 0755 "$@"\n'
        )
        install.chmod(0o755)
        systemctl = bin_dir / 'systemctl'
        systemctl.write_text('#!/bin/bash\nexit 99\n')
        systemctl.chmod(0o755)
        environment = {**os.environ, 'PATH': f'{bin_dir}:/usr/bin:/bin', 'INSTALL_LOG': str(log)}
        block = AUDIT.replace('/usr/local/libexec/helena-security-audit', shlex.quote(str(target)))
        self.shell(block, after, environment)
        self.assertFalse(target.exists())
        self.assertFalse(log.exists())
        target.write_text('previous audit\n')
        self.shell(block, self.before, environment)
        self.assertEqual(target.read_text(), 'previous audit\n')
        self.assertFalse(log.exists())
        self.shell(block, after, environment)
        self.assertEqual(target.read_bytes(), (self.repo / source).read_bytes())
        self.assertEqual(target.stat().st_mode & 0o777, 0o755)
        self.assertEqual(log.read_text(), 'called\n')


if __name__ == '__main__':
    unittest.main()
