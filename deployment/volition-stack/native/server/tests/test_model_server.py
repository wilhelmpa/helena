import sys
import io
import json
from unittest.mock import patch
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'hostd'))
from helena_host import model_server as m
from helena_host.common import CommandResult, Host, file_lock, HostError

OLD = {'server': 'halogen', 'slug': 'halogen', 'model': 'Flash'}
NEW = {'server': 'lemonade', 'slug': 'local', 'model': 'Qwen27B'}


class Crash(BaseException):
    pass


class FakeDriver:
    def __init__(self):
        self.calls = []
        self.crash = None
        self.fail = None

    def snapshot(self):
        return ['helena-embed.service', 'helena-voice-stt-proxy.socket']

    def perform(self, phase, target, value):
        self.calls.append((phase, target['server']))
        if self.crash == value['operation']['phase']:
            self.crash = None
            raise Crash()
        if self.fail == value['operation']['phase']:
            self.fail = None
            raise RuntimeError('fake failure')


class ModelServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.host = Host(root=self.tmp.name, run=lambda args, **kw: CommandResult(
            0 if args[-1] == m.SERVERS['halogen'] else 1, '', ''))
        self.driver = FakeDriver()
        proc = Path(self.host.path('/proc'))
        proc.mkdir()
        (proc / 'meminfo').write_text(f'MemTotal: {128 * 1024**2} kB\nMemAvailable: {60 * 1024**2} kB\nMlocked: 0 kB\n')

    def begin(self):
        return m.switch(self.host, {'id': 'one', 'action': 'begin', 'target': NEW, 'previous': OLD}, self.driver)

    def step(self, action='advance'):
        phase = m.state(self.host)['operation']['phase']
        return m.switch(self.host, {'id': 'one', 'action': action, 'expected': phase, 'ack': phase}, self.driver)

    def finish(self):
        for _ in range(40):
            value = m.state(self.host)
            if value['operation']['phase'] in m.TERMINAL:
                return value
            self.step()
        self.fail('did not finish')

    def test_order_and_fences(self):
        self.begin()
        self.assertTrue(m.state(self.host)['admissionPaused'])
        with self.assertRaises(HostError):
            m.switch(self.host, {'id': 'two', 'action': 'begin', 'target': OLD, 'previous': OLD}, self.driver)
        unchanged = m.switch(self.host, {'id': 'one', 'expected': 'drain'}, self.driver)
        self.assertEqual(unchanged['operation']['phase'], 'drain')
        result = self.finish()
        self.assertEqual([x[0] for x in self.driver.calls], list(m.FORWARD[:-1]))
        self.assertEqual(result['active'], NEW)
        self.assertFalse(result['admissionPaused'])
        self.assertTrue(m.may_start(self.host, 'lemond.service'))
        self.assertFalse(m.may_start(self.host, 'helena-halogen.service'))
        self.assertEqual(self.step(), result)

    def test_crash_after_every_side_effect_resumes(self):
        for phase in m.FORWARD[:-1]:
            with self.subTest(phase=phase):
                self.setUp()
                self.begin()
                self.driver.crash = phase
                with self.assertRaises(Crash):
                    self.finish()
                value = m.state(self.host)
                self.assertEqual(value['operation']['phase'], phase)
                self.assertEqual(self.finish()['active'], NEW)

    def test_every_failure_restores_before_release(self):
        for phase in m.FORWARD[:-1]:
            with self.subTest(phase=phase):
                self.setUp()
                self.begin()
                self.driver.fail = phase
                value = self.finish()
                self.assertEqual(value['active'], OLD)
                self.assertEqual(value['operation']['phase'], 'rolled-back')
                self.assertEqual([x[0] for x in self.driver.calls[-9:]], ['pause', 'block-starts', 'stop', 'free-gpu', 'start', 'health', 'probe', 'commit', 'release'])
                self.assertTrue(all(server == 'halogen' for _, server in self.driver.calls[-9:]))

    def test_rollback_crash_every_phase_keeps_fence(self):
        for phase in m.REVERSE[:-1]:
            with self.subTest(phase=phase):
                self.setUp()
                self.begin()
                self.step('rollback')
                self.driver.crash = phase
                with self.assertRaises(Crash):
                    self.finish()
                value = self.finish()
                self.assertEqual(value['active'], OLD)
                self.assertEqual(value['operation']['phase'], 'rolled-back')

    def test_rollback_failure_retains_pause_and_retries(self):
        self.begin()
        self.step('rollback')
        self.driver.fail = 'rollback-probe'
        while m.state(self.host)['operation']['phase'] != 'rollback-probe':
            self.step()
        value = self.step()
        self.assertTrue(value['admissionPaused'])
        self.assertTrue(value['startsBlocked'])
        self.assertEqual(value['operation']['phase'], 'rollback-probe')
        self.assertEqual(self.finish()['active'], OLD)

    def test_one_shared_lock(self):
        with file_lock(m.paths(self.host)[1]):
            with self.assertRaises(HostError) as error:
                self.begin()
            self.assertEqual(error.exception.code, 'Busy')

    def test_halogen_health_reads_engine_response_and_rejects_unready_models(self):
        for payload, ready in [
            ({'status': 'ok', 'engine': {'responds': True}}, True),
            ({'status': 'ok', 'responds': True}, True),
            ({'status': 'ok', 'responds': True, 'engine': {'responds': False}}, False),
            ({'status': 'ok', 'engine': {'responds': False}}, False),
            ({'status': 'ok'}, False),
            ({'status': 'loading', 'engine': {'responds': True}}, False),
        ]:
            with self.subTest(payload=payload), patch.object(m.time, 'monotonic', side_effect=[0, 1000]):
                driver = m.Driver(self.host)
                driver.http = lambda *args: payload
                if ready:
                    driver.perform('health', OLD, {'operation': {}})
                else:
                    with self.assertRaises(HostError):
                        driver.perform('health', OLD, {'operation': {}})

    def test_reset_uses_active_server_and_invalidates_pending_checks(self):
        self.begin()
        self.finish()
        reset = m.reset_group(self.host, self.driver)
        self.assertEqual(reset['operation']['target'], NEW)
        self.assertTrue(reset['proxyPaused'])
        m.reset_group(self.host, self.driver)
        self.assertEqual(m.state(self.host)['operation']['phase'], 'rollback-pause')

    def test_system_driver_stops_both_servers_and_probes_before_release(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            code = int(args[1] == 'is-active' and args[-1] != m.SERVERS['halogen'])
            return CommandResult(code, '', '')
        self.host.run = run
        self.driver = m.Driver(self.host)
        def http(target, path, body=None):
            calls.append(['http', path])
            if path == '/health':
                return {'status': 'ok', 'responds': True}
            return {'choices': [{'message': {'tool_calls': [{'function': {
                'name': 'volition_probe', 'arguments': '{"ok": true}'}}]}}]}
        self.driver.http = http
        self.begin()
        with patch.object(m, 'urlopen', side_effect=lambda *a, **kw: io.BytesIO(json.dumps({
                'administrativePaused': True, 'active': {'normal': 0}}).encode())):
            self.finish()
        stopped = next(call for call in calls if call[:2] == ['systemctl', 'stop'])
        self.assertTrue(set(m.SERVERS.values()).issubset(stopped))
        self.assertTrue(set(m.COMPANIONS).issubset(stopped))
        started = [call for call in calls if call[:2] == ['systemctl', 'start']]
        self.assertEqual(started, [['systemctl', 'start', 'lemond.service']])
        self.assertLess(calls.index(stopped), calls.index(started[0]))
        self.assertLess(calls.index(['http', '/health']), calls.index(['http', '/chat/completions']))

    def test_boot_identity_uses_loaded_lemonade_model(self):
        self.host.run = lambda args, **kw: CommandResult(int(args[-1] != 'lemond.service'), '', '')
        driver = m.Driver(self.host)
        driver.http = lambda *args: {'model_loaded': 'Qwen27B'}
        self.assertEqual(m.initialize(self.host, driver)['active'], NEW)
        self.assertFalse(m.may_start(self.host, 'helena-halogen.service'))

    def test_corrupt_state_fails_closed(self):
        Path(m.paths(self.host)[0]).write_text('{')
        with self.assertRaises(HostError):
            m.may_start(self.host, 'lemond.service')


if __name__ == '__main__':
    unittest.main()
