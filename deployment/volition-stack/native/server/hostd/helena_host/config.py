"""The helper's configuration (/etc/helena/hostd.json, root's, written by the installer) and
its settings (/var/lib/helena/hostd/settings.json, changed through Helena). The config says
what exists on this machine (paths, callers, disks); the settings are the owner's choices
(schedule, retention, power profile, fans, the thermal limit)."""

from __future__ import annotations

import copy
import os
import re
from dataclasses import dataclass

from .common import HostError, atomic_write_json, json_load_file

DEFAULT_CONFIG_PATH = '/etc/helena/hostd.json'

DEFAULT_CONFIG: dict = {
    # Unix users that may call the helper (the API's user). Root always may.
    'callers': ['volition-plan'],
    'stateDir': '/var/lib/helena/hostd',
    'runDir': '/run/helena-hostd',
    'storage': {
        # The ESP mounts that must stay equal (the RAID layout mirrors the ESP by rsync).
        'espMounts': ['/boot/efi', '/boot/efi2'],
        # The firmware entry "Debian (Reserve)" boots from the second disk's ESP.
        'reserveBootLabel': 'Debian (Reserve)',
        # Partition labels name the disks: HELENA-RAID-A → "A".
        'diskLabelPattern': '^HELENA-(?:RAID|EFI)-([A-Z])$',
    },
    'power': {
        'ecRoot': '/sys/class/ec_su_axb35',
        # The board the EC driver is written for (DMI board_name); on any other board the
        # helper never writes into the EC, even when the module is loaded.
        'ecBoards': ['AXB35-02'],
        'ryzenadjPath': '/usr/local/sbin/ryzenadj',
        # Optional ryzenadj limits per profile ({"stapm": mW, "fast": mW, "slow": mW,
        # "tctl": °C}), applied after the EC mode, which resets them. null: the EC mode's own
        # limits stay (the default). Never above the EC mode's own limits (power.py).
        'overrides': {'saver': None, 'balanced': None, 'performance': None},
    },
    'backup': {
        'repository': '/var/backups/helena/restic',
        'passwordFile': '/etc/helena/backup/restic.password',
        'cacheDir': '/var/cache/helena-backup',
        'stagingDir': '/var/backups/helena/staging',
        'restoreDir': '/var/backups/helena/restores',
        # The owner's home: a folder restored from it lands in <home>/Wiederhergestellt.
        'ownerHome': None,
        'paths': [
            '/etc', '/root', '/srv/volition', '/var/lib/volition', '/var/lib/helena',
            '/var/lib/helena-limits', '/var/lib/helena-token-keeper', '/usr/local',
            '/boot/efi', '/var/backups/volition',
        ],
        'excludes': [],
        # SQLite files copied with the online backup API before the run (globs).
        'sqlite': [],
        # Every database of the local cluster, except test databases.
        'postgres': {'enabled': True, 'exclude': ['*_test', '*_test_*', '*_dev']},
    },
}

SCHEDULE_FREQUENCIES = ('off', 'hourly', 'every6h', 'daily')
PROFILES = ('saver', 'balanced', 'performance')
FAN_MODES = ('auto', 'fixed')

DEFAULT_SETTINGS: dict = {
    'backup': {
        'schedule': {'frequency': 'hourly', 'time': '03:15'},
        'retention': {'hourly': 24, 'daily': 7, 'weekly': 4, 'monthly': 12},
        'checkWeekly': True,
        'restoreTestMonthly': True,
    },
    # The profile and the fans as the owner last chose them; null until a first choice (the
    # installer of the fan control writes "fixed 5", the owner's first wish).
    'power': {'profile': None, 'fans': None},
    'guard': {'limit': 90, 'holdSeconds': 5, 'releaseBelow': 80, 'releaseSeconds': 120},
}

RETENTION_LIMITS = {'hourly': 168, 'daily': 90, 'weekly': 104, 'monthly': 120}
GUARD_LIMIT_RANGE = (70, 95)
TIME_RE = re.compile(r'^([01]\d|2[0-3]):([0-5]\d)$')


def _merge(base: dict, override: object) -> dict:
    result = copy.deepcopy(base)
    if isinstance(override, dict):
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = _merge(result[key], value)
            else:
                result[key] = copy.deepcopy(value)
    return result


@dataclass
class Config:
    data: dict
    path: str

    @property
    def callers(self) -> list[str]:
        return list(self.data.get('callers') or [])

    @property
    def state_dir(self) -> str:
        return self.data['stateDir']

    @property
    def run_dir(self) -> str:
        return self.data['runDir']

    @property
    def storage(self) -> dict:
        return self.data['storage']

    @property
    def power(self) -> dict:
        return self.data['power']

    @property
    def backup(self) -> dict:
        return self.data['backup']


def load_config(path: str = DEFAULT_CONFIG_PATH, *, require_root: bool = False) -> Config:
    raw = json_load_file(path, None) if os.path.exists(path) else {}
    if raw is None:
        raise HostError('Config', 'the configuration is not valid JSON')
    if require_root:
        info = os.stat(path) if os.path.exists(path) else None
        if info is not None and (info.st_uid != 0 or info.st_mode & 0o022):
            raise HostError('Config', 'the configuration must be root-owned and not writable by others')
    data = _merge(DEFAULT_CONFIG, raw)
    if not isinstance(data.get('callers'), list) or not all(isinstance(c, str) for c in data['callers']):
        raise HostError('Config', 'callers must be a list of user names')
    for key in ('stateDir', 'runDir'):
        if not isinstance(data.get(key), str) or not data[key].startswith('/'):
            raise HostError('Config', f'{key} must be an absolute path')
    return Config(data, path)


# ── Settings ─────────────────────────────────────────────────────────────────────────────

def settings_path(config: Config) -> str:
    return os.path.join(config.state_dir, 'settings.json')


def load_settings(config: Config) -> dict:
    return _merge(DEFAULT_SETTINGS, json_load_file(settings_path(config), {}))


def save_settings(config: Config, settings: dict) -> None:
    os.makedirs(config.state_dir, mode=0o700, exist_ok=True)
    atomic_write_json(settings_path(config), settings)


def validate_schedule(value: object) -> dict:
    if not isinstance(value, dict) or set(value) - {'frequency', 'time'}:
        raise HostError('InvalidParameter', 'schedule is invalid', parameter='schedule')
    frequency = value.get('frequency')
    if frequency not in SCHEDULE_FREQUENCIES:
        raise HostError('InvalidParameter', 'schedule.frequency is invalid', parameter='schedule')
    time_of_day = value.get('time', '03:15')
    if not isinstance(time_of_day, str) or not TIME_RE.match(time_of_day):
        raise HostError('InvalidParameter', 'schedule.time must be HH:MM', parameter='schedule')
    return {'frequency': frequency, 'time': time_of_day}


def validate_retention(value: object) -> dict:
    if not isinstance(value, dict) or set(value) - set(RETENTION_LIMITS):
        raise HostError('InvalidParameter', 'retention is invalid', parameter='retention')
    result = {}
    for key, limit in RETENTION_LIMITS.items():
        count = value.get(key, DEFAULT_SETTINGS['backup']['retention'][key])
        if not isinstance(count, int) or isinstance(count, bool) or not 0 <= count <= limit:
            raise HostError('InvalidParameter', f'retention.{key} must be 0–{limit}', parameter='retention')
        result[key] = count
    if not any(result.values()):
        # Keeping nothing would let `forget` remove every snapshot.
        raise HostError('InvalidParameter', 'retention must keep at least one snapshot', parameter='retention')
    return result


def on_calendar(schedule: dict) -> str | None:
    """The systemd OnCalendar= expression of a schedule, built here from the validated
    choice, never taken from a caller."""
    frequency = schedule['frequency']
    hour, minute = schedule['time'].split(':')
    if frequency == 'off':
        return None
    if frequency == 'hourly':
        return f'*-*-* *:{minute}:00'
    if frequency == 'every6h':
        first = int(hour) % 6
        hours = ','.join(f'{h:02d}' for h in range(first, 24, 6))
        return f'*-*-* {hours}:{minute}:00'
    return f'*-*-* {hour}:{minute}:00'
