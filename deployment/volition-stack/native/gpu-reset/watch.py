#!/usr/bin/env python3
"""Recover GPU services after a completed amdgpu reset."""
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

STATE = Path(os.environ.get("HELENA_GPU_RESET_STATE", "/var/lib/helena-ai/gpu-reset.json"))
UNITS = ("helena-halogen.service", "helena-embed.service", "helena-voice-stt.service", "helena-voice-tts.service")
ON_DEMAND = {"helena-voice-stt.service", "helena-voice-tts.service"}
RESET = re.compile(r"\bamdgpu\b.*\bGPU reset\((\d+)\) succeeded!")
HEALTH = "http://127.0.0.1:8731/health"


def systemctl(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["systemctl", *args], text=True, capture_output=True, check=False)


def gpu_unit(unit: str) -> bool:
    if unit == "helena-halogen.service":
        return True
    result = systemctl("cat", unit)
    return result.returncode == 0 and "DeviceAllow=/dev/kfd" in result.stdout


def kfd_holders() -> set[int]:
    holders = set()
    for proc in Path("/proc").glob("[0-9]*"):
        try:
            if any(fd.resolve() == Path("/dev/kfd") for fd in (proc / "fd").iterdir()):
                holders.add(int(proc.name))
        except (OSError, PermissionError):
            continue
    return holders


def wait_for_kfd(timeout: float = 30) -> bool:
    deadline = time.monotonic() + timeout
    while holders := kfd_holders():
        if time.monotonic() >= deadline:
            for pid in holders:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            deadline = time.monotonic() + 5
            while kfd_holders() and time.monotonic() < deadline:
                time.sleep(0.5)
            return not kfd_holders()
        time.sleep(0.5)
    return True


def wait_for_health(timeout: float = 180) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(HEALTH, timeout=2) as response:
                body = json.load(response)
                if response.status == 200 and body.get("status") == "ok" and body.get("responds") is True:
                    return True
        except (OSError, ValueError):
            pass
        time.sleep(2)
    return False


def save(event: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps(event) + "\n")
    os.replace(temp, STATE)


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

    active = [unit for unit in UNITS if gpu_unit(unit) and systemctl("is-active", "--quiet", unit).returncode == 0]
    failures = []
    restarted = []
    proxies = [unit.replace(".service", "-proxy.service") for unit in active if unit in ON_DEMAND]
    if active and systemctl("stop", *active, *proxies).returncode:
        failures.append("stop")
    if not wait_for_kfd():
        failures.append("/dev/kfd")
    else:
        if systemctl("start", "helena-halogen.service").returncode or not wait_for_health():
            failures.append("helena-halogen.service")
        else:
            restarted.append("helena-halogen.service")
            for unit in active:
                if unit == "helena-halogen.service":
                    continue
                target = unit.replace(".service", "-proxy.socket") if unit in ON_DEMAND else unit
                if systemctl("start", target).returncode:
                    failures.append(target)
                else:
                    restarted.append(target)
            for unit in ON_DEMAND:
                socket = unit.replace(".service", "-proxy.socket")
                if socket not in restarted and systemctl("start", socket).returncode:
                    failures.append(socket)

    event = {"at": datetime.now(timezone.utc).isoformat(), "eventAt": event_time.isoformat(),
             "bootId": boot_id, "resetNumber": int(match.group(1)), "cursor": cursor,
             "restartedUnits": restarted, "failedUnits": failures, "suppressedResets": 0}
    save(event)
    print(f"amdgpu reset {event['resetNumber']}: started {restarted}, failed {failures}", flush=True)
    return True


def main() -> int:
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
