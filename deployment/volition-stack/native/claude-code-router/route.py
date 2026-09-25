#!/usr/bin/env python3
"""Helena's model router for the owner's Claude Code: the UserPromptSubmit hook.

docs/helena-decisions/decisions.md §4.3. Before each prompt, the prompt text (only that) goes
to Helena's decisions service (POST /model-router/prompt), which asks the configured decision
model (Laya or a small local model on this machine, or Jev in the cloud) how hard the request
is and whether it depends on the earlier conversation. When a cheaper Claude tier covers it,
Helena answers with a short factual note that Claude reads; the standing rule of what to do
with such a note is in the owner's CLAUDE.md (the installer offers it). Nothing is enforced.

Fails open: switched off, no key, a slash command, a short prompt, Helena not answering within
the failsafe, any error — the prompt goes on unchanged, without a note, and exit code 0.

Files (~/.claude/helena-router, 0700):
  config.json  helenaUrl, sessionModel, timeoutSeconds, quiet (no note when the model stays),
               logPrompt (keep the first 120 characters in the log; off by default)
  enabled      present = on (/router on|off)
  key          the owner's Helena API key (0600, the owner writes it; never printed)
  log.jsonl    one line per decision
  sessions/    the model of each session, from the SessionStart hook (when installed)
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DIR = os.environ.get("HELENA_ROUTER_DIR") or os.path.join(os.path.expanduser("~"), ".claude", "helena-router")
DEFAULTS = {
    "helenaUrl": "http://127.0.0.1:3000",
    "sessionModel": "opus",
    "timeoutSeconds": 5,
    "quiet": False,
    "logPrompt": False,
    "minPromptChars": 12,
}


def config() -> dict:
    try:
        with open(os.path.join(DIR, "config.json"), encoding="utf-8") as handle:
            return {**DEFAULTS, **json.load(handle)}
    except (OSError, ValueError):
        return dict(DEFAULTS)


def read_key() -> str | None:
    try:
        with open(os.path.join(DIR, "key"), encoding="utf-8") as handle:
            key = handle.read().strip()
        return key or None
    except OSError:
        return None


def session_model(cfg: dict, session_id: str | None) -> str:
    if session_id:
        safe = "".join(ch for ch in session_id if ch.isalnum() or ch in "-_")[:80]
        try:
            with open(os.path.join(DIR, "sessions", safe), encoding="utf-8") as handle:
                model = handle.read().strip()
            if model:
                return model
        except OSError:
            pass
    return str(cfg.get("sessionModel") or "opus")


def log(entry: dict) -> None:
    try:
        with open(os.path.join(DIR, "log.jsonl"), "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass


def ask(cfg: dict, key: str, prompt: str, model: str, session_id: str | None) -> dict | None:
    body = json.dumps(
        {"prompt": prompt, "sessionModel": model, **({"sessionId": session_id} if session_id else {})}
    ).encode("utf-8")
    request = urllib.request.Request(
        cfg["helenaUrl"].rstrip("/") + "/model-router/prompt",
        data=body,
        headers={"content-type": "application/json", "x-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=float(cfg.get("timeoutSeconds") or 5)) as response:
            if response.status != 200:
                return None
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        return None


def route(payload: dict, force: bool = False) -> str | None:
    """The note for Claude, or None. `force` runs it while the router is off (/router test)."""
    if not force and not os.path.exists(os.path.join(DIR, "enabled")):
        return None
    prompt = str(payload.get("prompt") or "").strip()
    cfg = config()
    if not prompt or prompt.startswith("/") or len(prompt) < int(cfg.get("minPromptChars") or 12):
        return None
    key = read_key()
    if not key:
        return None
    session_id = payload.get("session_id") if isinstance(payload.get("session_id"), str) else None
    model = session_model(cfg, session_id)
    started = time.monotonic()
    answer = ask(cfg, key, prompt, model, session_id)
    ms = int((time.monotonic() - started) * 1000)
    if not answer or answer.get("decision") not in ("delegate", "handle"):
        log({"ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "decision": "none",
             "status": (answer or {}).get("status", "no answer"), "ms": ms})
        return None
    entry = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "decision": answer["decision"],
        "tier": answer.get("tier"),
        "model": answer.get("model"),
        "session": model,
        "confidence": answer.get("confidence"),
        "needsContext": answer.get("needsContext"),
        "ms": ms,
    }
    if cfg.get("logPrompt"):
        entry["prompt"] = prompt[:120]
    log(entry)
    if answer["decision"] == "handle" and cfg.get("quiet"):
        return None
    note = str(answer.get("note") or "").strip()
    return note or None


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return 0
    try:
        note = route(payload if isinstance(payload, dict) else {})
    except Exception:  # noqa: BLE001 -- the hook never stops a prompt
        return 0
    if note:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": note}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
