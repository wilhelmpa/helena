#!/usr/bin/env python3
"""Remembers the model of each Claude Code session for the router (SessionStart and
PostModelSwitch hooks), so the router compares against the model the session really runs on
instead of the one in config.json. Prints nothing, always exits 0."""
from __future__ import annotations

import json
import os
import sys

DIR = os.environ.get("HELENA_ROUTER_DIR") or os.path.join(os.path.expanduser("~"), ".claude", "helena-router")


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        session_id = str(payload.get("session_id") or "")
        model = payload.get("to_model") or payload.get("model")
        if isinstance(model, dict):
            model = model.get("id") or model.get("display_name")
        safe = "".join(ch for ch in session_id if ch.isalnum() or ch in "-_")[:80]
        if safe and isinstance(model, str) and model.strip():
            os.makedirs(os.path.join(DIR, "sessions"), mode=0o700, exist_ok=True)
            with open(os.path.join(DIR, "sessions", safe), "w", encoding="utf-8") as handle:
                handle.write(model.strip()[:100])
    except Exception:  # noqa: BLE001 -- a hook never gets in the way
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
