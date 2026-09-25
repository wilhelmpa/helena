"""Tests of the Hermes update helper against a throwaway upstream, checkout and virtual
environment: a check lists what an update brings, an apply carries the local commits over,
and every failure puts the old checkout and virtual environment back. Run with
`python3 -m unittest test_helena_hermes_update` in this folder (no root needed)."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader("helper", str(HERE / "helena-hermes-update"))
spec = importlib.util.spec_from_loader("helper", loader)
helper = importlib.util.module_from_spec(spec)
loader.exec_module(helper)

ENV = {
    "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "t@example.com",
    "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "t@example.com",
}


def sh(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(args, cwd=cwd, env={**os.environ, **ENV}, check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout


def commit(repo: Path, name: str, content: str, message: str) -> None:
    (repo / name).write_text(content)
    sh("git", "add", name, cwd=repo)
    sh("git", "commit", "-q", "-m", message, cwd=repo)


class HelperTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.upstream = root / "upstream"
        self.upstream.mkdir()
        sh("git", "init", "-q", "-b", "main", cwd=self.upstream)
        commit(self.upstream, "pyproject.toml", 'version = "0.21.4"\n', "release 0.21.4")
        sh("git", "tag", "v2026.9.21", cwd=self.upstream)
        commit(self.upstream, "app.py", "print('a')\n", "feat: stream json")
        self.source = root / "source"
        sh("git", "clone", "-q", str(self.upstream), str(self.source))
        sh("git", "checkout", "-q", "-b", "volition/main", "v2026.9.21", cwd=self.source)
        commit(self.source, "local.py", "patch = 1\n", "feat(stream-json): local patch")
        # Newer upstream work arrives after the checkout was made.
        commit(self.upstream, "pyproject.toml", 'version = "0.22.0"\n', "release 0.22.0")
        sh("git", "tag", "v2026.9.28", cwd=self.upstream)
        self.venv = root / "venv"
        self.venv.mkdir()
        (self.venv / "marker").write_text("old")
        self.spool = root / "spool"
        self.spool.mkdir()
        self.config = {
            "source": str(self.source), "venv": str(self.venv), "spool": str(self.spool), "rollbackDir": str(root / "keep"),
            "localBranch": "volition/main",
            "install": ["sh", "-c", "echo new > {venv}/marker"],
            "smoke": ["sh", "-c", "grep -o '[0-9.]*' {source}/pyproject.toml"],
        }

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def config_with(self, **changes) -> dict:
        path = Path(self.tmp.name) / "config.json"
        path.write_text(json.dumps({**self.config, **changes}))
        return helper.load_config(path)

    def head(self) -> str:
        return sh("git", "rev-parse", "HEAD", cwd=self.source).strip()

    def test_check_lists_upstream_commits_and_local_patches(self):
        answer = helper.run(self.config_with(), "check", None)
        self.assertTrue(answer["ok"], answer)
        result = answer["result"]
        self.assertEqual(result["current"]["version"], "0.21.4")
        self.assertEqual(result["latest"]["version"], "0.22.0")
        self.assertEqual([c["subject"] for c in result["commits"]],
                         ["release 0.22.0", "feat: stream json"])
        self.assertEqual([c["subject"] for c in result["localPatches"]],
                         ["feat(stream-json): local patch"])

    def test_apply_carries_the_local_commit_and_reinstalls(self):
        answer = helper.run(self.config_with(), "apply", "latest")
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(answer["result"]["to"]["version"], "0.22.0")
        self.assertEqual(answer["result"]["carried"], 1)
        self.assertEqual((self.venv / "marker").read_text().strip(), "new")
        self.assertTrue((self.source / "local.py").exists())
        self.assertEqual(sh("git", "rev-parse", "--abbrev-ref", "HEAD", cwd=self.source).strip(),
                         "volition/main")
        self.assertIn("0.22.0", answer["result"]["smoke"])

    def test_a_local_branch_held_by_another_worktree_leaves_the_checkout_detached(self):
        sh("git", "checkout", "-q", "--detach", cwd=self.source)
        dev = Path(self.tmp.name) / "dev"
        sh("git", "worktree", "add", "-q", str(dev), "volition/main", cwd=self.source)
        answer = helper.run(self.config_with(), "apply", "latest")
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(answer["result"]["to"]["version"], "0.22.0")
        self.assertIn("checked out in another worktree", answer["log"])
        self.assertEqual(sh("git", "rev-parse", "--abbrev-ref", "HEAD", cwd=self.source).strip(),
                         "HEAD")
        self.assertTrue((self.source / "local.py").exists())
        self.assertEqual(sh("git", "branch", "--list", "helena/*", cwd=self.source).strip(), "")

    def test_a_failed_smoke_test_puts_everything_back(self):
        before = self.head()
        answer = helper.run(self.config_with(smoke=["sh", "-c", "exit 3"]), "apply", "v2026.9.28")
        self.assertFalse(answer["ok"])
        self.assertIn("rolling back", answer["log"])
        self.assertEqual(self.head(), before)
        self.assertEqual((self.venv / "marker").read_text(), "old")
        self.assertFalse((Path(self.tmp.name) / "keep" / "venv").exists())

    def test_a_local_commit_that_no_longer_applies_puts_everything_back(self):
        commit(self.upstream, "local.py", "patch = 2\n", "upstream takes the same file")
        before = self.head()
        answer = helper.run(self.config_with(), "apply", "latest")
        self.assertFalse(answer["ok"])
        self.assertIn("does not apply", answer["error"])
        self.assertEqual(self.head(), before)
        self.assertEqual(sh("git", "status", "--porcelain", cwd=self.source).strip(), "")

    def test_refuses_targets_that_are_not_upstream(self):
        answer = helper.run(self.config_with(), "apply", "main; rm -rf /")
        self.assertFalse(answer["ok"])
        local = self.head()
        answer = helper.run(self.config_with(), "apply", local)
        self.assertFalse(answer["ok"])
        self.assertIn("is not on", answer["error"])

    def test_serves_a_spool_request_and_writes_its_status(self):
        (self.spool / "request.json").write_text(json.dumps({"id": "r1", "action": "check"}))
        answer = helper.serve_request(self.config_with())
        self.assertTrue(answer["ok"])
        status = json.loads((self.spool / "status.json").read_text())
        self.assertEqual((status["id"], status["state"]), ("r1", "done"))
        self.assertFalse((self.spool / "request.json").exists())


class UnitTest(unittest.TestCase):
    def test_uv_gets_a_writable_cache_outside_the_read_only_home(self):
        unit = (HERE / "helena-hermes-update.service").read_text()
        self.assertIn("CacheDirectory=helena-hermes-update", unit)
        self.assertIn("Environment=UV_CACHE_DIR=/var/cache/helena-hermes-update", unit)
        self.assertIn("ProtectHome=read-only", unit)


if __name__ == "__main__":
    unittest.main()
