#!/usr/bin/python3 -I
"""The file part of the isolation migration (design §5), called by native/isolation.sh as root.

    migrate.py apply [--dry-run]     projects' files to their users, the vault's ACLs, Home's
                                     profile, the browser state to the browser user
    migrate.py rollback [--dry-run]  everything back to the runner user, the ACLs removed

It walks every tree through directory file descriptors and never follows a symbolic link:
agents ran as the runner user until now and could have left links or hard links anywhere in
their trees. A hard-linked file is left alone and reported, because giving it to a project
would give that project whatever else the link points at. With --dry-run it prints each
change and makes none.
"""

from __future__ import annotations

import argparse
import asyncio
import grp
import json
import os
import pwd
import sqlite3
import stat
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)

from isolation_common import (  # noqa: E402
    ACCESS,
    ACL_GROUP,
    ACL_USER,
    DEFAULT,
    IsolationError,
    acl_decode,
    acl_encode,
    load_config,
    open_path_nofollow,
    project_user,
    set_acl,
    valid_slug,
)

# What Home's own profile takes over from the global Hermes home, which stays as it is (the
# rollback returns to it). Keys, runner descriptors and the runner's configuration stay.
HOME_PROFILE_ENTRIES = (
    'SOUL.md', 'memories', 'skills', 'sessions', 'cron', 'hooks', 'logs', 'pairing', 'pending_messages',
    'image_cache', 'audio_cache', 'sandboxes', 'vault', 'context_length_cache.yaml', 'models_dev_cache.json',
    'models_dev_cache.etag', 'provider_models_cache.json', '.skills_prompt_snapshot.json',
    'run/itsaplan-policy-manifest.json', 'run/itsaplan-managed', 'run/itsaplan-vault-manifest.json',
)
HOME_PROFILE_DATABASES = ('state.db', 'kanban.db', 'shared-state.db')


class Changes:
    def __init__(self, dry_run: bool):
        self.dry_run = dry_run
        self.count = 0
        self.skipped: list[str] = []

    def note(self, message: str) -> None:
        self.count += 1
        if self.dry_run or self.count <= 200 or self.count % 5000 == 0:
            print(f'{"would " if self.dry_run else ""}{message}', flush=True)

    def skip(self, path: str, why: str) -> None:
        self.skipped.append(f'{path}: {why}')
        print(f'skipped {path}: {why}', file=sys.stderr, flush=True)


def walk(root: str, visit) -> None:
    """Calls visit(path, fd, info) for the root and everything below it, each opened without
    following links (a link itself is passed with fd None)."""
    try:
        top = open_path_nofollow(root)
    except FileNotFoundError:
        return
    except IsolationError:
        # A single file: opened from its folder, without following a link.
        try:
            parent = open_path_nofollow(os.path.dirname(root))
        except FileNotFoundError:
            return
        try:
            fd = os.open(os.path.basename(root), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOCTTY,
                         dir_fd=parent)
        except FileNotFoundError:
            return
        finally:
            os.close(parent)
        try:
            info = os.fstat(fd)
            if stat.S_ISREG(info.st_mode):
                visit(root, fd, info)
        finally:
            os.close(fd)
        return
    try:
        visit(root, top, os.fstat(top))
        for directory, _dirs, files, dir_fd in os.fwalk(dir_fd=top, follow_symlinks=False):
            path = os.path.normpath(os.path.join(root, directory))
            names = list(files) + list(_dirs)
            for name in names:
                entry = os.path.join(path, name)
                info = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode):
                    visit(entry, None, info)
                    continue
                if stat.S_ISDIR(info.st_mode):
                    if name in _dirs and entry != root:
                        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dir_fd)
                        try:
                            visit(entry, fd, os.fstat(fd))
                        finally:
                            os.close(fd)
                    continue
                if not stat.S_ISREG(info.st_mode):
                    visit(entry, None, info)
                    continue
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOCTTY, dir_fd=dir_fd)
                try:
                    opened = os.fstat(fd)
                    if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                        continue
                    visit(entry, fd, opened)
                finally:
                    os.close(fd)
    finally:
        os.close(top)


def own_tree(root: str, uid: int, gid: int | None, changes: Changes, *, skip_links: bool = True) -> None:
    def visit(path, fd, info):
        if fd is None:
            if stat.S_ISLNK(info.st_mode):
                return  # a link's owner means nothing; its target is never touched
            changes.skip(path, 'not a regular file or directory')
            return
        if stat.S_ISREG(info.st_mode) and info.st_nlink > 1:
            changes.skip(path, f'hard link ({info.st_nlink} names)')
            return
        wanted_gid = info.st_gid if gid is None else gid
        if info.st_uid != uid or info.st_gid != wanted_gid:
            changes.note(f'chown {path} {info.st_uid}:{info.st_gid} → {uid}:{wanted_gid}')
            if not changes.dry_run:
                os.fchown(fd, uid, wanted_gid)
    walk(root, visit)


def acl_tree(root: str, named: dict[tuple[int, int], int], changes: Changes, *,
             remove: set[tuple[int, int]] = frozenset()) -> None:
    """Named ACL entries on every directory (with defaults) and regular file below root. A
    file gets at most what the directory entry says, without x unless it is executable."""
    def visit(path, fd, info):
        if fd is None or (stat.S_ISREG(info.st_mode) and info.st_nlink > 1):
            if fd is not None:
                changes.skip(path, f'hard link ({info.st_nlink} names)')
            return
        entries = named
        if stat.S_ISREG(info.st_mode) and not info.st_mode & 0o111:
            entries = {key: perm & 6 for key, perm in named.items()}
        if set_acl(fd, entries, default=stat.S_ISDIR(info.st_mode), remove=remove, dry_run=True):
            changes.note(f'setfacl {path} {describe(entries)}{" -" + describe({k: 0 for k in remove}) if remove else ""}')
            if not changes.dry_run:
                set_acl(fd, entries, default=stat.S_ISDIR(info.st_mode), remove=remove)
    walk(root, visit)


def strip_named(root: str, ids: set[tuple[int, int]], changes: Changes) -> None:
    acl_tree(root, {}, changes, remove=ids)


def describe(entries: dict[tuple[int, int], int]) -> str:
    parts = []
    for (tag, ident), perm in entries.items():
        try:
            name = pwd.getpwuid(ident).pw_name if tag == ACL_USER else grp.getgrgid(ident).gr_name
        except KeyError:
            name = str(ident)
        bits = ''.join(c if perm & b else '-' for c, b in (('r', 4), ('w', 2), ('x', 1)))
        parts.append(f'{"u" if tag == ACL_USER else "g"}:{name}:{bits}')
    return ','.join(parts)


def registry_projects(config) -> list[tuple[str, str]]:
    projects = []
    try:
        fd = open_path_nofollow(config.registry_root)
    except FileNotFoundError:
        return []
    try:
        for name in sorted(os.listdir(fd)):
            if not name.endswith('.json'):
                continue
            file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
            with os.fdopen(file_fd, 'rb') as handle:
                entry = json.loads(handle.read(1_048_576))
            slug = entry.get('slug')
            key = (entry.get('project') or {}).get('key')
            if valid_slug(slug) and isinstance(key, str) and name == f'{slug}.json':
                projects.append((slug, key))
    finally:
        os.close(fd)
    return projects


def project_profiles(config, slug: str) -> list[str]:
    from isolation_common import PROFILE_RE, profile_slug  # noqa: PLC0415

    try:
        names = os.listdir(config.profiles_root)
    except FileNotFoundError:
        return []
    if slug == config.home_slug:
        return [name for name in names if name == slug]
    return sorted(name for name in names if PROFILE_RE.match(name) and profile_slug(name) == slug)


def copy_home_profile(config, global_home: str, account, changes: Changes) -> None:
    """Home's own profile, a copy of the Home agent's state in the global Hermes home: its
    SOUL.md, memory, skills and sessions (the databases through SQLite's backup, so a
    consistent copy even of a database in use)."""
    target = os.path.join(config.profiles_root, config.home_slug)
    if os.path.lexists(target):
        return
    changes.note(f'create Home profile {target} from {global_home}')
    if changes.dry_run:
        return
    os.mkdir(target, 0o700)
    os.chown(target, account.pw_uid, account.pw_gid)
    for entry in HOME_PROFILE_ENTRIES:
        source = os.path.join(global_home, entry)
        if not os.path.lexists(source) or os.path.islink(source):
            continue
        destination = os.path.join(target, entry)
        os.makedirs(os.path.dirname(destination), mode=0o700, exist_ok=True)
        if os.path.isdir(source):
            _copy_tree(source, destination)
        else:
            _copy_file(source, destination)
    for name in HOME_PROFILE_DATABASES:
        source = os.path.join(global_home, name)
        if os.path.isfile(source) and not os.path.islink(source):
            with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as origin, \
                    sqlite3.connect(os.path.join(target, name)) as copy:
                origin.backup(copy)
    own_tree(target, account.pw_uid, account.pw_gid, changes)


def _copy_file(source: str, destination: str) -> None:
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            return
        out = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, info.st_mode & 0o700)
        try:
            while True:
                chunk = os.read(fd, 1 << 20)
                if not chunk:
                    break
                os.write(out, chunk)
        finally:
            os.close(out)
    finally:
        os.close(fd)


def _copy_tree(source: str, destination: str) -> None:
    os.makedirs(destination, mode=0o700, exist_ok=True)
    for name in os.listdir(source):
        path = os.path.join(source, name)
        if os.path.islink(path):
            os.symlink(os.readlink(path), os.path.join(destination, name))
        elif os.path.isdir(path):
            _copy_tree(path, os.path.join(destination, name))
        elif os.path.isfile(path):
            _copy_file(path, os.path.join(destination, name))


def ensure_user(config, slug: str, profiles: list[str], changes: Changes):
    name = project_user(config, slug)
    try:
        account = pwd.getpwnam(name)
    except KeyError:
        account = None
    if account is None or changes.dry_run:
        if account is None:
            changes.note(f'create user {name} in {config.agents_group}')
        if changes.dry_run:
            return account
    import launcher  # noqa: PLC0415 - the launcher's own user management, run directly

    worker = launcher.Launcher(config)
    result = asyncio.run(worker._ensure_project_user({'slug': slug, 'profiles': profiles}, 'isolation.sh'))
    changes.note(f'ensured {name}: {json.dumps(result)}')
    return pwd.getpwnam(name)


def apply(args, config) -> Changes:
    changes = Changes(args.dry_run)
    runner = pwd.getpwnam(config.runner_user)
    readers = grp.getgrnam(config.readers_group).gr_gid
    rwx, rx = 7, 5
    projects = registry_projects(config)
    print(f'projects: {", ".join(slug for slug, _ in projects) or "none"} and {config.home_slug}')

    # Home first: every project's vault folder gets its read entry.
    global_home = os.path.dirname(config.profiles_root)
    home_account = None
    try:
        home_account = pwd.getpwnam(project_user(config, config.home_slug))
    except KeyError:
        pass
    home_account = ensure_user(config, config.home_slug, [], changes) or home_account
    if home_account:
        copy_home_profile(config, global_home, home_account, changes)
        if not changes.dry_run:
            ensure_user(config, config.home_slug, [config.home_slug], changes)
        own_tree(os.path.join(config.profiles_root, config.home_slug), home_account.pw_uid, home_account.pw_gid, changes)
        acl_tree(config.home_workspace, {(ACL_USER, home_account.pw_uid): rwx, (ACL_USER, runner.pw_uid): rwx,
                                         (ACL_GROUP, readers): rx}, changes)
        acl_tree(os.path.join(config.vault_root, 'Home'), {(ACL_USER, home_account.pw_uid): rwx}, changes)

    for slug, key in projects:
        profiles = project_profiles(config, slug)
        account = ensure_user(config, slug, profiles, changes)
        if account is None:
            print(f'{slug}: its user is created on apply; the file changes are listed then')
            continue
        workspace = os.path.join(config.workspace_root, slug)
        own_tree(workspace, account.pw_uid, account.pw_gid, changes)
        acl_tree(workspace, {(ACL_USER, account.pw_uid): rwx, (ACL_USER, runner.pw_uid): rwx,
                             (ACL_GROUP, readers): rx}, changes)
        for profile in profiles:
            own_tree(os.path.join(config.profiles_root, profile), account.pw_uid, account.pw_gid, changes)
        vault = os.path.join(config.vault_root, 'Projects', key)
        named = {(ACL_USER, account.pw_uid): rwx}
        if home_account:
            named[(ACL_USER, home_account.pw_uid)] = rx
        acl_tree(vault, named, changes)
    if home_account:
        # The folder that holds the projects' folders, so Home can list them.
        acl_tree_top(os.path.join(config.vault_root, 'Projects'), {(ACL_USER, home_account.pw_uid): rx}, changes)

    browser_root = args.browser_root
    if browser_root:
        try:
            browser = pwd.getpwnam(args.browser_user)
            own_tree(browser_root, browser.pw_uid, None, changes)
        except KeyError:
            print(f'no user {args.browser_user}; browser state left as it is')
    grant_model_auth(args.model_auth or [], config.agents_group, changes)
    return changes


def grant_model_auth(paths: list[str], group: str, changes: Changes) -> None:
    """Phase 1: every agent reads the model sign-ins (group read on each file or folder)."""
    for path in paths:
        try:
            agents = grp.getgrnam(group).gr_gid
        except KeyError:
            if not changes.dry_run:
                raise
            # isolation.sh creates the group before this step; a dry run on a system without
            # it yet can only name the change.
            changes.note(f'give group {group} read on {path} (the group is created on apply)')
            continue
        acl_tree(path, {(ACL_GROUP, agents): 5}, changes)


def acl_tree_top(path: str, named, changes: Changes) -> None:
    try:
        fd = open_path_nofollow(path)
    except FileNotFoundError:
        return
    try:
        if set_acl(fd, named, default=False, dry_run=True):
            changes.note(f'setfacl {path} {describe(named)} (this folder only)')
            if not changes.dry_run:
                set_acl(fd, named, default=False)
    finally:
        os.close(fd)


def rollback(args, config) -> Changes:
    """Back to one runner user for every agent: its trees to the runner, the project users'
    ACL entries removed. The project users stay (their UIDs are never reused)."""
    changes = Changes(args.dry_run)
    runner = pwd.getpwnam(config.runner_user)
    projects = registry_projects(config) + [(config.home_slug, None)]
    ids: set[tuple[int, int]] = set()
    for slug, _ in projects:
        try:
            ids.add((ACL_USER, pwd.getpwnam(project_user(config, slug)).pw_uid))
        except KeyError:
            pass
    for slug, _key in projects:
        workspace = config.home_workspace if slug == config.home_slug else os.path.join(config.workspace_root, slug)
        if slug != config.home_slug:
            own_tree(workspace, runner.pw_uid, None, changes)
        strip_named(workspace, ids, changes)
        for profile in project_profiles(config, slug):
            if slug != config.home_slug:
                own_tree(os.path.join(config.profiles_root, profile), runner.pw_uid, None, changes)
    strip_named(config.vault_root, ids, changes)
    if args.browser_root:
        own_tree(args.browser_root, pwd.getpwnam(config.runner_user).pw_uid, None, changes)
    return changes


def main() -> int:
    parser = argparse.ArgumentParser(prog='migrate.py')
    parser.add_argument('command', choices=['apply', 'rollback'])
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--config', default=os.environ.get('VOLITION_LAUNCHER_CONFIG', os.path.join(HERE, 'launcher.json')))
    parser.add_argument('--browser-root')
    parser.add_argument('--browser-user', default='volition-browser')
    parser.add_argument('--model-auth', action='append', help='a file or folder every agent reads (Phase 1)')
    args = parser.parse_args()
    if os.geteuid() != 0:
        print('migrate.py: run as root', file=sys.stderr)
        return 1
    config = load_config(args.config)
    changes = (apply if args.command == 'apply' else rollback)(args, config)
    print(json.dumps({'changes': changes.count, 'dryRun': changes.dry_run, 'skipped': changes.skipped}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
