#!/usr/bin/env python3
"""Replicate only the encrypted Restic repository to the owner's private Drive."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

from offsite_metadata import metadata_name_matches

BASE = Path('/home/pw/services/volition-backups')
CONFIG = Path('/home/pw/.openclaw/volition/offsite-backup.json')
STATE = BASE / 'offsite-state.json'
READ = '/home/pw/.local/bin/gog-openclaw-read'
WRITE = '/home/pw/.local/bin/gog-openclaw-write'


def atomic(path, value):
    temp = path.with_suffix('.new')
    with temp.open('w') as handle:
        json.dump(value, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    temp.chmod(0o600)
    temp.replace(path)


def gog(args, write=False):
    result = subprocess.run([WRITE if write else READ, *args, '--account', cfg['account'], '--json', '--no-input'], capture_output=True, text=True, timeout=3600)
    if result.returncode:
        # Do not propagate provider response bodies or OAuth details to logs.
        raise RuntimeError('Drive operation failed: ' + ' '.join(args[:2]))
    return json.loads(result.stdout)


def api(method, params=None, body=None):
    args = ['api', 'call', 'drive', 'v3', method, '--params', json.dumps(params or {})]
    if body is not None:
        args += ['--body', json.dumps(body), '--allow-write', '--force']
    return gog(args, write=body is not None)


def private_folder(folder_id):
    value = api('files.get', {'fileId': folder_id, 'fields': 'id,mimeType,trashed,permissions(type,role,emailAddress)'})
    permissions = value.get('permissions', [])
    if value.get('trashed') or value.get('mimeType') != 'application/vnd.google-apps.folder' or not permissions:
        raise RuntimeError('Backup folder cannot be verified')
    if any(p.get('type') != 'user' or p.get('emailAddress', '').lower() != cfg['account'].lower() or p.get('role') != 'owner' for p in permissions):
        raise RuntimeError('Backup folder is shared; refusing to upload')


def digest(file):
    sha, md5 = hashlib.sha256(), hashlib.md5(usedforsecurity=False)
    with file.open('rb') as handle:
        while chunk := handle.read(1024 * 1024):
            sha.update(chunk)
            md5.update(chunk)
    return sha.hexdigest(), md5.hexdigest()


os.umask(0o077)
if not CONFIG.is_file() or CONFIG.is_symlink() or CONFIG.stat().st_mode & 0o077:
    raise SystemExit('Offsite configuration must be a private regular file')
cfg = json.loads(CONFIG.read_text())
if set(cfg) != {'account', 'retain'} or not isinstance(cfg['account'], str) or cfg['retain'] != 7:
    raise SystemExit('Invalid offsite configuration')
BASE.mkdir(mode=0o700, exist_ok=True)
with (BASE / 'backup.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    state = json.loads(STATE.read_text()) if STATE.exists() else {'schemaVersion': 1, 'files': []}
    try:
        repository = BASE / 'restic'
        if not (repository / 'config').is_file() or not (repository / 'snapshots').is_dir():
            raise RuntimeError('Encrypted Restic repository is absent')
        if not (BASE / 'last-success').is_file():
            raise RuntimeError('No successful local backup exists')
        env = {**os.environ, 'RESTIC_REPOSITORY': str(repository), 'RESTIC_PASSWORD_FILE': '/home/pw/services/volition-stack/.secrets/backup_restic_password', 'RESTIC_CACHE_DIR': str(BASE / 'cache'), 'GOMEMLIMIT': '512MiB', 'GOMAXPROCS': '2'}
        subprocess.run(['restic', 'check', '--quiet'], env=env, check=True, timeout=1200, stdout=subprocess.DEVNULL)
        if not state.get('folderId'):
            created = api('files.create', {'fields': 'id'}, {'name': 'Volition encrypted backups', 'mimeType': 'application/vnd.google-apps.folder', 'appProperties': {'volitionRole': 'encrypted-backups-v1'}})
            state['folderId'] = created['id']
            atomic(STATE, state)
        private_folder(state['folderId'])
        with tempfile.TemporaryDirectory(prefix='offsite-', dir=BASE) as temp:
            archive = Path(temp) / ('volition-restic-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.tar')
            # Only ciphertext plus repository metadata. Never copy the password.
            with tarfile.open(archive, 'w') as tar:
                def exclude_locks(info):
                    return None if info.name == 'restic/locks' or info.name.startswith('restic/locks/') else info
                tar.add(repository, arcname='restic', filter=exclude_locks)
                tar.add(BASE / 'last-success', arcname='last-success')
            sha, md5 = digest(archive)
            size = archive.stat().st_size
            quota = api('about.get', {'fields': 'storageQuota'})['storageQuota']
            if quota.get('limit') and int(quota['limit']) - int(quota.get('usage', 0)) < size + 512 * 1024 * 1024:
                raise RuntimeError('Insufficient Drive quota; existing backups preserved')
            uploaded = gog(['drive', 'upload', str(archive), '--name', archive.name, '--parent', state['folderId'], '--mime-type', 'application/x-tar'], write=True)
            file_id = uploaded.get('id') or uploaded.get('file', {}).get('id')
            if not file_id:
                raise RuntimeError('Drive did not confirm the uploaded file id')
            confirmed = api('files.get', {'fileId': file_id, 'fields': 'id,name,size,md5Checksum,parents,trashed'})
            if confirmed.get('md5Checksum') != md5 or int(confirmed.get('size', 0)) != size or state['folderId'] not in confirmed.get('parents', []) or confirmed.get('trashed'):
                raise RuntimeError('Offsite checksum or location verification failed')
            # The first replica is also downloaded and checked as a real restore.
            if not state.get('restoreVerifiedAt'):
                downloaded = Path(temp) / 'restore-test.tar'
                gog(['drive', 'download', file_id, '--out', str(downloaded)])
                if digest(downloaded)[0] != sha:
                    raise RuntimeError('Offsite restore checksum mismatch')
                restore = Path(temp) / 'restore'
                restore.mkdir()
                with tarfile.open(downloaded) as tar:
                    tar.extractall(restore, filter='data')
                subprocess.run(['restic', 'check', '--read-data', '--quiet'], env={**env, 'RESTIC_REPOSITORY': str(restore / 'restic')}, check=True, timeout=1200, stdout=subprocess.DEVNULL)
                state['restoreVerifiedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
            state['files'].append({'id': file_id, 'name': archive.name, 'size': size, 'sha256': sha, 'verifiedAt': dt.datetime.now(dt.timezone.utc).isoformat()})
            state['lastSuccessAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
            state['lastError'] = None
            atomic(STATE, state)
            # Retention only touches ids this process previously created and verified.
            while len(state['files']) > cfg['retain']:
                old = state['files'][0]
                metadata = api('files.get', {'fileId': old['id'], 'fields': 'id,name,parents'})
                if state['folderId'] not in metadata.get('parents', []) or not metadata_name_matches(metadata.get('name'), old['name']):
                    raise RuntimeError('Retention target changed; leaving it untouched')
                gog(['drive', 'delete', old['id'], '--permanent', '--force'], write=True)
                state['files'].pop(0)
                atomic(STATE, state)
            print(json.dumps({'ok': True, 'bytes': size, 'retained': len(state['files']), 'restoreVerified': bool(state.get('restoreVerifiedAt'))}))
    except Exception as error:
        state['lastError'] = type(error).__name__ + ': ' + str(error)[:180]
        state['lastAttemptAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        atomic(STATE, state)
        raise
