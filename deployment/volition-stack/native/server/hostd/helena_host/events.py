"""Events of the machine for Helena's health overview: what mdadm's monitor and smartd report
(through their standard hooks: mdadm.conf's PROGRAM, smartd's run.d), what the thermal guard
did, and what a backup run ended with. Kept in a small append-only file, newest last; Helena
reads them and marks the ones it has shown as seen."""

from __future__ import annotations

import json
import os
import re

from .common import atomic_write_json, file_lock, iso, json_load_file

KEEP = 500
SEVERITIES = ('info', 'warning', 'critical')

# mdadm --monitor's events (mdadm(8), "MONITOR MODE").
MDADM_SEVERITY = {
    'Fail': 'critical',
    'FailSpare': 'critical',
    'DegradedArray': 'critical',
    'DeviceDisappeared': 'critical',
    'SparesMissing': 'warning',
    'MoveSpare': 'info',
    'SpareActive': 'info',
    'NewArray': 'info',
    'RebuildStarted': 'info',
    'RebuildFinished': 'info',
    'TestMessage': 'info',
}
# smartd's SMARTD_FAILTYPE values (smartd.conf(5), "-M exec").
SMARTD_CRITICAL = {
    'Health', 'FailedHealthCheck', 'SelfTest', 'CurrentPendingSector', 'OfflineUncorrectableSector',
}
PRINTABLE = re.compile('[^\\x20-\\x7e\\u00a0-\\uffff]')


def _clean(value: object, limit: int = 300) -> str:
    text = PRINTABLE.sub(' ', str(value or '')).strip()
    return text[:limit]


def _path(state_dir: str) -> str:
    return os.path.join(state_dir, 'events.json')


def _lock(state_dir: str) -> str:
    return os.path.join(state_dir, 'events.lock')


def read_all(state_dir: str) -> dict:
    data = json_load_file(_path(state_dir), None)
    if not isinstance(data, dict) or not isinstance(data.get('events'), list):
        data = {'nextId': 1, 'seenUpTo': 0, 'events': []}
    return data


def record(state_dir: str, *, source: str, severity: str, code: str, device: str | None = None,
           message: str | None = None, at: float) -> dict:
    """Appends one event and returns it."""
    if severity not in SEVERITIES:
        severity = 'warning'
    os.makedirs(state_dir, mode=0o700, exist_ok=True)
    with file_lock(_lock(state_dir)):
        data = read_all(state_dir)
        event = {
            'id': int(data.get('nextId') or 1),
            'at': iso(at),
            'source': _clean(source, 32),
            'severity': severity,
            'code': _clean(code, 64),
            'device': _clean(device, 64) or None,
            'message': _clean(message) or None,
        }
        data['nextId'] = event['id'] + 1
        data['events'] = (data['events'] + [event])[-KEEP:]
        atomic_write_json(_path(state_dir), data)
    return event


def listing(state_dir: str, *, limit: int = 100) -> dict:
    data = read_all(state_dir)
    events = data['events'][-limit:]
    seen = int(data.get('seenUpTo') or 0)
    return {
        'events': list(reversed(events)),
        'seenUpTo': seen,
        'unseen': sum(1 for event in data['events'] if event['id'] > seen),
        'unseenCritical': sum(1 for event in data['events']
                              if event['id'] > seen and event['severity'] == 'critical'),
    }


def mark_seen(state_dir: str, up_to: int) -> int:
    with file_lock(_lock(state_dir)):
        data = read_all(state_dir)
        last = int(data.get('nextId') or 1) - 1
        data['seenUpTo'] = max(int(data.get('seenUpTo') or 0), min(up_to, last))
        atomic_write_json(_path(state_dir), data)
        return data['seenUpTo']


def from_mdadm(args: list[str]) -> dict:
    """mdadm runs PROGRAM with: event, md device[, component device]."""
    event = args[0] if args else 'Unknown'
    device = args[1] if len(args) > 1 else None
    component = args[2] if len(args) > 2 else None
    severity = MDADM_SEVERITY.get(event, 'warning')
    if re.match(r'^Rebuild\d+$', event):
        severity = 'info'
    return {
        'source': 'mdadm',
        'severity': severity,
        'code': event,
        'device': device,
        # The event and the array are the code and the device; the component is the rest.
        'message': component,
    }


def from_smartd(env: dict[str, str]) -> dict:
    failtype = env.get('SMARTD_FAILTYPE', 'Unknown')
    if failtype == 'EmailTest':
        severity = 'info'
    elif failtype in SMARTD_CRITICAL:
        severity = 'critical'
    else:
        severity = 'warning'
    return {
        'source': 'smartd',
        'severity': severity,
        'code': failtype,
        'device': env.get('SMARTD_DEVICE'),
        'message': env.get('SMARTD_MESSAGE') or env.get('SMARTD_FULLMESSAGE'),
    }


def as_json_line(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False)
