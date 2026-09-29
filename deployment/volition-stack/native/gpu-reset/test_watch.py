import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gpu_watch", Path(__file__).with_name("watch.py"))
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)


class WatchTest(unittest.TestCase):
    def test_planned_group_restart_uses_the_same_recovery_path(self):
        with patch.object(watch.sys, "argv", ["gpu-reset-watch", "restart-group"]), \
             patch.object(watch, "restart_group", return_value=(["helena-halogen.service"], [])) as restart:
            self.assertEqual(watch.main(), 0)
            restart.assert_called_once_with()

    def test_group_stop_kfd_drain_halogen_health_then_other_units(self):
        calls = []

        def systemctl(*args):
            calls.append(args)
            class Result:
                returncode = 0
            return Result()

        def drain():
            calls.append(("drain",))
            return True

        def health():
            calls.append(("health",))
            return True

        with tempfile.TemporaryDirectory() as root, \
             patch.object(watch, "STATE", Path(root) / "state.json"), \
             patch.object(watch, "gpu_unit", side_effect=lambda unit: unit != "helena-embed.service"), \
             patch.object(watch, "systemctl", side_effect=systemctl), \
             patch.object(watch, "wait_for_kfd", side_effect=drain), \
             patch.object(watch, "wait_for_health", side_effect=health):
            at = datetime(2026, 9, 29, tzinfo=timezone.utc)
            message = "amdgpu 0000:c6:00.0: GPU reset(2) succeeded!"
            self.assertTrue(watch.handle(message, "cursor-2", "boot-a", at))
            stopped = ("stop", "helena-halogen.service", "helena-voice-stt.service", "helena-voice-tts.service",
                       "helena-voice-stt-proxy.service", "helena-voice-tts-proxy.service")
            self.assertIn(stopped, calls)
            self.assertLess(calls.index(stopped), calls.index(("drain",)))
            self.assertLess(calls.index(("drain",)), calls.index(("start", "helena-halogen.service")))
            self.assertLess(calls.index(("start", "helena-halogen.service")), calls.index(("health",)))
            self.assertLess(calls.index(("health",)), calls.index(("start", "helena-voice-stt-proxy.socket")))
            self.assertNotIn(("start", "helena-voice-stt.service"), calls)
            self.assertNotIn(("start", "helena-voice-tts.service"), calls)
            before = len(calls)
            self.assertFalse(watch.handle(message.replace("(2)", "(3)"), "cursor-3", "boot-a", at + timedelta(seconds=59)))
            self.assertEqual(len(calls), before)
            self.assertEqual(json.loads(watch.STATE.read_text())["suppressedResets"], 1)
            self.assertTrue(watch.handle(message.replace("(2)", "(4)"), "cursor-4", "boot-a", at + timedelta(seconds=60)))

    def test_failed_drain_does_not_restart_anything(self):
        with tempfile.TemporaryDirectory() as root, \
             patch.object(watch, "STATE", Path(root) / "state.json"), \
             patch.object(watch, "gpu_unit", return_value=True), \
             patch.object(watch, "systemctl") as systemctl, \
             patch.object(watch, "wait_for_kfd", return_value=False):
            systemctl.return_value.returncode = 0
            self.assertTrue(watch.handle("amdgpu: GPU reset(1) succeeded!", "cursor", "boot"))
            self.assertFalse(any(call.args[0] == "start" for call in systemctl.call_args_list))
            self.assertIn("/dev/kfd", json.loads(watch.STATE.read_text())["failedUnits"])

    def test_stuck_kfd_holder_is_killed_after_timeout(self):
        with patch.object(watch, "kfd_holders", side_effect=[{123}, {123}, set(), set()]), \
             patch.object(watch.time, "monotonic", side_effect=[0, 31, 32, 33]), \
             patch.object(watch.os, "kill") as kill:
            self.assertTrue(watch.wait_for_kfd())
            kill.assert_called_once_with(123, watch.signal.SIGKILL)

    def test_halogen_health_failure_keeps_other_gpu_units_stopped(self):
        with tempfile.TemporaryDirectory() as root, \
             patch.object(watch, "STATE", Path(root) / "state.json"), \
             patch.object(watch, "gpu_unit", return_value=True), \
             patch.object(watch, "systemctl") as systemctl, \
             patch.object(watch, "wait_for_kfd", return_value=True), \
             patch.object(watch, "wait_for_health", return_value=False):
            systemctl.return_value.returncode = 0
            self.assertTrue(watch.handle("amdgpu: GPU reset(1) succeeded!", "cursor", "boot"))
            starts = [call.args for call in systemctl.call_args_list if call.args[0] == "start"]
            self.assertEqual(starts, [("start", "helena-halogen.service")])
            self.assertIn("helena-halogen.service", json.loads(watch.STATE.read_text())["failedUnits"])

    def test_group_stop_failure_does_not_start_halogen(self):
        with tempfile.TemporaryDirectory() as root, \
             patch.object(watch, "STATE", Path(root) / "state.json"), \
             patch.object(watch, "gpu_unit", return_value=True), \
             patch.object(watch, "systemctl") as systemctl, \
             patch.object(watch, "wait_for_kfd", return_value=True):
            systemctl.side_effect = lambda *args: type("Result", (), {"returncode": int(args[0] == "stop")})()
            self.assertTrue(watch.handle("amdgpu: GPU reset(1) succeeded!", "cursor", "boot"))
            self.assertFalse(any(call.args[0] == "start" for call in systemctl.call_args_list))
            self.assertIn("stop", json.loads(watch.STATE.read_text())["failedUnits"])

    def test_other_kernel_messages_do_nothing(self):
        with patch.object(watch, "systemctl") as systemctl:
            self.assertFalse(watch.handle("GPU reset begin!", "cursor", "boot-a"))
            systemctl.assert_not_called()


if __name__ == "__main__":
    unittest.main()
