#!/usr/bin/env python3
"""Exercise Hermes' browser tool against one provisioned project's live Chromium."""

from __future__ import annotations

import json
import os
import re
import stat
import sys
from pathlib import Path

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
TITLE = "Example Domain"
URL = "https://example.com/"


def fail(message: str) -> int:
    print(json.dumps({"ok": False, "error": message}))
    return 1


def private_file(file_path: Path) -> None:
    metadata = file_path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_mode & 0o077:
        raise RuntimeError("Project browser state is not private")


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not SLUG.fullmatch(argv[1]):
        return fail("usage: volition-hermes-browser-smoke PROJECT_SLUG")
    slug = argv[1]
    root = Path(
        os.environ.get(
            "HERMES_PROJECT_BROWSER_ROOT",
            "/var/lib/volition/project-browser/projects",
        )
    )
    project_root = root / slug
    try:
        metadata = project_root.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_mode & 0o077:
            raise RuntimeError("Project browser root is not private")
        state_path = project_root / "runtime.json"
        private_file(state_path)
        state = json.loads(state_path.read_text(encoding="utf-8"))
        cdp_port = state.get("cdpPort") if isinstance(state, dict) else None
        if (
            state.get("schemaVersion") != 1
            or state.get("slug") != slug
            or not isinstance(cdp_port, int)
            or isinstance(cdp_port, bool)
            or cdp_port < 1024
            or cdp_port > 65535
        ):
            raise RuntimeError("Project browser state is invalid")
    except (OSError, json.JSONDecodeError, RuntimeError) as exc:
        return fail(str(exc))

    os.environ["BROWSER_CDP_URL"] = f"http://127.0.0.1:{cdp_port}"
    try:
        from tools.browser_tool import browser_navigate

        result = json.loads(browser_navigate(URL, task_id=f"volition-smoke-{slug}"))
    except Exception:
        return fail("Hermes browser navigation failed")
    if result.get("success") is not True or result.get("title") != TITLE:
        return fail("Hermes browser navigation did not reach the smoke page")
    print(json.dumps({"ok": True, "slug": slug, "title": TITLE}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
