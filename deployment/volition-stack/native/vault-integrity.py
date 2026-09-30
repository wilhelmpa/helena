#!/usr/bin/env python3
"""Read-only vault audit. JSON fixtures are accepted only with an explicit test root."""
import argparse
import hashlib
import grp
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).parent / 'server' / 'hostd'))
from helena_host.varlink import call


IGNORED = {'.git', '.obsidian', '.trash', '.stfolder', '.stversions'}


def command(*args, timeout=120, binary=False):
    result = subprocess.run(args, capture_output=True, timeout=timeout, check=True)
    return result.stdout if binary else result.stdout.decode()


def database_rows(table, columns):
    query = f'SELECT coalesce(json_agg(row_to_json(t)), \'[]\'::json) FROM (SELECT {columns} FROM {table}) t'
    url = urlsplit(os.environ['DATABASE_URL'])
    env = dict(os.environ, PGHOST=url.hostname or 'localhost', PGPORT=str(url.port or 5432),
               PGUSER=unquote(url.username or ''), PGPASSWORD=unquote(url.password or ''),
               PGDATABASE=unquote(url.path.lstrip('/')))
    result = subprocess.run(['psql', '-X', '-A', '-t', '-c', query], env=env,
                            capture_output=True, check=True, timeout=120)
    return json.loads(result.stdout)


def canonical(value):
    return (isinstance(value, str) and value and len(value.encode()) <= 1024
            and not value.startswith('/') and not value.endswith('/')
            and all(p and p not in ('.', '..') and p == p.strip()
            and '\\' not in p and all(ord(c) > 31 and ord(c) != 127 for c in p)
            and len(p.encode()) <= 255 for p in value.split('/')))


def file_hash(root, relative):
    directories = [os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)]
    try:
        parts = relative.split('/')
        for part in parts[:-1]:
            directories.append(os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                       dir_fd=directories[-1]))
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directories[-1])
        with os.fdopen(file_fd, 'rb') as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                raise OSError('receipt is not a regular file')
            digest = hashlib.sha256()
            for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                digest.update(chunk)
        return digest.hexdigest()
    finally:
        for directory in reversed(directories):
            os.close(directory)


def acl_grants(acl, user, needed, default=False):
    prefix = ('default:' if default else '') + f'user:{user}:'
    line = next((line for line in acl.splitlines() if line.startswith(prefix)), '')
    if not line:
        return False
    granted = line[len(prefix):].split()[0]
    effective = line.split('#effective:', 1)[1].strip() if '#effective:' in line else granted
    return all(letter in effective for letter in needed)


def scan(root, index, receipts, project_users=None, backup=None, git=None):
    findings = []
    def issue(code, path, detail=''):
        findings.append({'code': code, 'path': path, 'detail': detail})

    disk = {}
    disk_folded = {}
    inodes = {}
    pending = [root]
    while pending:
        folder = pending.pop()
        for entry in folder.iterdir():
            relative = entry.relative_to(root).as_posix()
            info = entry.lstat()
            if not canonical(relative):
                issue('noncanonical_file', relative)
            if relative.casefold() in disk_folded and disk_folded[relative.casefold()] != relative:
                issue('duplicate_file_case', relative, disk_folded[relative.casefold()])
            disk_folded[relative.casefold()] = relative
            if not stat.S_ISLNK(info.st_mode) and info.st_mode & stat.S_IWOTH:
                issue('world_writable', relative)
            if entry.is_symlink():
                issue('symlink', relative)
                continue
            if 'sync-conflict-' in entry.name:
                issue('sync_conflict', relative)
                continue
            if entry.name.startswith('.~') or entry.name.startswith('.syncthing.') or entry.name.endswith(('.tmp', '.part', '.crdownload')):
                issue('partial_upload', relative)
                continue
            if entry.name in IGNORED:
                if entry.is_dir():
                    for ignored_root, dirs, files in os.walk(entry, followlinks=False):
                        for child in dirs + files:
                            ignored = Path(ignored_root) / child
                            ignored_mode = ignored.lstat().st_mode
                            if not stat.S_ISLNK(ignored_mode) and ignored_mode & stat.S_IWOTH:
                                issue('world_writable', ignored.relative_to(root).as_posix())
                continue
            if entry.name in ('.DS_Store', '.stignore'):
                continue
            if entry.is_dir():
                disk[relative] = 'folder'
                pending.append(entry)
            elif entry.is_file():
                inode = (info.st_dev, info.st_ino)
                if inode in inodes:
                    issue('duplicate_file', relative, inodes[inode])
                inodes[inode] = relative
                if info.st_size == 0 and entry.name != '.gitignore':
                    issue('zero_byte', relative)
                if not any(p in IGNORED for p in entry.relative_to(root).parts):
                    disk[relative] = 'file'
            else:
                issue('special_file', relative)

    indexed = {}
    folded = {}
    for row in index:
        relative = row['path']
        if not canonical(relative):
            issue('noncanonical_index', str(relative))
            continue
        if relative in indexed:
            issue('duplicate_index', relative)
        if relative.casefold() in folded and folded[relative.casefold()] != relative:
            issue('duplicate_index_case', relative, folded[relative.casefold()])
        folded[relative.casefold()] = relative
        indexed[relative] = row
        if relative not in disk:
            issue('index_without_file', relative)
        elif relative in disk and (row['kind'] == 'folder') != (disk[relative] == 'folder'):
            issue('index_kind', relative)
    for relative in disk:
        if relative not in indexed:
            issue('file_without_index', relative)

    for row in receipts:
        relative = row['vault_path']
        if not canonical(relative) or not relative.startswith('Projects/'):
            issue('receipt_path', str(relative))
            continue
        try:
            digest = file_hash(root, relative)
        except OSError:
            issue('receipt_missing', relative)
            continue
        if digest != row['sha256']:
            issue('receipt_sha', relative)

    if project_users is not None:
        try:
            shared_gid = grp.getgrnam('volition').gr_gid
            private_gid = grp.getgrnam('volition-private').gr_gid
        except KeyError:
            shared_gid = private_gid = None
            issue('group_unchecked', 'Vault')
        for relative in disk:
            parts = relative.split('/')
            if parts[0] not in ('Home', 'Projects', 'Private'):
                continue
            target = root / relative
            expected_gid = private_gid if parts[0] == 'Private' else shared_gid
            if expected_gid is not None and target.lstat().st_gid != expected_gid:
                issue('vault_group', relative)
            try:
                acl = command('getfacl', '-cp', str(target))
            except (OSError, subprocess.CalledProcessError):
                issue('acl_unchecked', relative)
                continue
            if 'other::---' not in acl:
                issue('world_access', relative)
            if target.is_dir() and 'default:other::---' not in acl:
                issue('default_acl', relative)
            needed = 'rwx' if target.is_dir() else 'rw-'
            if parts[0] == 'Home':
                if not acl_grants(acl, 'vp-home', needed.replace('-', '')):
                    issue('home_acl', relative)
                if target.is_dir() and not acl_grants(acl, 'vp-home', 'rwx', default=True):
                    issue('home_default_acl', relative)
            elif parts[0] == 'Private':
                if any(f'user:{user}:' in acl for user in project_users.values()) or 'user:vp-home:' in acl:
                    issue('private_acl', relative)
            elif len(parts) >= 2 and parts[1] in project_users:
                user = project_users[parts[1]]
                if not acl_grants(acl, user, needed.replace('-', '')):
                    issue('project_acl', relative, user)
                if not acl_grants(acl, 'vp-home', needed.replace('-', '')):
                    issue('home_project_acl', relative)
                if target.is_dir() and (not acl_grants(acl, user, 'rwx', default=True)
                                        or not acl_grants(acl, 'vp-home', 'rwx', default=True)):
                    issue('project_default_acl', relative)
                for other in project_users.values():
                    if other != user and f'user:{other}:' in acl:
                        issue('foreign_project_acl', relative, other)
                    if other != user:
                        try:
                            if target.stat().st_uid == pwd.getpwnam(other).pw_uid:
                                issue('foreign_project_owner', relative, other)
                        except KeyError:
                            pass
        for key, user in project_users.items():
            folder = root / 'Projects' / key
            if not folder.is_dir():
                issue('project_missing', f'Projects/{key}')
        for relative in disk:
            parts = relative.split('/')
            if len(parts) == 2 and parts[0] == 'Projects' and parts[1] not in project_users:
                issue('project_unregistered', relative)

    for name in ('shared', 'private'):
        state = (git or {}).get(name)
        if state is None:
            issue('git_unchecked', name)
        else:
            if not state.get('fsck'):
                issue('git_fsck', name)
            if state.get('dirty'):
                issue('git_dirty', name)
            if state.get('bytes', 0) > int(os.environ.get('VOLITION_VAULT_GIT_MAX_BYTES', 2 * 1024**3)):
                issue('git_size', name, str(state['bytes']))

    if backup is None:
        issue('backup_unchecked', 'Vault')
    elif backup.get('state', 'ok') != 'ok':
        code = {'disabled': 'backup_disabled', 'no_snapshot': 'backup_no_snapshot',
                'stale': 'backup_stale', 'unavailable': 'backup_unavailable',
                'error': 'backup_check_failed', 'pending': 'backup_unchecked'}.get(backup.get('state'), 'backup_check_failed')
        issue(code, 'Vault')
    else:
        paths = set(backup.get('paths', []))
        sample = next((p for p, kind in disk.items() if kind == 'file' and p.startswith(('Home/', 'Projects/', 'Private/'))), None)
        if not backup.get('vault_present', any(p == '/srv/volition/vault' or p.startswith('/srv/volition/vault/') for p in paths)):
            issue('backup_missing', 'Vault')
        if not backup.get('private_present', any(p.startswith('/srv/volition/vault/Private/') for p in paths)):
            issue('backup_private_missing', 'Private')
        if not backup.get('sample_ok'):
            issue('backup_restore', sample or 'Vault')

    state = 'ok'
    if findings:
        pending_backup = backup is None or backup.get('state') == 'pending'
        only_pending = all(item['code'] == 'backup_unchecked' for item in findings)
        state = 'unknown' if pending_backup and only_pending else 'down'
    return {'checkedAt': datetime.now(timezone.utc).isoformat(), 'state': state, 'findings': findings}


def git_state(folder):
    try:
        command('git', '-c', 'safe.directory=*', '-C', str(folder), 'fsck', '--no-reflogs', timeout=300)
        healthy = True
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        healthy = False
    try:
        dirty = bool(command('git', '-c', 'safe.directory=*', '-C', str(folder), 'status', '--porcelain'))
        size = sum(p.stat().st_size for p in (folder / '.git').rglob('*') if p.is_file())
    except (OSError, subprocess.CalledProcessError):
        dirty, size = True, 0
    return {'fsck': healthy, 'dirty': dirty, 'bytes': size}


def backup_state():
    try:
        reply = call('/run/helena-hostd/hostd.sock', 'io.helena.hostd.VaultBackupIntegrity', timeout=600)
        parameters = reply.get('parameters') if isinstance(reply, dict) else None
        result = parameters.get('result') if isinstance(parameters, dict) else None
        if isinstance(reply, dict) and 'error' not in reply and isinstance(result, dict) and result.get('state') in (
                'ok', 'disabled', 'no_snapshot', 'stale', 'unavailable', 'error', 'pending'):
            return result
    except (OSError, ValueError, TypeError):
        pass
    return {'state': 'error'}


def project_users():
    users = {}
    directory = Path('/var/lib/volition/provisioning/projects')
    for item in directory.glob('*.json'):
        data = json.loads(item.read_text())
        slug = data.get('slug')
        key = data.get('project', {}).get('key')
        if (isinstance(slug, str) and isinstance(key, str) and
                re.fullmatch(r'[a-z][a-z0-9-]*', slug) and
                re.fullmatch(r'[A-Z][A-Z0-9_-]*', key) and item.name == slug + '.json'):
            users[key] = 'vp-' + slug
    return users


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('/srv/volition/vault'))
    parser.add_argument('--fixture', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.fixture and root == Path('/srv/volition/vault'):
        parser.error('fixtures require a separate test root')
    if args.fixture:
        data = json.loads(args.fixture.read_text())
        result = scan(root, data['index'], data['receipts'], data.get('projectUsers'), data.get('backup'), data.get('git'))
    else:
        try:
            result = scan(root, database_rows('vault_entry', 'path, kind'),
                          database_rows('helena_receipt', 'vault_path, sha256'),
                          project_users(), backup_state(),
                          {'shared': git_state(root), 'private': git_state(root / 'Private')})
        except Exception as error:
            result = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'state': 'down',
                      'findings': [{'code': 'check_failed', 'path': 'Vault', 'detail': str(error)}]}
    rendered = json.dumps(result, ensure_ascii=False)
    if args.report:
        temporary = args.report.with_suffix('.new')
        temporary.write_text(rendered + '\n')
        os.chmod(temporary, 0o644)
        temporary.replace(args.report)
    print(rendered)
    return any(item['code'] == 'check_failed' for item in result['findings'])


if __name__ == '__main__':
    sys.exit(main())
