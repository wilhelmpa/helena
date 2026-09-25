"""The audit log of every change hostd makes to the machine (/var/lib/helena/hostd/audit.log,
one JSON object per line, never a secret), shared by the Varlink methods and the console
commands (boot-repair, esp-sync). Each line also goes to the journal through `log`."""

from __future__ import annotations

import json
import os
import threading
from typing import Callable

from .common import Host, iso

AUDIT_MAX = 1_048_576
_lock = threading.Lock()


def now_iso(host: Host) -> str | None:
    return iso(host.now())


def append(state_dir: str, entry: dict, log: Callable[[str], None]) -> None:
    line = json.dumps(entry, ensure_ascii=False, separators=(',', ':'))
    log(f'audit {line}')
    path = os.path.join(state_dir, 'audit.log')
    with _lock:
        try:
            os.makedirs(state_dir, mode=0o700, exist_ok=True)
            if os.path.exists(path) and os.path.getsize(path) > AUDIT_MAX:
                os.replace(path, path + '.1')
            fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            with os.fdopen(fd, 'a', encoding='utf-8') as handle:
                handle.write(line + '\n')
        except OSError as failure:
            log(f'could not write the audit log: {failure}')
