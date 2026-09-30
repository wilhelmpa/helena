"""Backups with restic (docs/helena-decisions/server-admin.md §4).

A local repository on the RAID, encrypted with a generated password only root can read. The
owner is shown that password once in Helena to write it down; after he confirms, Helena never
shows it again. A backup run dumps every database with pg_dump (a consistent MVCC snapshot,
uncompressed so restic deduplicates it) and copies the SQLite files named in the config with
SQLite's online backup, then backs up the configured folders, forgets old snapshots by the
owner's retention and, when offsite targets are set, copies the new snapshot there.
Weekly: prune and a check that reads a sample of the data. Monthly: a restore test (a sample
of files and the database dumps into a scratch database).

Runs as systemd units (helena-backup*.service); the helper only starts them, lists snapshots
and folders, and starts restores into a safe place."""

from __future__ import annotations

import fnmatch
import glob
import json
import os
import pwd
import random
import re
import secrets
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import time
from datetime import datetime

from . import events
from .common import Host, HostError, atomic_write_json, atomic_write_text, clip, file_lock, iso, json_load_file
from .config import (Config, load_settings, on_calendar, save_settings, validate_retention,
                     validate_schedule)

SNAPSHOT_ID = re.compile(r'^(?:latest|[0-9a-f]{8,64})$')
TARGET_ID = re.compile(r'^[a-z][a-z0-9-]{0,31}$')
S3_REPOSITORY = re.compile(r'^s3:https://[A-Za-z0-9.-]+(?::\d{1,5})?/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._/-]*)?$')
S3_KEY_ID = re.compile(r'^[A-Za-z0-9+/=_-]{4,128}$')
S3_SECRET = re.compile(r'^[\x21-\x7e]{8,256}$')
RESTORE_ID = re.compile(r'^[0-9]{14}-[0-9a-f]{6}$')
UNITS = {
    'backup': 'helena-backup.service',
    'maintenance': 'helena-backup-maintenance.service',
    'restore-test': 'helena-backup-restore-test.service',
}
TIMERS = {
    'backup': 'helena-backup.timer',
    'maintenance': 'helena-backup-maintenance.timer',
    'restore-test': 'helena-backup-restore-test.timer',
}
SCHEDULE_DROPIN = '/etc/systemd/system/helena-backup.timer.d/helena-schedule.conf'
LIST_LIMIT = 2000
TAG = 'helena'
SCRATCH_DB = 'helena_restore_test'
HISTORY = 100

DEFAULT_EXCLUDES = [
    # Rebuilt by the tools themselves.
    'node_modules', '.next', '.turbo', '__pycache__', '.cache',
    '*/Default/Cache', '*/Default/Code Cache', '*/Default/GPUCache', '*/Default/DawnCache',
    '*/Default/DawnGraphiteCache', '*/Default/DawnWebGPUCache', '*/Default/Service Worker/CacheStorage',
    '*/ShaderCache', '*/GrShaderCache', '*/GraphiteDawnCache',
    '/home/*/.local/share/Trash', '/home/*/.bun/install/cache', '/home/*/.npm/_cacache',
    # The agents' own test clusters and clones: regenerable, and constantly changing.
    '/home/*/agent-work',
    # The databases are dumped consistently; their live files are not copied.
    '/var/lib/postgresql',
]


# ── Paths and state ─────────────────────────────────────────────────────────────────────

def _state(config: Config, name: str) -> str:
    return os.path.join(config.state_dir, 'backup', name)


def restic_env(config: Config) -> dict[str, str]:
    backup = config.backup
    return {
        'RESTIC_REPOSITORY': backup['repository'],
        'RESTIC_PASSWORD_FILE': backup['passwordFile'],
        'RESTIC_CACHE_DIR': backup['cacheDir'],
        'RESTIC_PROGRESS_FPS': '0.2',
    }


def installed(host: Host, config: Config) -> bool:
    return host.which('restic') is not None and os.path.exists(config.backup['passwordFile'])


def initialized(config: Config) -> bool:
    return os.path.exists(os.path.join(config.backup['repository'], 'config'))


def _restic(host: Host, config: Config, args: list[str], *, timeout: float = 120,
            env: dict[str, str] | None = None, stdout_path: str | None = None):
    restic = host.which('restic')
    if not restic:
        raise HostError('NotAvailable', 'restic is not installed')
    return host.run([restic, *args], timeout=timeout, env={**restic_env(config), **(env or {})},
                    **({'stdout_path': stdout_path} if stdout_path is not None else {}))


def unit_active(host: Host, unit: str) -> bool:
    systemctl = host.which('systemctl')
    if not systemctl:
        return False
    return host.run([systemctl, 'is-active', '--quiet', unit], timeout=10).returncode == 0


def timer_next(host: Host, timer: str) -> str | None:
    """When the timer fires next. `systemctl list-timers --output=json` gives it in
    microseconds on every systemd with JSON output; `show --timestamp=unix` is only a
    fallback: systemd 257 (Debian 13) prints NextElapseUSecRealtime as a local date there,
    which left every "next" empty."""
    systemctl = host.which('systemctl')
    if not systemctl:
        return None
    result = host.run([systemctl, 'list-timers', '--all', '--output=json', '--no-pager', timer], timeout=10)
    try:
        rows = json.loads(result.stdout) if result.returncode == 0 and result.stdout.strip() else []
    except ValueError:
        rows = []
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and row.get('unit') == timer:
            usec = row.get('next')
            if isinstance(usec, (int, float)) and usec > 0:
                return iso(int(usec) // 1_000_000)
            return None
    result = host.run([systemctl, 'show', timer, '-p', 'NextElapseUSecRealtime', '--timestamp=unix'], timeout=10)
    match = re.search(r'=@(\d+)', result.stdout)
    return iso(int(match.group(1))) if match else None


def password_state(config: Config) -> str:
    if not os.path.exists(config.backup['passwordFile']):
        return 'missing'
    return 'acknowledged' if os.path.exists(_state(config, 'password-acknowledged')) else 'unrevealed'


def status(host: Host, config: Config) -> dict:
    settings = load_settings(config)
    backup_settings = settings['backup']
    last = {kind: json_load_file(_state(config, f'last-{kind}.json'), None)
            for kind in ('backup', 'maintenance', 'restore-test')}
    return {
        'installed': installed(host, config),
        'initialized': initialized(config),
        'repository': config.backup['repository'],
        'passwordState': password_state(config),
        'schedule': backup_settings['schedule'],
        'retention': backup_settings['retention'],
        'checkWeekly': backup_settings['checkWeekly'],
        'restoreTestMonthly': backup_settings['restoreTestMonthly'],
        'running': {kind: unit_active(host, unit) for kind, unit in UNITS.items()},
        'next': {kind: timer_next(host, timer) for kind, timer in TIMERS.items()},
        'last': last,
        'targets': public_targets(backup_settings.get('targets') or []),
        'paths': configured_paths(config),
        # A copy of the owner's own files lands in <ownerHome>/Wiederhergestellt.
        'ownerHome': config.backup.get('ownerHome'),
    }


def configured_paths(config: Config) -> list[str]:
    paths = list(config.backup.get('paths') or [])
    home = config.backup.get('ownerHome')
    if home and home not in paths:
        paths.append(home)
    return paths


def history(config: Config) -> list[dict]:
    value = json_load_file(_state(config, 'history.json'), [])
    return value if isinstance(value, list) else []


def _record(config: Config, kind: str, result: dict) -> None:
    os.makedirs(_state(config, ''), mode=0o700, exist_ok=True)
    atomic_write_json(_state(config, f'last-{kind}.json'), result)
    with file_lock(_state(config, 'history.lock')):
        entries = history(config)
        entries.append({'kind': kind, **{k: result.get(k) for k in (
            'ok', 'warning', 'startedAt', 'finishedAt', 'snapshot', 'dataAddedBytes', 'error')}})
        atomic_write_json(_state(config, 'history.json'), entries[-HISTORY:])


# ── What the helper answers ─────────────────────────────────────────────────────────────

def snapshots(host: Host, config: Config) -> list[dict]:
    if not initialized(config):
        return []
    result = _restic(host, config, ['snapshots', '--json', '--no-lock', '--tag', TAG], timeout=120)
    if result.returncode != 0:
        raise HostError('CommandFailed', 'restic could not list the snapshots')
    try:
        items = json.loads(result.stdout or '[]') or []
    except ValueError:
        raise HostError('CommandFailed', 'restic answered something unexpected') from None
    out = []
    for item in items:
        summary = item.get('summary') or {}
        out.append({
            'id': item.get('id'),
            'shortId': item.get('short_id') or (item.get('id') or '')[:8],
            'time': item.get('time'),
            'hostname': item.get('hostname'),
            'paths': item.get('paths') or [],
            'tags': item.get('tags') or [],
            'filesTotal': summary.get('total_files_processed'),
            'bytesTotal': summary.get('total_bytes_processed'),
            'dataAddedBytes': summary.get('data_added'),
        })
    out.sort(key=lambda snapshot: snapshot.get('time') or '', reverse=True)
    return out


def vault_integrity(host: Host, config: Config) -> dict:
    """Return only Vault coverage and a restore probe, never file contents or credentials."""
    vault = '/srv/volition/vault'
    try:
        if load_settings(config)['backup']['schedule']['frequency'] == 'off':
            return {'state': 'disabled'}
        if not installed(host, config):
            return {'state': 'unavailable'}
        items = snapshots(host, config)
        if not items:
            return {'state': 'no_snapshot'}
        latest = items[0]
        timestamp = datetime.fromisoformat(latest['time'].replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            raise ValueError('snapshot time has no timezone')
        if host.now() - timestamp.timestamp() > 36 * 3600:
            return {'state': 'stale'}
        snapshot = _check_snapshot(latest['id'])
        listing = _restic(host, config, ['ls', '--json', '--no-lock', snapshot, vault], timeout=180)
        if listing.returncode != 0:
            return {'state': 'error'}
        nodes = [json.loads(line) for line in listing.stdout.splitlines() if line]
        nodes = [node for node in nodes
                 if node.get('struct_type', node.get('message_type')) == 'node'
                 and isinstance(node.get('path'), str)
                 and (node['path'] == vault or node['path'].startswith(vault + '/'))]
        samples = [node for node in nodes if node.get('type') == 'file' and node.get('size', 0) > 0
                   and '/.git/' not in node['path'] and '/.trash/' not in node['path']]
        sample_ok = False
        if samples:
            sample = min(samples, key=lambda node: node['size'])
            path = _check_path(sample['path'])
            with tempfile.TemporaryDirectory(prefix='volition-vault-probe-') as directory:
                restored = os.path.join(directory, 'sample')
                result = _restic(host, config, ['dump', '--no-lock', snapshot, path],
                                 timeout=180, stdout_path=restored)
                sample_ok = result.returncode == 0 and os.path.getsize(restored) == sample['size']
        return {'state': 'ok', 'vault_present': bool(nodes),
                'private_present': any(node['path'].startswith(vault + '/Private/')
                                       or (node['path'] == vault + '/Private' and node.get('type') == 'dir')
                                       for node in nodes),
                'sample_ok': sample_ok}
    except (HostError, OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired):
        return {'state': 'error'}


def _check_path(path: object, name: str = 'path') -> str:
    if not isinstance(path, str) or not path.startswith('/') or len(path) > 4096 or '\x00' in path:
        raise HostError('InvalidParameter', f'{name} must be an absolute path', parameter=name)
    parts = path.split('/')
    if any(part in ('.', '..') for part in parts):
        raise HostError('InvalidParameter', f'{name} must not contain . or ..', parameter=name)
    normalized = os.path.normpath(path)
    return normalized


def _check_snapshot(snapshot: object) -> str:
    if not isinstance(snapshot, str) or not SNAPSHOT_ID.match(snapshot):
        raise HostError('InvalidParameter', 'snapshot is invalid', parameter='snapshot')
    return snapshot


def list_dir(host: Host, config: Config, snapshot: object, path: object) -> dict:
    snapshot = _check_snapshot(snapshot)
    path = _check_path(path)
    result = _restic(host, config, ['ls', '--json', '--no-lock', snapshot, path], timeout=180)
    if result.returncode != 0:
        raise HostError('NotFound', 'the snapshot or the folder was not found')
    entries = []
    truncated = False
    for line in result.stdout.splitlines():
        try:
            node = json.loads(line)
        except ValueError:
            continue
        if node.get('struct_type', node.get('message_type')) not in ('node', None) or 'path' not in node:
            continue
        node_path = node['path']
        if node_path == path or os.path.dirname(node_path) != path:
            continue
        if len(entries) >= LIST_LIMIT:
            truncated = True
            break
        entries.append({
            'name': node.get('name'),
            'path': node_path,
            'type': node.get('type'),
            'size': node.get('size'),
            'mtime': node.get('mtime'),
        })
    entries.sort(key=lambda entry: (entry['type'] != 'dir', (entry['name'] or '').lower()))
    return {'snapshot': snapshot, 'path': path, 'entries': entries, 'truncated': truncated}


def run(host: Host, kind: object) -> dict:
    if kind not in UNITS:
        raise HostError('InvalidParameter', 'kind must be backup, maintenance or restore-test', parameter='kind')
    if unit_active(host, UNITS[kind]):
        raise HostError('Busy', 'it is running already')
    systemctl = host.which('systemctl')
    result = host.run([systemctl, 'start', '--no-block', UNITS[kind]], timeout=15)
    if result.returncode != 0:
        raise HostError('CommandFailed', 'systemd could not start it')
    return {'kind': kind, 'started': True}


def set_settings(host: Host, config: Config, params: dict) -> dict:
    settings = load_settings(config)
    backup = settings['backup']
    if 'schedule' in params:
        backup['schedule'] = validate_schedule(params['schedule'])
    if 'retention' in params:
        backup['retention'] = validate_retention(params['retention'])
    for key in ('checkWeekly', 'restoreTestMonthly'):
        if key in params:
            if not isinstance(params[key], bool):
                raise HostError('InvalidParameter', f'{key} must be true or false', parameter=key)
            backup[key] = params[key]
    save_settings(config, settings)
    apply_schedule(host, config, backup)
    return {'schedule': backup['schedule'], 'retention': backup['retention'],
            'checkWeekly': backup['checkWeekly'], 'restoreTestMonthly': backup['restoreTestMonthly']}


def apply_schedule(host: Host, config: Config, backup: dict) -> None:
    """Writes the timer's schedule (a drop-in built from the validated choice) and switches
    the timers on or off."""
    systemctl = host.which('systemctl')
    calendar = on_calendar(backup['schedule'])
    dropin = host.path(SCHEDULE_DROPIN)
    os.makedirs(os.path.dirname(dropin), exist_ok=True)
    atomic_write_text(dropin, '# Written by helena-hostd from the schedule chosen in Helena.\n'
                      '[Timer]\nOnCalendar=\n' + (f'OnCalendar={calendar}\n' if calendar else ''))
    if not systemctl:
        return
    host.run([systemctl, 'daemon-reload'], timeout=60)
    ready = installed(host, config)
    for kind, timer in TIMERS.items():
        enabled = ready and (calendar is not None if kind == 'backup' else
                             True if kind == 'maintenance' else backup['restoreTestMonthly'])
        host.run([systemctl, 'enable' if enabled else 'disable', '--now', timer], timeout=30)


def reveal_password(config: Config) -> dict:
    state = password_state(config)
    if state == 'missing':
        raise HostError('NotAvailable', 'the backup has no password yet')
    if state == 'acknowledged':
        raise HostError('NotAllowed', 'the password was already written down')
    with open(config.backup['passwordFile'], encoding='utf-8') as handle:
        password = handle.read(512).strip()
    return {'password': password}


def acknowledge_password(config: Config) -> dict:
    if password_state(config) == 'missing':
        raise HostError('NotAvailable', 'the backup has no password yet')
    os.makedirs(_state(config, ''), mode=0o700, exist_ok=True)
    atomic_write_text(_state(config, 'password-acknowledged'), iso(time.time()) + '\n', 0o600)
    return {'passwordState': 'acknowledged'}


# ── Offsite targets (behind a flag in Helena) ───────────────────────────────────────────

def public_targets(targets: list) -> list[dict]:
    return [{key: target.get(key) for key in ('id', 'kind', 'repository', 'enabled', 'lastCopy')}
            for target in targets if isinstance(target, dict)]


def target_env_path(config: Config, target_id: str) -> str:
    return os.path.join(os.path.dirname(config.backup['passwordFile']), 'targets', f'{target_id}.env')


def set_target(config: Config, params: dict) -> dict:
    target_id = params.get('id')
    if not isinstance(target_id, str) or not TARGET_ID.match(target_id):
        raise HostError('InvalidParameter', 'id is invalid', parameter='id')
    if params.get('kind') != 's3':
        raise HostError('InvalidParameter', 'kind must be s3', parameter='kind')
    repository = params.get('repository')
    if not isinstance(repository, str) or not S3_REPOSITORY.match(repository):
        raise HostError('InvalidParameter', 'repository must be s3:https://host/bucket[/prefix]', parameter='repository')
    enabled = params.get('enabled', True)
    if not isinstance(enabled, bool):
        raise HostError('InvalidParameter', 'enabled must be true or false', parameter='enabled')
    credentials = params.get('credentials')
    settings = load_settings(config)
    targets = [t for t in settings['backup'].get('targets') or [] if isinstance(t, dict)]
    existing = next((t for t in targets if t.get('id') == target_id), None)
    if credentials is not None:
        if not isinstance(credentials, dict) or set(credentials) != {'accessKeyId', 'secretAccessKey'}:
            raise HostError('InvalidParameter', 'credentials are invalid', parameter='credentials')
        if not S3_KEY_ID.match(str(credentials['accessKeyId'])) or not S3_SECRET.match(str(credentials['secretAccessKey'])):
            raise HostError('InvalidParameter', 'credentials are invalid', parameter='credentials')
        path = target_env_path(config, target_id)
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        atomic_write_text(path, f"AWS_ACCESS_KEY_ID={credentials['accessKeyId']}\n"
                          f"AWS_SECRET_ACCESS_KEY={credentials['secretAccessKey']}\n", 0o600)
    elif existing is None:
        raise HostError('InvalidParameter', 'a new target needs credentials', parameter='credentials')
    target = {'id': target_id, 'kind': 's3', 'repository': repository, 'enabled': enabled,
              'lastCopy': (existing or {}).get('lastCopy')}
    settings['backup']['targets'] = [t for t in targets if t.get('id') != target_id] + [target]
    save_settings(config, settings)
    return public_targets([target])[0]


def remove_target(config: Config, target_id: object) -> dict:
    if not isinstance(target_id, str) or not TARGET_ID.match(target_id):
        raise HostError('InvalidParameter', 'id is invalid', parameter='id')
    settings = load_settings(config)
    settings['backup']['targets'] = [t for t in settings['backup'].get('targets') or []
                                     if isinstance(t, dict) and t.get('id') != target_id]
    save_settings(config, settings)
    try:
        os.unlink(target_env_path(config, target_id))
    except FileNotFoundError:
        pass
    return {'removed': target_id}


def _read_env_file(path: str) -> dict[str, str]:
    values = {}
    with open(path, encoding='utf-8') as handle:
        for line in handle.read(8192).splitlines():
            name, sep, value = line.partition('=')
            if sep and name in ('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'):
                values[name] = value
    return values


# ── Restores ─────────────────────────────────────────────────────────────────────────────

def _restores_dir(config: Config) -> str:
    return _state(config, 'restores')


def start_restore(host: Host, config: Config, params: dict) -> dict:
    snapshot = _check_snapshot(params.get('snapshot'))
    path = _check_path(params.get('path'))
    mode = params.get('mode', 'copy')
    if mode not in ('copy', 'original'):
        raise HostError('InvalidParameter', 'mode must be copy or original', parameter='mode')
    if mode == 'original':
        # The second confirmation: the caller repeats the path it restores over.
        if params.get('confirm') != path:
            raise HostError('NotAllowed', 'restoring in place needs the path confirmed', parameter='confirm')
        parent = os.path.dirname(path)
        expected = os.path.join(os.path.realpath(host.root), parent.lstrip('/'))
        if path == '/' or os.path.realpath(host.path(parent)) != os.path.normpath(expected):
            raise HostError('NotAllowed', 'the folder above the path must not be a link')
    listing = list_dir(host, config, snapshot, os.path.dirname(path) or '/')
    if path != '/' and not any(entry['path'] == path for entry in listing['entries']):
        raise HostError('NotFound', 'the path is not in the snapshot')
    restore_id = time.strftime('%Y%m%d%H%M%S', time.gmtime(host.now())) + '-' + secrets.token_hex(3)
    job = {'id': restore_id, 'snapshot': snapshot, 'path': path, 'mode': mode,
           'actor': params.get('actor'), 'state': 'queued', 'createdAt': iso(host.now())}
    os.makedirs(_restores_dir(config), mode=0o700, exist_ok=True)
    atomic_write_json(os.path.join(_restores_dir(config), f'{restore_id}.json'), job)
    systemd_run = host.which('systemd-run')
    if not systemd_run:
        raise HostError('NotAvailable', 'systemd-run is missing')
    entry = host.extra.get('entry', '/usr/local/lib/helena/hostd/helena-hostd')
    result = host.run([systemd_run, '--no-block', '--collect', f'--unit=helena-restore-{restore_id}',
                       '--property=Nice=10', '--property=IOSchedulingClass=idle',
                       '/usr/bin/python3', '-I', str(entry), 'backup', 'restore', restore_id], timeout=30)
    if result.returncode != 0:
        job.update(state='failed', error='systemd could not start the restore')
        atomic_write_json(os.path.join(_restores_dir(config), f'{restore_id}.json'), job)
        raise HostError('CommandFailed', 'systemd could not start the restore')
    return job


def restore_status(config: Config, restore_id: object) -> dict:
    if not isinstance(restore_id, str) or not RESTORE_ID.match(restore_id):
        raise HostError('InvalidParameter', 'id is invalid', parameter='id')
    job = json_load_file(os.path.join(_restores_dir(config), f'{restore_id}.json'), None)
    if not isinstance(job, dict):
        raise HostError('NotFound', 'no such restore')
    return job


def list_restores(config: Config, limit: int = 20) -> list[dict]:
    directory = _restores_dir(config)
    jobs = []
    for name in sorted(os.listdir(directory) if os.path.isdir(directory) else [], reverse=True)[:limit]:
        job = json_load_file(os.path.join(directory, name), None)
        if isinstance(job, dict):
            jobs.append(job)
    return jobs


def _owner_account(config: Config) -> pwd.struct_passwd | None:
    home = config.backup.get('ownerHome')
    if not home:
        return None
    for account in pwd.getpwall():
        if account.pw_dir == home:
            return account
    return None


def _fresh_dir(parent_fd: int, name: str, uid: int, gid: int, mode: int) -> int:
    """Creates `name` below an open directory, refusing a link, and returns its fd."""
    try:
        os.mkdir(name, mode, dir_fd=parent_fd)
    except FileExistsError:
        pass
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent_fd)
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, uid):
        os.close(fd)
        raise HostError('NotAllowed', 'the restore folder is not a plain folder')
    os.fchown(fd, uid, gid)
    os.fchmod(fd, mode)
    return fd


def restore_target(config: Config, path: str, stamp: str) -> str:
    """Where a copy lands: below the owner's home for his own files (he can open them
    there), in the root-only restore folder for everything else. The folder is new, so
    nothing in it can be a link planted before."""
    owner = _owner_account(config)
    home = config.backup.get('ownerHome')
    if owner and home and (path == home or path.startswith(home + '/')):
        home_fd = os.open(home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            base_fd = _fresh_dir(home_fd, 'Wiederhergestellt', owner.pw_uid, owner.pw_gid, 0o700)
            try:
                os.mkdir(stamp, 0o700, dir_fd=base_fd)
                os.chown(stamp, owner.pw_uid, owner.pw_gid, dir_fd=base_fd, follow_symlinks=False)
            finally:
                os.close(base_fd)
        finally:
            os.close(home_fd)
        return os.path.join(home, 'Wiederhergestellt', stamp)
    base = config.backup['restoreDir']
    os.makedirs(base, mode=0o700, exist_ok=True)
    target = os.path.join(base, stamp)
    os.mkdir(target, 0o700)
    return target


def perform_restore(host: Host, config: Config, restore_id: str) -> dict:
    job_path = os.path.join(_restores_dir(config), f'{restore_id}.json')
    job = restore_status(config, restore_id)
    job.update(state='running', startedAt=iso(host.now()))
    atomic_write_json(job_path, job)
    try:
        path = job['path']
        stamp = time.strftime('%Y-%m-%d_%H-%M-%S', time.localtime(host.now()))
        if job['mode'] == 'copy':
            target = restore_target(config, path, stamp)
            result = _restic(host, config, ['restore', job['snapshot'], '--target', target,
                                            '--include', path, '--verify'], timeout=6 * 3600)
            job['location'] = os.path.join(target, path.lstrip('/'))
        else:
            aside = None
            if os.path.lexists(host.path(path)):
                aside = f'{path}.vor-wiederherstellung-{stamp}'
                os.rename(host.path(path), host.path(aside))
            result = _restic(host, config, ['restore', job['snapshot'], '--target', '/',
                                            '--include', path, '--verify'], timeout=6 * 3600)
            job['location'] = path
            job['movedAside'] = aside
        if result.returncode != 0:
            raise HostError('CommandFailed', clip(result.stderr, 500) or 'restic could not restore')
        job.update(state='done', finishedAt=iso(host.now()))
    except (HostError, OSError) as error:
        job.update(state='failed', finishedAt=iso(host.now()),
                   error=error.message if isinstance(error, HostError) else str(error))
    atomic_write_json(job_path, job)
    return job


# ── The jobs (systemd units) ───────────────────────────────────────────────────────────

def ensure_initialized(host: Host, config: Config) -> dict:
    """Installer step: the password (generated once, root's alone) and the repository."""
    backup = config.backup
    password_file = backup['passwordFile']
    os.makedirs(os.path.dirname(password_file), mode=0o700, exist_ok=True)
    created_password = False
    if not os.path.exists(password_file):
        fd = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(secrets.token_urlsafe(32) + '\n')
        created_password = True
    for key, mode in (('repository', 0o700), ('cacheDir', 0o700), ('stagingDir', 0o700), ('restoreDir', 0o700)):
        os.makedirs(backup[key], mode=mode, exist_ok=True)
        os.chmod(backup[key], mode)
    created_repo = False
    if not initialized(config):
        result = _restic(host, config, ['init', '--repository-version', '2'], timeout=120)
        if result.returncode != 0:
            raise HostError('CommandFailed', clip(result.stderr, 300) or 'restic init failed')
        created_repo = True
    return {'passwordCreated': created_password, 'repositoryCreated': created_repo}


def _databases(host: Host, exclude: list[str]) -> list[str]:
    runuser, psql = host.which('runuser'), host.which('psql')
    if not runuser or not psql:
        return []
    result = host.run([runuser, '-u', 'postgres', '--', psql, '-XAtc',
                       'select datname from pg_database where datallowconn and not datistemplate order by 1'],
                      timeout=60)
    if result.returncode != 0:
        raise HostError('CommandFailed', 'could not list the databases: ' + clip(result.stderr, 200))
    names = [line.strip() for line in result.stdout.splitlines() if re.match(r'^[A-Za-z0-9_.-]{1,63}$', line.strip())]
    return [name for name in names if not any(fnmatch.fnmatchcase(name, pattern) for pattern in exclude)]


def dump_postgres(host: Host, staging: str, exclude: list[str]) -> list[dict]:
    runuser = host.which('runuser')
    pg_dump, pg_dumpall = host.which('pg_dump'), host.which('pg_dumpall')
    if not runuser or not pg_dump or not pg_dumpall:
        return []
    directory = os.path.join(staging, 'postgres')
    os.makedirs(directory, mode=0o700, exist_ok=True)
    dumps = []
    globals_path = os.path.join(directory, 'globals.sql')
    result = host.run([runuser, '-u', 'postgres', '--', pg_dumpall, '--globals-only'],
                      timeout=300, stdout_path=globals_path)
    if result.returncode != 0:
        raise HostError('CommandFailed', 'pg_dumpall failed: ' + clip(result.stderr, 200))
    for database in _databases(host, exclude):
        path = os.path.join(directory, f'{database}.dump')
        # Custom format without compression: restic compresses, and unchanged tables stay
        # byte-identical between runs, so they deduplicate.
        result = host.run([runuser, '-u', 'postgres', '--', pg_dump, '--format=custom',
                           '--compress=0', database], timeout=3 * 3600, stdout_path=path)
        if result.returncode != 0:
            raise HostError('CommandFailed', f'pg_dump of {database} failed: ' + clip(result.stderr, 200))
        dumps.append({'database': database, 'bytes': os.path.getsize(path)})
    return dumps


def copy_sqlite(patterns: list[str], staging: str) -> list[str]:
    """SQLite files copied with SQLite's online backup, so a file in the middle of a write
    is still copied consistently."""
    copied = []
    directory = os.path.join(staging, 'sqlite')
    for pattern in patterns:
        for source in sorted(glob.glob(pattern, recursive=True)):
            if os.path.islink(source) or not os.path.isfile(source):
                continue
            target = os.path.join(directory, source.lstrip('/'))
            os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
            try:
                src = sqlite3.connect(f'file:{source}?mode=ro', uri=True, timeout=30)
                try:
                    dst = sqlite3.connect(target)
                    try:
                        src.backup(dst)
                    finally:
                        dst.close()
                finally:
                    src.close()
                copied.append(source)
            except sqlite3.Error:
                continue
    return copied


def _exclude_file(config: Config, staging: str) -> str:
    patterns = DEFAULT_EXCLUDES + list(config.backup.get('excludes') or [])
    # Never the repository itself, its cache, the restores, or the password.
    patterns += [config.backup['repository'], config.backup['cacheDir'], config.backup['restoreDir'],
                 config.backup['passwordFile'], os.path.join(os.path.dirname(config.backup['passwordFile']), 'targets')]
    path = os.path.join(staging, '..', 'exclude.txt')
    atomic_write_text(os.path.normpath(path), '\n'.join(patterns) + '\n', 0o600)
    return os.path.normpath(path)


def _summary(output: str) -> dict:
    summary: dict = {}
    errors = 0
    for line in output.splitlines():
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if message.get('message_type') == 'summary':
            summary = message
        elif message.get('message_type') == 'error':
            errors += 1
    summary['errorCount'] = errors
    return summary


def _retention_args(retention: dict) -> list[str]:
    args = []
    for key in ('hourly', 'daily', 'weekly', 'monthly'):
        if retention.get(key):
            args.append(f'--keep-{key}={retention[key]}')
    return args


def job_backup(host: Host, config: Config) -> dict:
    settings = load_settings(config)
    started = host.now()
    result: dict = {'ok': False, 'startedAt': iso(started)}
    staging = config.backup['stagingDir']
    with file_lock(os.path.join(config.run_dir, 'backup.lock'), blocking=False) as taken:
        if not taken:
            raise HostError('Busy', 'another backup job is running')
        try:
            shutil.rmtree(staging, ignore_errors=True)
            os.makedirs(staging, mode=0o700)
            postgres = config.backup.get('postgres') or {}
            if postgres.get('enabled', True):
                result['databases'] = dump_postgres(host, staging, list(postgres.get('exclude') or []))
            result['sqlite'] = len(copy_sqlite(list(config.backup.get('sqlite') or []), staging))
            paths = [path for path in configured_paths(config) if os.path.exists(path)] + [staging]
            excludes = _exclude_file(config, staging)
            backup = _restic(host, config, ['backup', '--json', '--tag', TAG, '--exclude-caches',
                                            f'--exclude-file={excludes}', *paths], timeout=12 * 3600)
            summary = _summary(backup.stdout)
            if backup.returncode not in (0, 3):
                raise HostError('CommandFailed', clip(backup.stderr, 500) or 'restic backup failed')
            result.update({
                'snapshot': summary.get('snapshot_id'),
                'filesNew': summary.get('files_new'),
                'filesChanged': summary.get('files_changed'),
                'filesTotal': summary.get('total_files_processed'),
                'bytesTotal': summary.get('total_bytes_processed'),
                'dataAddedBytes': summary.get('data_added'),
                'dataAddedPackedBytes': summary.get('data_added_packed'),
                # Exit 3: the snapshot exists, but some files could not be read.
                'warning': 'unreadable_files' if backup.returncode == 3 else None,
                'unreadable': summary.get('errorCount') or 0,
            })
            forget = _restic(host, config, ['forget', '--tag', TAG, '--group-by', 'host,tags',
                                            *_retention_args(settings['backup']['retention'])], timeout=3600)
            if forget.returncode != 0:
                result['warning'] = 'forget_failed'
            result['targets'] = copy_to_targets(host, config, settings)
            stats = _restic(host, config, ['stats', '--json', '--no-lock', '--mode', 'raw-data'], timeout=1800)
            try:
                raw = json.loads(stats.stdout)
                result['repositoryBytes'] = raw.get('total_size')
                result['repositoryUncompressedBytes'] = raw.get('total_uncompressed_size')
            except ValueError:
                pass
            result['ok'] = True
        except HostError as error:
            result['error'] = error.message
        except OSError as error:
            result['error'] = f'{type(error).__name__}: {error.strerror or error}'
        finally:
            shutil.rmtree(staging, ignore_errors=True)
            result['finishedAt'] = iso(host.now())
            result['durationSeconds'] = int(host.now() - started)
    _record(config, 'backup', result)
    if not result['ok']:
        events.record(config.state_dir, source='backup', severity='critical', code='BackupFailed',
                      message=result.get('error'), at=host.now())
    return result


def copy_to_targets(host: Host, config: Config, settings: dict) -> list[dict]:
    """The new snapshots, copied to every enabled offsite target (restic copy)."""
    results = []
    targets = [t for t in settings['backup'].get('targets') or [] if isinstance(t, dict) and t.get('enabled')]
    changed = False
    for target in targets:
        env_path = target_env_path(config, target['id'])
        entry = {'id': target['id'], 'ok': False}
        try:
            credentials = _read_env_file(env_path)
            env = {**credentials, 'RESTIC_REPOSITORY': target['repository'],
                   'RESTIC_FROM_REPOSITORY': config.backup['repository'],
                   'RESTIC_FROM_PASSWORD_FILE': config.backup['passwordFile']}
            probe = _restic(host, config, ['cat', 'config'], timeout=120, env=env)
            if probe.returncode != 0:
                init = _restic(host, config, ['init', '--copy-chunker-params'], timeout=300, env=env)
                if init.returncode != 0:
                    raise HostError('CommandFailed', 'the target could not be set up')
            copy = _restic(host, config, ['copy', '--tag', TAG], timeout=12 * 3600, env=env)
            if copy.returncode != 0:
                raise HostError('CommandFailed', clip(copy.stderr, 300) or 'restic copy failed')
            entry['ok'] = True
            target['lastCopy'] = {'at': iso(host.now()), 'ok': True}
        except (HostError, OSError) as error:
            entry['error'] = error.message if isinstance(error, HostError) else str(error)
            target['lastCopy'] = {'at': iso(host.now()), 'ok': False, 'error': entry['error']}
        changed = True
        results.append(entry)
    if changed:
        fresh = load_settings(config)
        by_id = {t['id']: t for t in targets}
        fresh['backup']['targets'] = [by_id.get(t.get('id'), t) for t in fresh['backup'].get('targets') or []]
        save_settings(config, fresh)
    return results


def job_maintenance(host: Host, config: Config) -> dict:
    settings = load_settings(config)
    started = host.now()
    result: dict = {'ok': False, 'startedAt': iso(started)}
    with file_lock(os.path.join(config.run_dir, 'backup.lock')):
        try:
            prune = _restic(host, config, ['prune'], timeout=6 * 3600)
            result['pruned'] = prune.returncode == 0
            if prune.returncode != 0:
                raise HostError('CommandFailed', clip(prune.stderr, 500) or 'restic prune failed')
            if settings['backup']['checkWeekly']:
                check = _restic(host, config, ['check', '--read-data-subset=5%'], timeout=12 * 3600)
                result['checked'] = True
                if check.returncode != 0:
                    raise HostError('CheckFailed', clip(check.stdout + check.stderr, 800) or 'restic check failed')
            result['ok'] = True
        except HostError as error:
            result['error'] = error.message
        finally:
            result['finishedAt'] = iso(host.now())
            result['durationSeconds'] = int(host.now() - started)
    _record(config, 'maintenance', result)
    if not result['ok']:
        events.record(config.state_dir, source='backup', severity='critical', code='CheckFailed',
                      message=result.get('error'), at=host.now())
    return result


def _sample_files(host: Host, config: Config, count: int = 20) -> list[str]:
    """Reservoir sample of small regular files in the latest snapshot."""
    result = _restic(host, config, ['ls', '--json', '--no-lock', 'latest'], timeout=1800)
    chosen: list[str] = []
    seen = 0
    rng = random.Random()
    for line in result.stdout.splitlines():
        try:
            node = json.loads(line)
        except ValueError:
            continue
        if node.get('type') != 'file' or not isinstance(node.get('size'), int) or node['size'] > 10_000_000:
            continue
        if '/staging/' in node.get('path', ''):
            continue
        seen += 1
        if len(chosen) < count:
            chosen.append(node['path'])
        else:
            index = rng.randrange(seen)
            if index < count:
                chosen[index] = node['path']
    return chosen


def job_restore_test(host: Host, config: Config) -> dict:
    started = host.now()
    result: dict = {'ok': False, 'startedAt': iso(started)}
    target = os.path.join(config.backup['restoreDir'], 'restore-test')
    runuser = host.which('runuser')
    with file_lock(os.path.join(config.run_dir, 'backup.lock')):
        try:
            latest = snapshots(host, config)
            if not latest:
                raise HostError('NotFound', 'there is no snapshot yet')
            snapshot = latest[0]['id']
            result['snapshot'] = snapshot
            files = _sample_files(host, config)
            staging_postgres = os.path.join(config.backup['stagingDir'], 'postgres')
            shutil.rmtree(target, ignore_errors=True)
            os.makedirs(target, mode=0o700)
            includes = []
            for path in [staging_postgres, *files]:
                includes += ['--include', path]
            restored = _restic(host, config, ['restore', snapshot, '--target', target, '--verify', *includes],
                               timeout=6 * 3600)
            if restored.returncode != 0:
                raise HostError('CommandFailed', clip(restored.stderr, 500) or 'restic restore failed')
            result['files'] = len(files)
            result['filesRestored'] = sum(1 for path in files if os.path.exists(os.path.join(target, path.lstrip('/'))))
            dumps_dir = os.path.join(target, staging_postgres.lstrip('/'))
            dumps = sorted(glob.glob(os.path.join(dumps_dir, '*.dump')), key=os.path.getsize, reverse=True)
            if not dumps:
                raise HostError('NotFound', 'the snapshot has no database dump')
            result['database'] = _restore_database(host, dumps[0], runuser)
            if result['filesRestored'] != result['files']:
                raise HostError('CheckFailed', 'not every sampled file came back')
            result['ok'] = True
        except HostError as error:
            result['error'] = error.message
        finally:
            shutil.rmtree(target, ignore_errors=True)
            result['finishedAt'] = iso(host.now())
            result['durationSeconds'] = int(host.now() - started)
    _record(config, 'restore-test', result)
    if not result['ok']:
        events.record(config.state_dir, source='backup', severity='critical', code='RestoreTestFailed',
                      message=result.get('error'), at=host.now())
    return result


def _restore_database(host: Host, dump: str, runuser: str | None) -> dict:
    """Restores a dump into a scratch database, counts its tables, and drops it again."""
    pg_restore, psql = host.which('pg_restore'), host.which('psql')
    createdb, dropdb = host.which('createdb'), host.which('dropdb')
    if not all((runuser, pg_restore, psql, createdb, dropdb)):
        raise HostError('NotAvailable', 'the PostgreSQL tools are missing')
    as_postgres = [runuser, '-u', 'postgres', '--']
    host.run([*as_postgres, dropdb, '--if-exists', SCRATCH_DB], timeout=300)
    created = host.run([*as_postgres, createdb, SCRATCH_DB], timeout=300)
    if created.returncode != 0:
        raise HostError('CommandFailed', 'could not create the scratch database')
    try:
        # pg_restore runs as postgres and reads the dump through stdin (root's file).
        restored = host.run([*as_postgres, pg_restore, '--no-owner', '--no-privileges', '--exit-on-error',
                             '--dbname', SCRATCH_DB], timeout=3 * 3600, stdin_path=dump)
        if restored.returncode != 0:
            raise HostError('CheckFailed', 'pg_restore failed: ' + clip(restored.stderr, 300))
        counted = host.run([*as_postgres, psql, '-XAtd', SCRATCH_DB, '-c',
                            "select count(*) from information_schema.tables where table_schema = 'public'"],
                           timeout=300)
        tables = int(counted.stdout.strip() or 0) if counted.returncode == 0 else 0
        if tables == 0:
            raise HostError('CheckFailed', 'the restored database has no tables')
        return {'name': os.path.basename(dump)[:-5], 'tables': tables, 'bytes': os.path.getsize(dump)}
    finally:
        host.run([*as_postgres, dropdb, '--if-exists', SCRATCH_DB], timeout=300)
