import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gpu_watch', Path(__file__).with_name('watch.py'))
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)


class WatchTest(unittest.TestCase):
    def test_reset_delegates_to_shared_state_for_either_active_server(self):
        for server in ('halogen', 'lemonade'):
            with patch.object(watch.model_server, 'reset_group', return_value={
                'active': {'server': server}, 'operation': {'id': 'reset-one'}}) as reset:
                self.assertEqual(watch.restart_group(), ([], ['pending:reset-one']))
                reset.assert_called_once()

    def test_failure_never_starts_a_fallback_server(self):
        with patch.object(watch.model_server, 'reset_group', side_effect=RuntimeError):
            self.assertEqual(watch.restart_group(), ([], ['maintenance-unavailable']))

    def test_cursor_deduplication_and_reset_storm(self):
        with tempfile.TemporaryDirectory() as root, patch.object(watch, 'STATE', Path(root) / 'event.json'), \
             patch.object(watch, 'restart_group', return_value=([], ['pending:reset-one'])) as restart:
            at = datetime(2026, 9, 29, tzinfo=timezone.utc)
            message = 'amdgpu 0000:c6:00.0: GPU reset(2) succeeded!'
            self.assertTrue(watch.handle(message, 'cursor-2', 'boot-a', at))
            self.assertFalse(watch.handle(message, 'cursor-2', 'boot-a', at))
            self.assertFalse(watch.handle(message, 'cursor-3', 'boot-a', at + timedelta(seconds=59)))
            self.assertEqual(json.loads(watch.STATE.read_text())['suppressedResets'], 1)
            self.assertTrue(watch.handle(message, 'cursor-4', 'boot-a', at + timedelta(seconds=60)))
            self.assertEqual(restart.call_count, 2)


if __name__ == '__main__':
    unittest.main()
