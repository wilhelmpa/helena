import json
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'hostd'))
from helena_host.common import Host, CommandResult, HostError, atomic_write_json
from helena_host import development_jobs as jobs
from helena_host.service import Dispatcher


class DevelopmentJobs(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.work = self.temp.name
        os.mkdir(self.work + '/tmp')
        self.calls = []
        def run(argv, **kwargs):
            self.calls.append(argv)
            return CommandResult(0, 'a' * 40 + '\n', '')
        self.ctx = SimpleNamespace(host=Host(run=run, sleep=lambda _: None), config=SimpleNamespace(
            state_dir=self.work, data={'development': {'workDir': self.work, 'repo': self.work}}))

    def tearDown(self):
        self.temp.cleanup()

    def test_targeted_tests_migrate_the_private_database_and_enable_test_guards(self):
        self.ctx.config.data['development']['testDatabaseUrl'] = 'postgresql://volition@127.0.0.1:55474/volition_test'
        result = jobs.start(self.ctx, {'operation': 'tests', 'branch': 'hub/test',
            'expected': 'a' * 40, 'dryRun': False,
            'testFiles': ['apps/api/src/modules/model-schemas/service.test.ts']})
        jobs.execute(self.ctx, result['id'])
        commands = [argv for argv in self.calls if 'bun' in argv]
        migration = next(argv for argv in commands if 'packages/db/src/migrate.ts' in argv)
        tests = next(argv for argv in commands if 'test' in argv)
        self.assertIn('NODE_ENV=test', tests)
        self.assertIn('NODE_ENV=test', migration)
        self.assertIn('SKIP_PRE_MIGRATION_BACKUP=1', migration)
        self.assertLess(commands.index(migration), commands.index(tests))
        self.assertEqual(jobs.result(self.ctx, {'id': result['id']})['status'], 'success')

    def test_every_release_tool_has_a_side_effect_free_dry_run(self):
        for operation in ('gate', 'build', 'probe', 'deploy', 'verify'):
            result = jobs.start(self.ctx, {'operation': operation, 'branch': 'hub/test',
                'expected': 'a' * 40, 'dryRun': True, 'pauseHalogen': True, 'actor': 'agent:1'})
            self.assertEqual(result['status'], 'dry-run')
            self.assertTrue(result['steps'])
            self.assertFalse(any(a[0] in ('systemd-run', 'systemctl', 'runuser', 'bash', 'python3') for a in self.calls))

    def test_traversal_options_and_short_sha_fail_before_commands(self):
        for branch, expected in (('../live', 'a' * 40), ('--upload-pack=x', 'a' * 40), ('hub/test', 'abc')):
            with self.assertRaises(HostError):
                jobs.start(self.ctx, {'operation': 'deploy', 'branch': branch, 'expected': expected, 'dryRun': True})
        self.assertEqual(self.calls, [])

    def test_dry_gate_never_authorizes_real_deploy(self):
        jobs.start(self.ctx, {'operation': 'gate', 'branch': 'hub/test', 'expected': 'a' * 40, 'dryRun': True})
        with self.assertRaises(HostError):
            jobs.start(self.ctx, {'operation': 'deploy', 'branch': 'hub/test', 'expected': 'a' * 40, 'dryRun': False})
        self.assertFalse(any(a[0] == 'systemd-run' for a in self.calls))

    def test_main_switch_revokes_jobs_and_rejects_new_operations(self):
        with open(self.work + '/volition-root.json', 'w') as file:
            json.dump({'enabled': False, 'directOnly': False, 'epoch': 2, 'units': {}}, file)
        with self.assertRaises(HostError):
            jobs.start(self.ctx, {'operation': 'gate', 'branch': 'hub/test', 'expected': 'a' * 40, 'dryRun': True})

    def test_busy_agent_or_proxy_blocks_halogen_pause(self):
        self.ctx.host.run = lambda argv, **kw: CommandResult(0, '1\n', '')
        with self.assertRaises(HostError):
            jobs.quiet(self.ctx, pause=True)

    def test_unreviewed_release_and_wrong_commit_are_rejected(self):
        with self.assertRaises(HostError):
            jobs.start(self.ctx, {'operation': 'build', 'branch': 'hub/test', 'expected': 'a' * 40, 'dryRun': False})
        self.ctx.host.run = lambda argv, **kw: CommandResult(0, 'b' * 40 + '\n', '')
        with self.assertRaises(HostError):
            jobs.start(self.ctx, {'operation': 'gate', 'branch': 'hub/test', 'expected': 'a' * 40, 'dryRun': True})

    def test_real_job_failures_never_create_gate_evidence(self):
        value = jobs.start(self.ctx, {'operation': 'gate', 'branch': 'hub/test', 'expected': 'a' * 40, 'dryRun': False})
        def run(argv, **kwargs):
            if 'flock' in argv:
                return CommandResult(1, '7 pass\n1 fail\n', '')
            return CommandResult(0, 'a' * 40 + '\n', '')
        self.ctx.host.run = run
        failed = jobs.execute(self.ctx, value['id'])
        self.assertEqual(failed['status'], 'failed')
        with self.assertRaises(HostError):
            jobs.evidence(self.ctx, 'gate', 'a' * 40)
        with self.assertRaises(HostError):
            jobs.execute(self.ctx, value['id'])

    def test_failed_worker_start_records_failure_without_leaving_registered_units(self):
        def run(argv, **kwargs):
            return CommandResult(1 if argv[0] == 'systemd-run' else 0, 'a' * 40 + '\n', '')
        self.ctx.host.run = run
        with self.assertRaises(HostError):
            jobs.start(self.ctx, {'operation': 'gate', 'branch': 'hub/test', 'expected': 'a' * 40, 'dryRun': False})
        with open(self.work + '/volition-root.json') as file:
            self.assertEqual(json.load(file)['units'], {})
        records = os.listdir(self.work + '/volition-development')
        self.assertEqual(jobs.result(self.ctx, {'id': records[0][:-5]})['status'], 'failed')

    def test_deploy_requires_all_real_evidence_and_inflight_zero(self):
        for index, op in enumerate(('review', 'gate', 'build', 'probe'), 1):
            file = jobs.job_path(self.ctx, ('%032x' % index))
            atomic_write_json(file, {'operation': op, 'expected': 'a' * 40, 'status': 'success', 'dryRun': False, 'artifact': '/private/artifact'})
        value = jobs.start(self.ctx, {'operation': 'deploy', 'branch': 'hub/test', 'expected': 'a' * 40, 'dryRun': False})
        self.ctx.host.run = lambda argv, **kw: CommandResult(0, '1\n' if 'psql' in argv else 'a' * 40 + '\n', '')
        self.assertEqual(jobs.execute(self.ctx, value['id'])['status'], 'failed')
        self.assertFalse(any(a and a[0].endswith('/deploy.sh') for a in self.calls))

    def test_halogen_restores_service_order_on_build_failure(self):
        def run(argv, **kwargs):
            self.calls.append(argv)
            if 'psql' in argv:
                return CommandResult(0, '0\n', '')
            if argv[0] == 'curl':
                return CommandResult(0, json.dumps({'active': {'normal': 0}, 'queued': {'normal': 0}}), '')
            return CommandResult(0, '', '')
        self.ctx.host.run = run
        with self.assertRaises(HostError):
            with jobs.pause(self.ctx, True):
                raise HostError('CommandFailed', 'Synthetic build failure')
        units = [argv[1:] for argv in self.calls if argv[0] == 'systemctl' and argv[1] in ('stop', 'start')]
        self.assertEqual(units, [
            ['stop', 'helena-voice-tts-proxy.service'], ['stop', 'helena-voice-tts.service'], ['stop', 'helena-halogen.service'],
            ['start', 'helena-voice-tts-proxy.service'], ['start', 'helena-halogen.service'], ['start', 'helena-voice-tts.service'],
        ])

    def test_isolated_dry_run_chain_uses_real_spool_and_never_starts_live_commands(self):
        os.mkdir(self.work + '/codex-tasks')
        dispatch = Dispatcher(self.ctx.host, self.ctx.config, lambda _: None)
        caller = {'name': 'synthetic-home', 'uid': os.getuid()}
        def call(method, **parameters):
            return dispatch(method, dict(parameters, actor='agent:1'), caller)['result']
        task = call('DevelopmentEnqueue', name='probe', body={'text': 'Dry-run Codex fixture; no live work'}, model='gpt-6.1-sol', effort='xhigh')
        self.assertEqual(call('DevelopmentStatus')['queue'], [task['file']])
        with open(self.work + '/codex-tasks/%03d-bericht.md' % task['number'], 'w') as report:
            report.write('Codex fixture: dry-run task processed, no model or live command executed.')
        self.assertIn('Codex fixture', call('DevelopmentReport', number=task['number'])['content'])
        for method, extra in [('DevelopmentReview', {'evidence': 'Synthetic reviewer checked the report'}), ('DevelopmentGate', {}), ('DevelopmentBuild', {'pauseHalogen': True}), ('DevelopmentProbe', {}), ('DevelopmentDeploy', {'pauseHalogen': True}), ('DevelopmentVerify', {})]:
            result = call(method, branch='hub/test', expected='a' * 40, dryRun=True, **extra)
            self.assertEqual(result['status'], 'dry-run')
            self.assertEqual(call('DevelopmentJob', id=result['id'])['status'], 'dry-run')
        self.assertFalse(any(a[0] in ('systemd-run', 'systemctl', 'runuser') for a in self.calls))
        with open(self.work + '/audit.log') as log:
            entries = [json.loads(line) for line in log]
        self.assertTrue(all(row['actor'] == 'agent:1' and row['ok'] for row in entries))
        self.assertEqual(entries[-2]['method'], 'DevelopmentVerify')
