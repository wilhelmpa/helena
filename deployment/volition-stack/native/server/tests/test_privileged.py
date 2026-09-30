import json
import os
import sys
import subprocess
import tempfile
import threading
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'hostd'))
from helena_host.common import Host, CommandResult, run_command
from helena_host.service import Dispatcher
from helena_host.varlink import VarlinkError


class RootCommands(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.calls = []
        self.started = threading.Event()
        self.stopped = threading.Event()
        self.block = False
        def run(argv, **kwargs):
            self.calls.append((argv, kwargs))
            if argv[0] == 'systemctl':
                self.stopped.set()
                return CommandResult(0, '', '')
            self.started.set()
            if self.block:
                self.stopped.wait(5)
            return CommandResult(0, '0\n', '')
        self.dispatch = Dispatcher(Host(run=run), SimpleNamespace(state_dir=self.temp.name), lambda _: None)
        self.caller = {'uid': 1000, 'name': 'volition-plan'}

    def tearDown(self):
        self.temp.cleanup()

    def call(self, name, **params):
        return self.dispatch(name, params, self.caller)['result']

    def run_command(self):
        return self.call('RunPrivileged', id='a' * 32, command='id -u', seconds=30, epoch=0, actor='agent:1;chat:2')

    def test_unrestricted_defaults_and_legacy_settings(self):
        self.assertTrue(self.call('RootSettings')['unrestricted'])
        with open(os.path.join(self.temp.name, 'volition-root.json'), 'w') as handle:
            json.dump({'enabled': True, 'directOnly': False, 'epoch': 1, 'units': {}, 'completed': {}}, handle)
        self.assertTrue(self.call('RootSettings')['unrestricted'])
        changed = self.call('SetRootSettings', enabled=True, directOnly=False, unrestricted=False)
        self.assertFalse(changed['unrestricted'])
        self.assertEqual(changed['epoch'], 2)

    def test_unit_limits_result_and_replay(self):
        result = self.run_command()
        self.assertEqual(result['output'], '0\n')
        argv, kwargs = self.calls[0]
        self.assertIn('--property=RuntimeMaxSec=30', argv)
        self.assertIn('--property=KillMode=control-group', argv)
        self.assertEqual(kwargs['output_limit'], 65536)
        self.assertEqual(result['exitCode'], 0)
        with self.assertRaises(VarlinkError):
            self.run_command()
        logs = [p for p in os.listdir(self.temp.name) if 'audit' in p]
        self.assertTrue(logs)
        with open(os.path.join(self.temp.name, logs[0])) as log:
            self.assertIn('RunPrivileged', log.read())

    def test_revoke_running_call_stops_only_owned_unit(self):
        self.block = True
        worker = threading.Thread(target=self.run_command)
        worker.start()
        self.assertTrue(self.started.wait(2))
        state = self.call('SetRootSettings', enabled=False, directOnly=True)
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(state['epoch'], 1)
        stopped = [argv[2] for argv, _ in self.calls if argv[0] == 'systemctl']
        self.assertTrue(stopped)
        self.assertEqual(set(stopped), {'volition-root-' + 'a' * 32 + '.service'})
        with self.assertRaises(VarlinkError):
            self.run_command()

    def test_unprivileged_timeout_keeps_partial_output(self):
        with self.assertRaises(subprocess.TimeoutExpired) as failed:
            run_command([sys.executable, '-c', 'import time; print("started", flush=True); time.sleep(2)'], timeout=0.2, output_limit=1024)
        self.assertIn(b'started', failed.exception.output)

    def test_actual_unprivileged_output_is_bounded(self):
        result = run_command([sys.executable, '-c', 'print("x" * 200000)'], output_limit=1024)
        self.assertEqual(len(result.stdout), 1024)
        self.assertEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
