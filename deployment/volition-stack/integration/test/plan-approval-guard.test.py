"""The Helena approval guard plugin (the Autopilot's adapter in Hermes), against a local
stand-in for Helena's policy engine.

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


def allow(_body):
    return {"outcome": "allow", "message": ""}


class FakeHelena(BaseHTTPRequestHandler):
    status = 200
    # What the policy engine answers, from the request body.
    decide = staticmethod(allow)
    # Helena without the policy engine answers 404 on /agent-policy/decide.
    engine = True
    commands: list = []
    requests: list = []

    def _answer(self, value, status=None):
        body = json.dumps(value).encode()
        self.send_response(status or FakeHelena.status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        FakeHelena.requests.append(("GET", self.path, None, self.headers.get("x-api-key")))
        self._answer(FakeHelena.commands)

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        FakeHelena.requests.append(("POST", self.path, body, self.headers.get("x-api-key")))
        if not FakeHelena.engine:
            self._answer({"error": "Not found"}, 404)
            return
        self._answer(FakeHelena.decide(body))

    def log_message(self, *_):
        pass


def serve_helena():
    FakeHelena.status, FakeHelena.commands, FakeHelena.requests = 200, [], []
    FakeHelena.decide, FakeHelena.engine = staticmethod(allow), True
    server = HTTPServer(("127.0.0.1", 0), FakeHelena)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def closed_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class HelenaApprovalGuardTest(unittest.TestCase):
    def setUp(self):
        server = serve_helena()
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
        os.environ.pop("ITSAPLAN_MESSAGE_ID", None)

    def check(self, tool_name, **args):
        return GUARD.check_tool_call(tool_name=tool_name, args=args)

    def assertBlocked(self, result, text):
        self.assertIsNotNone(result)
        self.assertEqual(result["action"], "block")
        self.assertIn(text, result["message"])

    def decisions(self):
        return [body for method, path, body, _ in FakeHelena.requests if path == "/agent-policy/decide"]

    def test_reads_are_observed_by_helena(self):
        for tool in ["read_file", "search_files", "web_search", "browser_snapshot", "clarify"]:
            self.assertIsNone(self.check(tool, path="notes.md"))
        self.assertEqual(len(self.decisions()), 5)

    def test_asks_the_engine_about_a_command_with_what_it_needs(self):
        self.assertIsNone(self.check("terminal", command="git push --force origin main"))
        [body] = self.decisions()
        self.assertEqual(body["runtime"], "hermes")
        self.assertEqual(body["tool"], "terminal")
        self.assertEqual(body["runId"], 42)
        self.assertEqual(body["command"], "git push --force origin main")
        self.assertTrue(body["dangerous"])
        self.assertEqual(body["workspace"], os.getcwd())
        self.assertEqual(FakeHelena.requests[0][3], "test-agent-key")

    def test_blocks_with_the_engines_message(self):
        FakeHelena.decide = staticmethod(
            lambda body: {
                "outcome": "needs-approval",
                "message": f"BLOCKED by Helena's Autopilot: {body['tool']} needs approval",
            }
        )
        self.assertBlocked(self.check("write_file", path="a.md", content="x"), "write_file needs approval")
        FakeHelena.decide = staticmethod(lambda _b: {"outcome": "deny", "message": "BLOCKED: budget"})
        self.assertBlocked(self.check("execute_code", code="print(1)"), "BLOCKED: budget")
        self.assertEqual(self.decisions()[-1]["command"], "print(1)")

    def test_server_decides_former_hard_blocks(self):
        for command in ["rm -rf /", "shutdown -h now"]:
            self.assertIsNone(self.check("terminal", command=command))
        self.assertEqual(len(self.decisions()), 2)

    def test_blocks_when_helena_cannot_be_reached(self):
        os.environ["ITSAPLAN_URL"] = f"http://127.0.0.1:{closed_port()}"
        self.assertBlocked(self.check("terminal", command="git reset --hard"), "Helena could not decide")

    def test_blocks_when_helena_refuses_the_question(self):
        FakeHelena.status = 403
        self.assertBlocked(self.check("write_file", path="a.md"), "HTTP Error 403")

    def test_asks_for_chat_answers_too(self):
        del os.environ["ITSAPLAN_RUN_ID"]
        os.environ["ITSAPLAN_MESSAGE_ID"] = "7"
        self.assertIsNone(self.check("patch", path="src/a.ts"))
        [body] = self.decisions()
        self.assertEqual(body["messageId"], 7)
        self.assertEqual(body["path"], "src/a.ts")
        self.assertNotIn("runId", body)

    def test_leaves_sessions_outside_helena_to_hermes(self):
        del os.environ["ITSAPLAN_RUN_ID"]
        self.assertIsNone(self.check("terminal", command="git push --force origin main"))
        self.assertEqual(FakeHelena.requests, [])

    def test_routes_agent_cron_calls_to_the_server_and_preserves_standalone_behavior(self):
        call = {"action": "create", "schedule": "every 1h", "prompt": "Check the inbox"}
        self.assertIsNone(self.check("cronjob_manage", **call))
        self.assertEqual(FakeHelena.requests[-1][2]["tool"], "cronjob_manage")
        FakeHelena.requests = []
        del os.environ["ITSAPLAN_RUN_ID"]
        self.assertBlocked(self.check("cronjob_manage", **call), "routine in Helena")
        self.assertEqual(FakeHelena.requests, [])

    def test_leaves_helenas_own_mcp_tools_to_helena(self):
        with mock.patch.object(GUARD, "mcp_tool_info", return_value=("itsaplan", False)):
            self.assertIsNone(self.check("mcp_itsaplan_create_issue", title="x"))
        with mock.patch.object(GUARD, "mcp_tool_info", return_value=("shop", True)):
            self.assertIsNone(self.check("mcp_shop_list_orders"))
        self.assertEqual(len(self.decisions()), 1)
        with mock.patch.object(GUARD, "mcp_tool_info", return_value=("shop", False)):
            self.assertIsNone(self.check("mcp_shop_refund", order="1"))
        body = self.decisions()[-1]
        self.assertEqual(body["mcp"], {"server": "shop", "annotations": {"readOnlyHint": False}})

    def test_missing_engine_blocks_unobserved_calls(self):
        FakeHelena.engine = False
        self.assertBlocked(self.check("terminal", command="git status"), "could not decide")
        self.assertBlocked(self.check("read_file", path="a.md"), "could not decide")



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
        server = serve_helena()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        FakeHelena.decide = staticmethod(
            lambda body: {"outcome": "allow", "message": ""}
            if body.get("command") == "git push --force origin main"
            else {"outcome": "needs-approval", "message": "BLOCKED: call request_approval first"}
        )
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
        self.assertIn("request_approval", result["rm -rf /"]["plugin"])
        self.assertFalse(result["rm -rf /"]["hermes"])
        self.assertIn("request_approval", result["cronjob_manage"])


if __name__ == "__main__":
    unittest.main()
