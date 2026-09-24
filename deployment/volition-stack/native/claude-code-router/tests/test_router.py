"""Tests of the owner's Claude Code router hook and its installer (no Claude Code, no Helena:
a stand-in HTTP server answers like POST /model-router/prompt).

  TMPDIR=~/agent-work/tmp python3 -m unittest discover -s deployment/volition-stack/native/claude-code-router/tests
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Stand(BaseHTTPRequestHandler):
    answer: dict = {}
    seen: list = []

    def log_message(self, *_args):  # quiet
        pass

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length))
        Stand.seen.append({"path": self.path, "key": self.headers.get("x-api-key"), "body": body})
        data = json.dumps(Stand.answer).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run_hook(directory: str, payload: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, os.path.join(HERE, "route.py")],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env={**os.environ, "HELENA_ROUTER_DIR": directory},
        timeout=20,
    )


class RouteHookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Stand)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="helena-router-test-")
        with open(os.path.join(self.dir, "config.json"), "w") as handle:
            json.dump({"helenaUrl": f"http://127.0.0.1:{self.server.server_port}", "sessionModel": "opus"}, handle)
        with open(os.path.join(self.dir, "key"), "w") as handle:
            handle.write("test-key-123\n")
        Stand.seen = []
        Stand.answer = {
            "decision": "delegate",
            "tier": "light",
            "model": "haiku",
            "confidence": 0.91,
            "needsContext": 0.08,
            "note": "Helena model router: this request looks like light work.",
            "status": "decided",
        }

    def test_off_sends_nothing(self):
        result = run_hook(self.dir, {"prompt": "Finde die Datei mit der Login-Route", "session_id": "s1"})
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(Stand.seen, [])

    def test_on_adds_the_note_and_sends_only_the_prompt(self):
        open(os.path.join(self.dir, "enabled"), "w").close()
        result = run_hook(self.dir, {"prompt": "Finde die Datei mit der Login-Route", "session_id": "s1", "cwd": "/secret"})
        self.assertEqual(result.returncode, 0)
        output = json.loads(result.stdout)
        self.assertEqual(output["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")
        self.assertIn("light work", output["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(len(Stand.seen), 1)
        sent = Stand.seen[0]
        self.assertEqual(sent["path"], "/model-router/prompt")
        self.assertEqual(sent["key"], "test-key-123")
        self.assertEqual(set(sent["body"]), {"prompt", "sessionModel", "sessionId"})
        with open(os.path.join(self.dir, "log.jsonl")) as handle:
            entry = json.loads(handle.readline())
        self.assertEqual(entry["decision"], "delegate")
        self.assertNotIn("prompt", entry)

    def test_slash_commands_and_short_prompts_pass(self):
        open(os.path.join(self.dir, "enabled"), "w").close()
        self.assertEqual(run_hook(self.dir, {"prompt": "/router status"}).stdout, "")
        self.assertEqual(run_hook(self.dir, {"prompt": "ja"}).stdout, "")
        self.assertEqual(Stand.seen, [])

    def test_fails_open_without_helena(self):
        open(os.path.join(self.dir, "enabled"), "w").close()
        with open(os.path.join(self.dir, "config.json"), "w") as handle:
            json.dump({"helenaUrl": "http://127.0.0.1:9", "timeoutSeconds": 1}, handle)
        result = run_hook(self.dir, {"prompt": "Finde die Datei mit der Login-Route"})
        self.assertEqual((result.returncode, result.stdout), (0, ""))

    def test_quiet_drops_the_note_when_the_model_stays(self):
        open(os.path.join(self.dir, "enabled"), "w").close()
        with open(os.path.join(self.dir, "config.json"), "w") as handle:
            json.dump({"helenaUrl": f"http://127.0.0.1:{self.server.server_port}", "quiet": True}, handle)
        Stand.answer = {**Stand.answer, "decision": "handle", "note": "opus stays"}
        self.assertEqual(run_hook(self.dir, {"prompt": "Entwirf das Datenmodell für die Abrechnung"}).stdout, "")

    def test_session_model_from_the_session_hook(self):
        open(os.path.join(self.dir, "enabled"), "w").close()
        subprocess.run(
            [sys.executable, os.path.join(HERE, "session.py")],
            input=json.dumps({"session_id": "abc-1", "model": "claude-sonnet-5"}),
            text=True,
            env={**os.environ, "HELENA_ROUTER_DIR": self.dir},
            check=True,
        )
        run_hook(self.dir, {"prompt": "Finde die Datei mit der Login-Route", "session_id": "abc-1"})
        self.assertEqual(Stand.seen[0]["body"]["sessionModel"], "claude-sonnet-5")


class InstallerTest(unittest.TestCase):
    def test_install_merges_and_uninstall_restores(self):
        home = tempfile.mkdtemp(prefix="helena-router-home-")
        claude = os.path.join(home, ".claude")
        os.makedirs(claude)
        original = {"model": "opus", "hooks": {"UserPromptSubmit": [{"hooks": [{"type": "command", "command": "echo mine"}]}]}}
        with open(os.path.join(claude, "settings.json"), "w") as handle:
            json.dump(original, handle)
        env = {**os.environ, "HOME": home, "CLAUDE_CONFIG_DIR": claude}
        script = os.path.join(HERE, "install.sh")
        subprocess.run(["bash", script, "install", "--claude-md"], env=env, check=True, capture_output=True)
        subprocess.run(["bash", script, "install", "--claude-md"], env=env, check=True, capture_output=True)
        with open(os.path.join(claude, "settings.json")) as handle:
            settings = json.load(handle)
        commands = [h["command"] for g in settings["hooks"]["UserPromptSubmit"] for h in g["hooks"]]
        self.assertEqual(commands.count("echo mine"), 1)
        self.assertEqual(sum("helena-router/route.py" in c for c in commands), 1)
        self.assertIn("SessionStart", settings["hooks"])
        self.assertFalse(os.path.exists(os.path.join(claude, "helena-router", "enabled")))
        self.assertFalse(os.path.exists(os.path.join(claude, "helena-router", "key")))
        with open(os.path.join(claude, "CLAUDE.md")) as handle:
            self.assertEqual(handle.read().count("<!-- helena-router -->"), 1)
        self.assertTrue(os.path.exists(os.path.join(claude, "skills", "router", "SKILL.md")))
        subprocess.run(["bash", script, "uninstall", "--purge"], env=env, check=True, capture_output=True)
        with open(os.path.join(claude, "settings.json")) as handle:
            self.assertEqual(json.load(handle), original)
        with open(os.path.join(claude, "CLAUDE.md")) as handle:
            self.assertNotIn("helena-router", handle.read())
        self.assertFalse(os.path.exists(os.path.join(claude, "helena-router")))


if __name__ == "__main__":
    unittest.main()
