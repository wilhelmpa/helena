import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('mail-triage-claim-recover.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class Recovery(unittest.TestCase):
    def setUp(self):
        self.runtime = {'version': 1, 'machineId': 'a' * 32, 'bootId': 'b' * 36,
                        'pid': 123, 'startTicks': '400', 'pidNamespace': 'pid:[1]',
                        'databaseRuntimeName': 'helena-123-' + 'c' * 36}
        self.files = {'/etc/machine-id': 'a' * 32,
                      '/proc/sys/kernel/random/boot_id': 'b' * 36,
                      '/proc/123/stat': '123 (synthetic name) ' + ' '.join(['0'] * 19 + ['400'])}

    def read(self, path):
        if path not in self.files:
            raise FileNotFoundError()
        return self.files[path]

    def proof(self, namespace='pid:[1]'):
        return recovery.dead_runtime(self.runtime, self.read, lambda _: namespace)

    def test_live_exact_process_never_released(self):
        with self.assertRaises(RuntimeError):
            self.proof()

    def test_previous_boot_and_pid_reuse_are_distinct_end_proofs(self):
        self.files['/proc/123/stat'] = self.files['/proc/123/stat'][:-3] + '401'
        self.assertEqual(self.proof(), 'different-process-start')
        self.files['/proc/sys/kernel/random/boot_id'] = 'd' * 36
        self.assertEqual(self.proof(namespace='pid:[2]'), 'previous-boot')

    def test_absence_is_only_accepted_on_same_machine_and_namespace(self):
        del self.files['/proc/123/stat']
        self.assertEqual(self.proof(), 'process-absent')
        with self.assertRaises(RuntimeError):
            self.proof(namespace='pid:[2]')
        self.files['/etc/machine-id'] = 'f' * 32
        with self.assertRaises(RuntimeError):
            self.proof()

    def test_permission_errors_never_count_as_process_absence(self):
        def denied(path):
            if path == '/proc/123/stat':
                raise PermissionError()
            return self.read(path)
        with self.assertRaises(PermissionError):
            recovery.dead_runtime(self.runtime, denied, lambda _: 'pid:[1]')


if __name__ == '__main__':
    unittest.main()
