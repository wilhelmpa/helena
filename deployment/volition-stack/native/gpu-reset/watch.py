#!/usr/bin/env python3
"""Recover GPU services after a completed amdgpu reset."""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server" / "hostd")
                if (Path(__file__).resolve().parents[1] / "server" / "hostd").is_dir()
                else "/usr/local/lib/helena/hostd")
from helena_host import model_server
from helena_host.common import Host

STATE = Path(os.environ.get("HELENA_GPU_RESET_STATE", "/var/lib/helena-ai/gpu-reset.json"))
RESET = re.compile(r"\bamdgpu\b.*\bGPU reset\((\d+)\) succeeded!")


def save(event: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps(event) + "\n")
    os.replace(temp, STATE)


def restart_group() -> tuple[list[str], list[str]]:
    try:
        value = model_server.reset_group(Host())
        return [], ["pending:" + value['operation']['id']]
    except Exception:
        return [], ["maintenance-unavailable"]


def handle(message: str, cursor: str, boot_id: str, event_time: datetime | None = None) -> bool:
    match = RESET.search(message)
    if not match:
        return False
    event_time = event_time or datetime.now(timezone.utc)
    try:
        old = json.loads(STATE.read_text())
    except (FileNotFoundError, ValueError):
        old = {}
    if cursor == old.get("cursor") and boot_id == old.get("bootId"):
        return False
    previous = datetime.fromisoformat(old["eventAt"]) if old.get("bootId") == boot_id and old.get("eventAt") else None
    if previous and 0 <= (event_time - previous).total_seconds() < 60:
        old["cursor"] = cursor
        old["suppressedResets"] = old.get("suppressedResets", 0) + 1
        save(old)
        return False
    restarted, failures = restart_group()
    event = {"at": datetime.now(timezone.utc).isoformat(), "eventAt": event_time.isoformat(),
             "bootId": boot_id, "resetNumber": int(match.group(1)), "cursor": cursor,
             "restartedUnits": restarted, "failedUnits": failures, "suppressedResets": 0}
    save(event)
    print(f"amdgpu reset {event['resetNumber']}: started {restarted}, failed {failures}", flush=True)
    return True


def main() -> int:
    if sys.argv[1:] == ["restart-group"]:
        restarted, failures = restart_group()
        print(f"GPU-Gruppe: gestartet {restarted}, Fehler {failures}", flush=True)
        return 1 if failures else 0
    if len(sys.argv) != 1:
        return 2
    try:
        model_server.initialize(Host())
    except Exception:
        print('Model maintenance identity unavailable; recovery stays fenced on failure', flush=True)
    boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    try:
        previous = json.loads(STATE.read_text())
    except (FileNotFoundError, ValueError):
        previous = {}
    args = ["journalctl", "-k", "-f", "-o", "json", "--no-pager"]
    if previous.get("bootId") == boot_id and previous.get("cursor"):
        args += ["--after-cursor", previous["cursor"]]
    else:
        args += ["-n", "0"]
    with subprocess.Popen(args, text=True, stdout=subprocess.PIPE) as journal:
        assert journal.stdout is not None
        for line in journal.stdout:
            try:
                entry = json.loads(line)
                event_time = datetime.fromtimestamp(int(entry["__REALTIME_TIMESTAMP"]) / 1_000_000, timezone.utc)
            except (ValueError, KeyError):
                continue
            handle(entry.get("MESSAGE", ""), entry.get("__CURSOR", ""), boot_id, event_time)
    return 1


if __name__ == "__main__":
    sys.exit(main())
