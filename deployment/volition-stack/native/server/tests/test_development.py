import concurrent.futures
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'hostd'))
from helena_host.common import Host, CommandResult
from helena_host.service import Dispatcher
from helena_host.varlink import VarlinkError


class Development(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.work = self.temp.name
        self.tasks = os.path.join(self.work, 'codex-tasks')
        os.mkdir(self.tasks)
        self.calls = []
        def run(argv, **kwargs):
            self.calls.append(argv)
            if argv[0] == 'ps':
                return CommandResult(0, f' 123 node codex exec -o {self.tasks}/164-last.md\n', '')
            return CommandResult(0, 'a' * 40 + '\n', '')
        config = SimpleNamespace(state_dir=self.work, data={'development': {'workDir': self.work}})
        self.dispatch = Dispatcher(Host(run=run), config, lambda _: None)
        self.caller = {'uid': 1000, 'name': 'volition-plan'}

    def tearDown(self):
        self.temp.cleanup()

    def call(self, method, **params):
        if method == 'DevelopmentEnqueue' and isinstance(params.get('body'), str):
            params['body'] = {'text': params['body']}
        return self.dispatch(method, params, self.caller)['result']

    def enqueue(self, **overrides):
        return self.call('DevelopmentEnqueue', **dict(name='api-fix', body='# Auftrag\nBasis hub/rel-12', model='gpt-6.1-sol', effort='high', **overrides))

    def test_enqueue_numbering_and_concurrency(self):
        with open(os.path.join(self.tasks, '164-bericht.md'), 'w') as handle:
            handle.write('Bericht')
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.enqueue(), range(8)))
        self.assertEqual(sorted(row['number'] for row in results), list(range(165, 173)))
        with open(os.path.join(self.tasks, 'queue.txt')) as handle:
            self.assertEqual(len(handle.read().splitlines()), 8)
        with open(os.path.join(self.tasks, results[0]['file'])) as handle:
            self.assertTrue(handle.read().startswith('Modell: gpt-6.1-sol\nDenktiefe: high\n'))

    def test_path_model_and_name_validation(self):
        for name in ('../outside', '/tmp/file', 'a\nb', 'a.md', 'a;echo', 'A', 'x' * 65):
            with self.assertRaises(VarlinkError):
                self.call('DevelopmentEnqueue', name=name, body='Task', model='gpt-6.1-sol', effort='high')
        for params in ({'number': 0}, {'number': -1}, {'number': '../x'}, {'number': True}):
            with self.assertRaises(VarlinkError):
                self.call('DevelopmentReport', **params)
        with self.assertRaises(VarlinkError):
            self.call('DevelopmentEnqueue', name='ok', body='Task', model='bad', effort='high')

    def test_symlinks_hardlinks_and_directories_fail(self):
        outside = os.path.join(self.work, 'outside')
        with open(outside, 'w') as handle:
            handle.write('untouched')
        for mode in ('symlink', 'hardlink', 'directory'):
            target = os.path.join(self.tasks, 'queue.txt')
            if mode == 'symlink':
                os.symlink(outside, target)
            elif mode == 'hardlink':
                os.link(outside, target)
            else:
                os.mkdir(target)
            with self.assertRaises(VarlinkError):
                self.enqueue()
            os.rmdir(target) if mode == 'directory' else os.unlink(target)
        os.symlink(outside, os.path.join(self.tasks, '164-bericht.md'))
        with self.assertRaises(VarlinkError):
            self.call('DevelopmentReport', number=164)
        with open(outside) as handle:
            self.assertEqual(handle.read(), 'untouched')

    def test_spool_directory_links_fail(self):
        real = self.tasks + '-real'
        os.rename(self.tasks, real)
        os.symlink(real, self.tasks)
        with self.assertRaises(VarlinkError):
            self.call('DevelopmentStatus')

    def test_task_content_and_effort_boundaries(self):
        for body in ('', '   ', '\x00', 'x' * 32001):
            with self.assertRaises(VarlinkError):
                self.call('DevelopmentEnqueue', name='ok', body=body, model='gpt-6.1-sol', effort='high')
        with self.assertRaises(VarlinkError):
            self.call('DevelopmentEnqueue', name='ok', body='Task', model='gpt-6.1-sol', effort='bad')
        result = self.call('DevelopmentEnqueue', name='x' * 64, body='x' * 32000, model='gpt-6.1-sol', effort='high')
        self.assertEqual(result['number'], 1)

    def test_status_reports_and_release_are_bounded(self):
        self.enqueue()
        with open(os.path.join(self.tasks, '164-bericht.md'), 'w') as handle:
            handle.write('Done')
        self.assertEqual(self.call('DevelopmentReport', number=164)['content'], 'Done')
        with self.assertRaises(VarlinkError):
            self.call('DevelopmentReport', number=163)
        status = self.call('DevelopmentStatus')
        self.assertEqual(status['running'], [{'pid': 123, 'number': 164}])
        self.assertEqual(len(status['queue']), 1)
        with open(os.path.join(self.work, 'api-full.log'), 'w') as handle:
            handle.write('unrelated sensitive output\n 42 pass\n 0 fail\n')
        release = self.call('DevelopmentRelease')
        self.assertEqual(release['liveSha'], 'a' * 40)
        self.assertEqual(release['gates'][0]['summary'], [' 42 pass', ' 0 fail'])
