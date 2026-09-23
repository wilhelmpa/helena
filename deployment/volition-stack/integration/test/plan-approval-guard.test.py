"""The Plan approval guard plugin, against a local stand-in for Plan.

Needs the Hermes source: HERMES_SOURCE, by default /srv/volition/source/hermes. The last test
class loads the plugin through Hermes itself and runs only with Hermes' dependencies installed,
e.g. with the Hermes virtualenv's python.
"""

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

HERMES = Path(os.environ.get("HERMES_SOURCE", "/srv/volition/source/hermes"))
sys.path.insert(0, str(HERMES))

PLUGIN_DIR = Path(__file__).parents[1] / "hermes-plugins" / "plan-approval-guard"
SPEC = importlib.util.spec_from_file_location("plan_approval_guard", PLUGIN_DIR / "__init__.py")
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)


class FakePlan(BaseHTTPRequestHandler):
    status = 200
    commands: list = []
    requests: list = []

    def do_GET(self):
        FakePlan.requests.append((self.path, self.headers.get("x-api-key")))
        body = json.dumps(FakePlan.commands).encode()
        self.send_response(FakePlan.status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def serve_plan():
    FakePlan.status, FakePlan.commands, FakePlan.requests = 200, [], []
    server = HTTPServer(("127.0.0.1", 0), FakePlan)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def closed_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class PlanApprovalGuardTest(unittest.TestCase):
    def setUp(self):
        server = serve_plan()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        env = {
            "ITSAPLAN_RUN_ID": "42",
            "ITSAPLAN_URL": f"http://127.0.0.1:{server.server_port}/",
            "ITSAPLAN_API_KEY": "test-agent-key",
        }
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)

    def check(self, tool_name, **args):
        return GUARD.check_tool_call(tool_name=tool_name, args=args)

    def assertBlocked(self, result, text):
        self.assertEqual(result["action"], "block")
        self.assertIn(text, result["message"])

    def test_lets_a_harmless_command_run_without_asking_plan(self):
        self.assertIsNone(self.check("terminal", command="ls -la && git status"))
        self.assertEqual(FakePlan.requests, [])

    def test_blocks_a_dangerous_command_that_is_not_approved_for_the_run(self):
        result = self.check("terminal", command="git push --force origin main")
        self.assertBlocked(result, "git force push")
        self.assertIn("request_approval", result["message"])
        self.assertIn("exactly this command in command", result["message"])
        self.assertEqual(FakePlan.requests, [("/agent-runs/42/approved-commands", "test-agent-key")])

    def test_lets_exactly_the_approved_command_run(self):
        FakePlan.commands = ["git push --force origin main"]
        self.assertIsNone(self.check("terminal", command="  git push --force origin main\n"))
        self.assertBlocked(self.check("terminal", command="git push --force origin dev"), "approval")

    def test_never_approves_a_command_on_the_hard_block_list(self):
        FakePlan.commands = ["rm -rf /", "shutdown -h now"]
        for command in FakePlan.commands:
            with self.subTest(command=command):
                self.assertBlocked(self.check("terminal", command=command), "not even with an approval")
        self.assertEqual(FakePlan.requests, [])

    def test_asks_for_every_execute_code_script(self):
        code = "print(sum(range(10)))"
        self.assertBlocked(self.check("execute_code", code=code), "execute_code runs arbitrary Python")
        FakePlan.commands = [code]
        self.assertIsNone(self.check("execute_code", code=code))

    def test_blocks_when_plan_cannot_be_reached(self):
        os.environ["ITSAPLAN_URL"] = f"http://127.0.0.1:{closed_port()}"
        self.assertBlocked(self.check("terminal", command="git reset --hard"), "Plan could not confirm")

    def test_blocks_when_plan_refuses_the_lookup(self):
        FakePlan.status = 403
        self.assertBlocked(self.check("terminal", command="git reset --hard"), "HTTP Error 403")

    def test_blocks_when_the_run_id_is_not_a_run_id(self):
        os.environ["ITSAPLAN_RUN_ID"] = "42/../../other"
        self.assertBlocked(self.check("terminal", command="git reset --hard"), "not a run id")
        self.assertEqual(FakePlan.requests, [])

    def test_blocks_hermes_cron_jobs_in_runs_and_chats(self):
        call = {"action": "create", "schedule": "every 1h", "prompt": "Check the inbox"}
        self.assertBlocked(self.check("cronjob_manage", **call), "routine in Plan")
        del os.environ["ITSAPLAN_RUN_ID"]
        self.assertBlocked(self.check("cronjob_manage", **call), "routine in Plan")
        self.assertEqual(FakePlan.requests, [])

    def test_leaves_chats_and_other_tools_to_hermes(self):
        self.assertIsNone(self.check("write_file", path="notes.md", content="rm -rf /"))
        del os.environ["ITSAPLAN_RUN_ID"]
        self.assertIsNone(self.check("terminal", command="git push --force origin main"))
        self.assertEqual(FakePlan.requests, [])


HERMES_RUNTIME = importlib.util.find_spec("yaml") is not None and importlib.util.find_spec("pydantic") is not None

# Runs in a fresh process: Hermes reads HERMES_HOME and discovers plugins once per process.
HERMES_PROBE = """
import json, sys
from hermes_cli.plugins import _dispatch_pre_tool_call_hooks, discover_plugins
from tools.approval import check_all_command_guards
discover_plugins()
result = {}
for command in sys.argv[1:]:
    blocked, _ = _dispatch_pre_tool_call_hooks("terminal", {"command": command})
    guard = check_all_command_guards(command, "local")
    result[command] = {"plugin": blocked, "hermes": guard["approved"]}
result["cronjob_manage"] = _dispatch_pre_tool_call_hooks("cronjob_manage", {"action": "list"})[0]
print(json.dumps(result))
"""


@unittest.skipUnless(HERMES_RUNTIME, "Hermes' dependencies are not installed")
class HermesLoadsTheGuardTest(unittest.TestCase):
    def test_single_query_runs_leave_the_decision_to_the_guard(self):
        server = serve_plan()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        FakePlan.commands = ["git push --force origin main"]
        with tempfile.TemporaryDirectory() as home:
            (Path(home) / "plugins").mkdir()
            (Path(home) / "plugins" / "plan-approval-guard").symlink_to(PLUGIN_DIR)
            (Path(home) / "config.yaml").write_text(
                "approvals:\n  single_query_mode: approve\n"
                "plugins:\n  enabled:\n    - plan-approval-guard\n",
                encoding="utf-8",
            )
            env = {
                **os.environ,
                "HERMES_HOME": home,
                "HOME": home,
                "PYTHONPATH": str(HERMES),
                "HERMES_SINGLE_QUERY_SESSION": "1",
                "ITSAPLAN_RUN_ID": "42",
                "ITSAPLAN_URL": f"http://127.0.0.1:{server.server_port}",
                "ITSAPLAN_API_KEY": "test-agent-key",
            }
            env.pop("HERMES_YOLO_MODE", None)
            output = subprocess.run(
                [sys.executable, "-c", HERMES_PROBE, "git push --force origin main", "git reset --hard", "rm -rf /"],
                env=env, cwd=home, capture_output=True, text=True, timeout=120, check=True,
            ).stdout
        result = json.loads(output.strip().splitlines()[-1])
        self.assertEqual(result["git push --force origin main"], {"plugin": None, "hermes": True})
        self.assertIn("request_approval", result["git reset --hard"]["plugin"])
        self.assertTrue(result["git reset --hard"]["hermes"])
        self.assertIn("not even with an approval", result["rm -rf /"]["plugin"])
        self.assertFalse(result["rm -rf /"]["hermes"])
        self.assertIn("routine in Plan", result["cronjob_manage"])


if __name__ == "__main__":
    unittest.main()
