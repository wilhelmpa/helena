import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'hostd'))
from helena_host import model_server as m
from helena_host.common import HostError
import test_model_server as base

OLD = base.OLD

PAIR = {'server': 'lemonade', 'slug': 'local', 'model': 'Qwen3.8-27B-GGUF',
        'profile': 'local-27b-npu', 'npu': 'qwen3.5:4b'}


class NpuProfileTest(unittest.TestCase):
    step = base.ModelServerTest.step
    finish = base.ModelServerTest.finish
    def setUp(self):
        base.ModelServerTest.setUp(self)
        self.set_memory(50)
        p = Path(self.host.path('/var/lib/volition-npu/installed.json'))
        p.parent.mkdir(parents=True)
        p.write_text(json.dumps({'models': [{'name': model} for model in (*m.NPU_MODELS, 'embed-gemma:300m')]}))

    def set_memory(self, available, locked=0):
        p = Path(self.host.path('/proc/meminfo'))
        p.parent.mkdir(exist_ok=True)
        p.write_text(f'MemTotal: {128 * 1024**2} kB\nMemAvailable: {available * 1024**2} kB\nMlocked: {locked * 1024**2} kB\n')

    def begin_pair(self):
        return m.switch(self.host, {'id': 'one', 'action': 'begin', 'target': PAIR, 'previous': OLD}, self.driver)

    def test_memory_4b_2b_and_rejection(self):
        self.assertEqual(m.select_npu(self.host, OLD), 'qwen3.5:4b')
        self.set_memory(46)
        self.assertEqual(m.select_npu(self.host, OLD), 'qwen3.5:2b')
        self.set_memory(44)
        with self.assertRaises(HostError):
            self.begin_pair()
        self.assertIsNone(m.state(self.host)['operation'])
        self.set_memory(5, 72)
        self.assertEqual(m.select_npu(self.host, OLD), 'qwen3.5:4b')

    def test_pair_commit_retry_and_halogen_rollback(self):
        self.set_memory(46)
        self.assertEqual(self.begin_pair()['operation']['target']['npu'], 'qwen3.5:2b')
        self.assertEqual(self.begin_pair()['operation']['target']['npu'], 'qwen3.5:2b')
        done = self.finish()
        self.assertEqual(done['active']['npu'], 'qwen3.5:2b')
        self.assertTrue(m.may_start(self.host, m.NPU_UNIT))
        self.step('rollback')
        self.assertEqual(self.finish()['active'], OLD)
        self.assertFalse(m.may_start(self.host, m.NPU_UNIT))

    def test_pair_failure_restores_gpu(self):
        self.begin_pair()
        self.driver.fail = 'probe'
        done = self.finish()
        self.assertEqual(done['active'], OLD)
        self.assertFalse(m.may_start(self.host, m.NPU_UNIT))

    def test_large_models_and_invalid_pair_rejected(self):
        for model in ('qwen3.5:9b', 'qwen3.6-moe:35b-a3b'):
            with self.assertRaises(HostError):
                m.validate_target({**PAIR, 'npu': model})
        with self.assertRaises(HostError):
            m.validate_target({**PAIR, 'server': 'halogen'})

    def test_runtime_memory_recheck(self):
        self.set_memory(13)
        driver = m.Driver(self.host)
        with patch.object(driver, 'ctl') as ctl, self.assertRaises(HostError):
            driver.perform('start', PAIR, {'operation': {}})
        ctl.assert_not_called()
        with patch.object(driver, 'ctl') as ctl, patch.object(driver, 'http', return_value={'choices': [{'message': {'tool_calls': [{'function': {'name': 'volition_probe', 'arguments': '{"ok":true}'}}]}}]}), self.assertRaises(HostError):
            driver.perform('probe', PAIR, {'operation': {}})
        self.assertEqual(ctl.call_args.args, ('stop', m.NPU_UNIT))

    def test_stop_npu_before_gpu_and_unit_isolation(self):
        driver = m.Driver(self.host)
        with patch.object(driver, 'ctl') as ctl:
            driver.perform('stop', PAIR, {'operation': {'previous': OLD}})
        self.assertEqual(ctl.call_args_list[0].args, ('stop', *m.NPU_SOCKETS, m.NPU_UNIT))
        unit = (Path(__file__).resolve().parents[2] / 'local-ai/systemd/volition-npu.service').read_text()
        for text in ('InaccessiblePaths=-/dev/kfd -/dev/dri', 'DevicePolicy=closed',
                     'DeviceAllow=/dev/accel/accel0 rw', 'MemorySwapMax=0', 'MemoryMax=8G'):
            self.assertIn(text, unit)
        self.assertNotIn('DeviceAllow=/dev/kfd', unit)


if __name__ == '__main__':
    unittest.main()
