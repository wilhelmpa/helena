"""deploy.sh end to end against a fixture: a git repository standing in for the live checkout,
stubs for systemctl, curl and runuser, and the release/state folders in a temporary directory.
It runs as root in a user and mount namespace of its own (unshare -rm), with the system folders it
installs into laid over by folders of the fixture, so nothing on the host is touched.

What it proves: a deployment that passes writes the marker; one whose checks fail, or whose
migration fails, rolls back to the last good commit (checkout, marker, previous web release)
and exits 2; the rolled-back commit is refused next time without --retry; --expect refuses a
different commit before anything changes; --no-rollback leaves the failed state for a person;
after the checkout the deploy.sh of the commit now checked out takes over (forward and back),
so a release that changes deploy.sh and removes what the old one installed deploys cleanly.

deploy.sh is part of the fixture, as on a server: it runs from the fixture's checkout.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

DEPLOY = Path(__file__).resolve().parents[1] / 'deploy.sh'
NATIVE = 'deployment/volition-stack/native'


def userns_available():
    if not shutil.which('unshare'):
        return False
    return subprocess.run(['unshare', '-rm', 'true'], capture_output=True).returncode == 0


@unittest.skipUnless(userns_available(), 'needs unprivileged user namespaces (unshare -r)')
class DeployRollbackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='helena-deploy-rollback-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.live = self.root / 'live'
        self.state = self.root / 'state'
        self.releases = self.root / 'releases'
        self.log = self.root / 'log'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.releases.mkdir()
        self.live.mkdir()
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Deploy fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        # The scripts deploy.sh runs from the checkout, as stubs that only say they ran.
        for script in ('vault-setup.sh', 'files-documents.sh', 'isolation.sh'):
            self.write(f'{NATIVE}/{script}', '#!/bin/bash\necho "' + script + ' $*" >> "$TEST_LOG"\n', 0o755)
        # A web release: a folder named after the commit, `current` pointing at it.
        self.write(f'{NATIVE}/web-release.sh', '#!/bin/bash\nset -e\n'
                   'c=$(git -C "$HELENA_DEPLOY_LIVE" rev-parse --short=12 HEAD)\n'
                   '[[ -z ${TEST_FAIL_BUILD:-} || $c != ${TEST_FAIL_BUILD:0:12} ]] || exit 7\n'
                   'mkdir -p "$HELENA_WEB_RELEASES/r-$c"\n'
                   'ln -sfn "$HELENA_WEB_RELEASES/r-$c" "$HELENA_WEB_RELEASES/current"\n'
                   'echo "web-release $*" >> "$TEST_LOG"\n', 0o755)
        # What the deploy.sh of this repository installs when it changes, as on a server.
        self.write(f'{NATIVE}/browser-restore/volition-browser-restore', '#!/bin/sh\n', 0o755)
        self.write(f'{NATIVE}/browser-restore/volition-project-browser-restore.service', '[Unit]\n')
        self.write(f'{NATIVE}/deploy.sh', DEPLOY.read_text(), 0o755)
        self.write('apps/web/page.tsx', 'v1\n')
        self.write('apps/api/src/app.ts', 'v1\n')
        self.good = self.commit()
        self.stub('systemctl', '''
echo "systemctl $*" >> "$TEST_LOG"
if [[ $1 == start && $2 == volition-plan-migrate.service && -n ${TEST_FAIL_MIGRATE:-} ]]; then
  [[ $(git -C "$HELENA_DEPLOY_LIVE" rev-parse HEAD) == "$TEST_FAIL_MIGRATE" ]] && exit 5
fi
[[ $1 == is-active && $* == *bootstrap* ]] && exit 3
exit 0''')
        self.stub('curl', '''
head=$(git -C "$HELENA_DEPLOY_LIVE" rev-parse HEAD)
[[ -n ${TEST_BAD:-} && $head == "$TEST_BAD" ]] && exit 22
exit 0''')
        self.stub('runuser', '''
while [[ $1 == -* ]]; do case $1 in -u) shift 2 ;; *) shift ;; esac; done
exec "$@"''')
        # A first release of the good commit, as a server has it.
        (self.releases / 'r-first').mkdir()
        (self.releases / 'current').symlink_to(self.releases / 'r-first')
        self.state.mkdir()
        (self.state / 'deployed').write_text(self.good + '\n')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.live), *args], text=True,
                                       stderr=subprocess.PIPE).strip()

    def write(self, path, text, mode=0o644):
        target = self.live / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        target.chmod(mode)

    def commit(self, message='fixture'):
        self.git('add', '--all')
        self.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', message)
        return self.git('rev-parse', 'HEAD')

    def stub(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/bash\n' + body.strip() + '\n')
        path.chmod(0o755)

    def candidate(self, *paths, deploy=None, remove=()):
        branch_head = self.git('rev-parse', 'HEAD')
        self.git('checkout', '-q', '-b', 'candidate')
        for path in paths:
            self.write(path, 'v2\n')
        if deploy is not None:
            self.write(f'{NATIVE}/deploy.sh', deploy, 0o755)
        for path in remove:
            shutil.rmtree(self.live / path)
        target = self.commit('candidate')
        self.git('checkout', '-q', 'main')
        self.assertEqual(self.git('rev-parse', 'HEAD'), branch_head)
        return target

    def deploy(self, *args, **env):
        environment = {
            **os.environ,
            'PATH': f'{self.bin}:{os.environ["PATH"]}',
            'HELENA_DEPLOY_LIVE': str(self.live),
            'HELENA_DEPLOY_STATE': str(self.state),
            'HELENA_WEB_RELEASES': str(self.releases),
            'HELENA_DEPLOY_BROWSER_SMOKE': '0',
            'TEST_LOG': str(self.log),
            'GIT_CONFIG_COUNT': '1',
            'GIT_CONFIG_KEY_0': 'safe.directory',
            'GIT_CONFIG_VALUE_0': '*',
            **env,
        }
        script = self.live / NATIVE / 'deploy.sh'
        # What deploy.sh installs into the system goes to folders of the fixture: a mount
        # namespace of its own lays them over the real ones.
        binds = []
        for target in ('/usr/local/libexec', '/etc/systemd/system'):
            stand_in = self.root / 'system' / target.strip('/')
            stand_in.mkdir(parents=True, exist_ok=True)
            binds.append(f'mount --bind {stand_in} {target}')
        wrapper = ' && '.join(binds) + ' && exec bash "$@"'
        return subprocess.run(['unshare', '-rm', 'bash', '-c', wrapper, 'deploy',
                               str(script), '--allow-inflight', *args],
                              text=True, capture_output=True, env=environment, timeout=120)

    def marker(self):
        return (self.state / 'deployed').read_text().strip()

    def current(self):
        return os.readlink(self.releases / 'current')

    def test_a_passing_deployment_writes_the_marker(self):
        target = self.candidate('apps/web/page.tsx')
        result = self.deploy('candidate')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), target)
        self.assertEqual(self.marker(), target)
        self.assertTrue(self.current().endswith('r-' + target[:12]))

    def test_failed_checks_roll_back_code_marker_and_web_release(self):
        target = self.candidate('apps/web/page.tsx', 'apps/api/src/app.ts')
        result = self.deploy('candidate', TEST_BAD=target)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('rolling back to ' + self.good, result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.good)
        self.assertEqual(self.git('status', '--porcelain', '--untracked-files=no'), '')
        self.assertEqual(self.marker(), self.good)
        self.assertEqual(self.current(), str(self.releases / 'r-first'))
        self.assertIn(target, (self.state / 'rolled-back').read_text().split())
        # The way back restarted what the failed deployment restarted.
        self.assertIn('systemctl restart', self.log.read_text())
        # The same commit is refused until it is fixed or retried on purpose.
        again = self.deploy('candidate')
        self.assertEqual(again.returncode, 1)
        self.assertIn('was rolled back before', again.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.good)

    def test_a_failed_migration_rolls_back(self):
        target = self.candidate('packages/db/drizzle/0999_x.sql', 'apps/api/src/app.ts')
        result = self.deploy('candidate', TEST_FAIL_MIGRATE=target)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.good)
        self.assertEqual(self.marker(), self.good)
        self.assertIn('the database keeps them', result.stdout)

    def test_a_failed_web_build_rolls_back_without_touching_the_release(self):
        target = self.candidate('apps/web/page.tsx')
        result = self.deploy('candidate', TEST_FAIL_BUILD=target)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.good)
        self.assertEqual(self.current(), str(self.releases / 'r-first'))

    def test_expect_refuses_another_commit_before_anything_changes(self):
        self.candidate('apps/api/src/app.ts')
        result = self.deploy('--expect', 'f' * 40, 'candidate')
        self.assertEqual(result.returncode, 1)
        self.assertIn('not the expected', result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.good)
        self.assertFalse(self.log.exists())

    def test_no_rollback_leaves_the_failed_state(self):
        target = self.candidate('apps/api/src/app.ts')
        result = self.deploy('--no-rollback', 'candidate', TEST_BAD=target)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), target)
        self.assertEqual(self.marker(), self.good)

    # A deploy.sh with one more step, as a release that adds a deployment step has it.
    def new_deploy(self, takes_over=True):
        text = DEPLOY.read_text()
        anchor = '"$live/deployment/volition-stack/native/vault-setup.sh"\n'
        self.assertEqual(text.count(anchor), 1)
        text = text.replace(anchor, anchor + 'echo "step of the new deploy.sh" >> "$TEST_LOG"\n')
        if not takes_over:
            text = text.replace('# helena-deploy: continues-in-target v1\n', '')
        return text

    def test_the_new_deploy_script_runs_the_new_steps_and_the_old_ones_are_gone(self):
        target = self.candidate('apps/api/src/app.ts', deploy=self.new_deploy(),
                                remove=[f'{NATIVE}/browser-restore'])
        result = self.deploy('candidate')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('continuing with the deploy.sh of ' + target, result.stdout)
        self.assertEqual(self.log.read_text().count('step of the new deploy.sh'), 1)
        self.assertNotIn('stat', result.stderr)
        self.assertEqual(self.marker(), target)

    def test_the_way_back_runs_in_the_deploy_script_of_the_good_commit(self):
        target = self.candidate('apps/api/src/app.ts', deploy=self.new_deploy(),
                                remove=[f'{NATIVE}/browser-restore'])
        result = self.deploy('candidate', TEST_BAD=target)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('continuing with the deploy.sh of ' + self.good, result.stdout)
        # The new step ran on the way there only.
        self.assertEqual(self.log.read_text().count('step of the new deploy.sh'), 1)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.good)
        self.assertEqual(self.marker(), self.good)
        self.assertTrue((self.live / NATIVE / 'browser-restore').is_dir())
        # The good commit's restore is installed again on the way back.
        self.assertTrue((self.root / 'system/usr/local/libexec/volition-browser-restore').exists())

    def test_a_deploy_script_that_cannot_take_over_leaves_missing_files_out(self):
        target = self.candidate('apps/api/src/app.ts', deploy=self.new_deploy(takes_over=False),
                                remove=[f'{NATIVE}/browser-restore'])
        result = self.deploy('candidate')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('cannot take over', result.stdout)
        self.assertIn('browser-restore/volition-browser-restore is not in this commit', result.stdout)
        self.assertNotIn('step of the new deploy.sh', self.log.read_text())
        self.assertEqual(self.marker(), target)


if __name__ == '__main__':
    unittest.main()
