"""Shared pieces of the agent isolation: configuration, names, peer credentials, units, ACLs.

The launcher runs as root and imports this module, so it uses the standard library only and
is installed root-owned next to the programs that import it (see ../native/isolation.sh).
"""

from __future__ import annotations

import errno
import json
import os
import re
import sys
import stat
import struct
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# A project slug as provisioning derives it from the project key (provisioner.mjs). A Unix
# user name has at most 32 characters, so a slug of an isolated project has at most 29.
SLUG_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,28}$')
# The profile of a project's coordinator is the slug, every other agent's `<slug>_<agentId>`.
PROFILE_RE = re.compile(r'^(?P<slug>[a-z0-9][a-z0-9-]{0,28})(?:_(?P<agent>[1-9][0-9]{0,9}))?$')
ENV_NAME_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,127}$')
PROJECT_KEY_RE = re.compile(r'^[A-Z][A-Z0-9]{0,31}$')
# Names that are never a project's, so no project user can take them.
RESERVED_SLUGS = frozenset({'root', 'admin', 'system', 'systemd', 'volition', 'plan', 'hermes',
                            'browser', 'egress', 'launcher', 'nobody', 'daemon', 'agents'})


class IsolationError(Exception):
    """A request the isolation refuses. `code` is stable, `message` is safe to show."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ── Configuration ────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Runtime:
    name: str
    exec: str
    fixed_args: tuple[str, ...]
    # Whether the caller may pass arguments after the fixed ones.
    caller_args: bool
    read_only: tuple[str, ...]
    optional_read_only: tuple[str, ...]
    env: dict[str, str]
    # Read-only binds of a host path to another path in the unit, `{home}` being the profile.
    credential_binds: tuple[tuple[str, str], ...]
    # Whether the unit needs a Hermes profile of the project (all runtimes do but `shell`).
    needs_profile: bool
    # Links the sandbox keeps in the profile before the runtime starts, name → target.
    profile_links: dict[str, str]
    # Credential sources the unit must not start without (`"required": true`): the agents' login
    # views of the token keeper. A missing one refuses the run instead of starting an agent
    # with no login.
    required_credentials: tuple[str, ...] = ()


@dataclass(frozen=True)
class Config:
    callers: tuple[str, ...]
    user_prefix: str
    agents_group: str
    uid_range: tuple[int, int]
    unit_prefix: str
    terminal_prefix: str
    registry_root: str
    workspace_root: str
    home_workspace: str
    profiles_root: str
    vault_root: str
    home_slug: str
    runner_user: str
    readers_group: str
    state_root: str
    python: str
    sandbox: str
    sockets: dict[str, str]
    # Which socket each loopback port of a unit leads to, e.g. 3128 → egress, 3000 → plan.
    forwards: dict[str, int]
    hide: tuple[str, ...]
    inaccessible: tuple[str, ...]
    path: str
    tmux_conf: str
    limits: dict[str, Any]
    runtimes: dict[str, Runtime]
    # Where the browser user's state lives and the script that writes it (browser-state).
    browser: dict[str, Any] | None = None
    # The browser gateway (design: volition-design-browser-gateway.md §3): the router listens
    # on one socket per provisioned project browser, `{root}/<slug>/gateway.sock` (Home:
    # `home`), and knows the caller's project from which socket accepted the connection — no
    # peer-cred lookup, unlike egress.sock/plan.sock. The project's directory is bound
    # read-only into each of its agent units at `target` (sandbox_properties in launcher.py);
    # a directory, so a router restart, which creates the socket anew, reaches units that run.
    browser_gateway: tuple[str, str] | None = None
    # Sockets a unit starts without when they are not there (bound with `-`): services that
    # are optional on a machine, such as local AI's model server (native/local-ai). Their
    # forwarders then refuse connections, and the runtime falls back as it would for a
    # server that is down.
    optional_sockets: tuple[str, ...] = ()
    # The runtimes' code the units bind read-only and every agent runs: Hermes' virtual
    # environment, its Python, its tools. Code only, never a secret. Every project user must be
    # able to read it; runtime_modes.py checks and repairs that (isolation.sh, the audit).
    shared_code: tuple[str, ...] = ()
    systemd_run: str = '/usr/bin/systemd-run'
    systemctl: str = '/usr/bin/systemctl'
    useradd: str = '/usr/sbin/useradd'
    userdel: str = '/usr/sbin/userdel'
    groupadd: str = '/usr/sbin/groupadd'
    extra: dict[str, Any] = field(default_factory=dict)


def _absolute(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.startswith('/') or '\0' in value or '/../' in f'{value}/':
        raise IsolationError('config', f'{name} must be an absolute path')
    return os.path.normpath(value)


def _strings(value: Any, name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise IsolationError('config', f'{name} must be a list of strings')
    return tuple(value)


def _runtime(name: str, value: Any) -> Runtime:
    if not isinstance(value, dict):
        raise IsolationError('config', f'runtime {name} must be an object')
    env = value.get('env') or {}
    if not isinstance(env, dict) or not all(
        isinstance(k, str) and ENV_NAME_RE.match(k) and isinstance(v, str) for k, v in env.items()
    ):
        raise IsolationError('config', f'runtime {name} env is invalid')
    binds = []
    required = []
    for entry in value.get('credentialBinds') or []:
        if not isinstance(entry, dict) or not isinstance(entry.get('required', False), bool):
            raise IsolationError('config', f'runtime {name} credentialBinds is invalid')
        source = _absolute(entry.get('source'), 'credential source')
        binds.append((source, str(entry.get('target', ''))))
        if entry.get('required'):
            required.append(source)
    links = value.get('profileLinks') or {}
    if not isinstance(links, dict) or not all(
        isinstance(k, str) and re.fullmatch(r'[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+){0,2}', k)
        and '..' not in k.split('/') and isinstance(v, str)
        for k, v in links.items()
    ):
        raise IsolationError('config', f'runtime {name} profileLinks is invalid')
    return Runtime(
        name=name,
        exec=_absolute(value.get('exec'), f'runtime {name} exec'),
        fixed_args=_strings(value.get('fixedArgs'), f'runtime {name} fixedArgs'),
        caller_args=value.get('callerArgs', True) is True,
        read_only=tuple(_absolute(p, 'readOnly') for p in _strings(value.get('readOnly'), 'readOnly')),
        optional_read_only=tuple(
            _absolute(p, 'optionalReadOnly') for p in _strings(value.get('optionalReadOnly'), 'optionalReadOnly')
        ),
        env=dict(env),
        credential_binds=tuple(binds),
        needs_profile=value.get('profile', True) is True,
        profile_links={k: _absolute(v, 'profile link') for k, v in links.items()},
        required_credentials=tuple(required),
    )


def load_config(path: str, *, require_root: bool = True) -> Config:
    """Reads the launcher's configuration. The root launcher only trusts a file root owns and
    nobody else can write, since every sandbox property comes from here."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise IsolationError('config', 'the configuration is not a regular file')
        if require_root and (info.st_uid != 0 or info.st_mode & 0o022):
            raise IsolationError('config', 'the configuration must be owned by root and not writable by others')
        with os.fdopen(os.dup(fd), 'rb') as handle:
            raw = json.loads(handle.read(1_048_576))
    finally:
        os.close(fd)
    if not isinstance(raw, dict) or raw.get('schemaVersion') != 1:
        raise IsolationError('config', 'unsupported configuration')
    prefix = raw.get('userPrefix', 'vp-')
    if not isinstance(prefix, str) or not re.fullmatch(r'[a-z][a-z0-9]{0,6}-', prefix):
        raise IsolationError('config', 'userPrefix is invalid')
    uid_range = raw.get('uidRange', [58000, 58899])
    if (
        not isinstance(uid_range, list)
        or len(uid_range) != 2
        or not all(isinstance(v, int) for v in uid_range)
        or not 1000 <= uid_range[0] < uid_range[1] < 60000
    ):
        raise IsolationError('config', 'uidRange is invalid')
    unit_prefix = raw.get('unitPrefix', 'volition-agent-')
    terminal_prefix = raw.get('terminalPrefix', 'volition-terminal-')
    for value, name in ((unit_prefix, 'unitPrefix'), (terminal_prefix, 'terminalPrefix')):
        if not isinstance(value, str) or not re.fullmatch(r'[a-z][a-z0-9-]{1,40}-', value):
            raise IsolationError('config', f'{name} is invalid')
    sockets = raw.get('sockets') or {}
    if not isinstance(sockets, dict) or not all(isinstance(k, str) and re.fullmatch(r'[a-z]{1,16}', k) for k in sockets):
        raise IsolationError('config', 'sockets is invalid')
    forwards = raw.get('forwards', {'egress': 3128, 'plan': 3000})
    if (
        not isinstance(forwards, dict)
        or not all(k in sockets for k in forwards)
        or not all(isinstance(v, int) and not isinstance(v, bool) and 1024 <= v <= 65535 for v in forwards.values())
        or len(set(forwards.values())) != len(forwards)
    ):
        raise IsolationError('config', 'forwards is invalid')
    optional_sockets = raw.get('optionalSockets', [])
    if not isinstance(optional_sockets, list) or not all(
        isinstance(name, str) and name in sockets and name not in {'egress', 'plan'}
        for name in optional_sockets
    ):
        raise IsolationError('config', 'optionalSockets is invalid')
    runtimes = raw.get('runtimes') or {}
    if not isinstance(runtimes, dict) or not runtimes:
        raise IsolationError('config', 'runtimes is missing')
    limits = raw.get('limits') or {}
    if not isinstance(limits, dict):
        raise IsolationError('config', 'limits is invalid')
    home_slug = raw.get('homeSlug', 'home')
    if not isinstance(home_slug, str) or not SLUG_RE.match(home_slug):
        raise IsolationError('config', 'homeSlug is invalid')
    callers = _strings(raw.get('callers'), 'callers')
    if not callers:
        raise IsolationError('config', 'callers is missing')
    return Config(
        callers=callers,
        user_prefix=prefix,
        agents_group=str(raw.get('agentsGroup', 'volition-agents')),
        uid_range=(uid_range[0], uid_range[1]),
        unit_prefix=unit_prefix,
        terminal_prefix=terminal_prefix,
        registry_root=_absolute(raw.get('registryRoot'), 'registryRoot'),
        workspace_root=_absolute(raw.get('workspaceRoot'), 'workspaceRoot'),
        home_workspace=_absolute(raw.get('homeWorkspace'), 'homeWorkspace'),
        profiles_root=_absolute(raw.get('profilesRoot'), 'profilesRoot'),
        vault_root=_absolute(raw.get('vaultRoot'), 'vaultRoot'),
        home_slug=home_slug,
        runner_user=str(raw.get('runnerUser', 'volition-hermes')),
        readers_group=str(raw.get('readersGroup', 'volition')),
        state_root=_absolute(raw.get('stateRoot', '/var/lib/volition-agent-launcher'), 'stateRoot'),
        python=_absolute(raw.get('python', '/usr/bin/python3'), 'python'),
        sandbox=_absolute(raw.get('sandbox'), 'sandbox'),
        sockets={k: _absolute(v, f'socket {k}') for k, v in sockets.items()},
        forwards=dict(forwards),
        hide=tuple(_absolute(p, 'hide') for p in _strings(raw.get('hide'), 'hide')),
        inaccessible=tuple(_absolute(p, 'inaccessible') for p in _strings(raw.get('inaccessible'), 'inaccessible')),
        path=str(raw.get('path', '/usr/local/bin:/usr/bin:/bin')),
        tmux_conf=_absolute(raw.get('tmuxConf', '/usr/local/lib/volition-isolation/tmux.conf'), 'tmuxConf'),
        limits=limits,
        runtimes={name: _runtime(name, value) for name, value in runtimes.items()},
        systemd_run=_absolute(raw.get('systemdRun', '/usr/bin/systemd-run'), 'systemdRun'),
        systemctl=_absolute(raw.get('systemctl', '/usr/bin/systemctl'), 'systemctl'),
        browser=_browser(raw.get('browser')),
        browser_gateway=_browser_gateway(raw.get('browserGateway')),
        optional_sockets=tuple(optional_sockets),
        shared_code=_shared_code(raw.get('sharedCode')),
        extra={k: v for k, v in raw.items() if k in {'test'}},
    )


# Trees root opens to every reader (runtime_modes.py repair): never / or a top-level system
# directory, and nothing below /etc, /boot or the kernel's file systems.
_SHARED_CODE_REFUSED = ('/', '/etc', '/root', '/home', '/usr', '/var', '/var/lib', '/srv', '/opt', '/run', '/tmp',
                        '/boot')


def _shared_code(value: Any) -> tuple[str, ...]:
    paths = tuple(_absolute(p, 'sharedCode') for p in _strings(value, 'sharedCode'))
    for path in paths:
        if path in _SHARED_CODE_REFUSED or path.startswith(('/etc/', '/boot/', '/proc/', '/sys/', '/dev/')):
            raise IsolationError('config', f'sharedCode may not name {path}')
    return paths


def _browser_gateway(value: Any) -> tuple[str, str] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {'root', 'target'}:
        raise IsolationError('config', 'browserGateway is invalid')
    return (
        _absolute(value.get('root'), 'browserGateway root'),
        _absolute(value.get('target'), 'browserGateway target'),
    )


def _browser(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or not isinstance(value.get('user'), str):
        raise IsolationError('config', 'browser is invalid')
    bases = value.get('bases') or {}
    names = {'display': 'PROJECT_BROWSER_DISPLAY_BASE', 'cdp': 'PROJECT_BROWSER_CDP_PORT_BASE',
             'vnc': 'PROJECT_BROWSER_VNC_PORT_BASE', 'noVnc': 'PROJECT_BROWSER_NOVNC_PORT_BASE'}
    if not isinstance(bases, dict) or set(bases) - set(names) or not all(
            isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 65535 for v in bases.values()):
        raise IsolationError('config', 'browser bases are invalid')
    return {
        'user': value['user'],
        'root': _absolute(value.get('root'), 'browser root'),
        'trash': _absolute(value.get('trash'), 'browser trash'),
        'script': _absolute(value.get('script'), 'browser script'),
        'node': _absolute(value.get('node', '/usr/local/bin/node'), 'browser node'),
        'env': {names[k]: str(v) for k, v in bases.items()},
    }


# ── Names ────────────────────────────────────────────────────────────────────────────────


def valid_slug(slug: Any) -> bool:
    # No double dash: it separates the slug from the rest of a unit name.
    return (
        isinstance(slug, str)
        and bool(SLUG_RE.match(slug))
        and '--' not in slug
        and not slug.endswith('-')
        and slug not in RESERVED_SLUGS
    )


def project_user(config: Config, slug: str) -> str:
    if not valid_slug(slug):
        raise IsolationError('slug', 'invalid project slug')
    return f'{config.user_prefix}{slug}'


def slug_of_user(config: Config, name: str) -> str | None:
    if not name.startswith(config.user_prefix):
        return None
    slug = name[len(config.user_prefix):]
    return slug if valid_slug(slug) else None


def profile_slug(profile: str) -> str | None:
    match = PROFILE_RE.match(profile) if isinstance(profile, str) else None
    return match.group('slug') if match else None


# A unit's name carries what the egress proxy and the Plan socket log about it:
# <prefix><slug>--a<agentId>-<kind><id>-<nonce>.service, kind r (run), c (chat), h (helper),
# t (terminal). Plain ASCII, so it survives the cgroup path unchanged.
UNIT_RE = re.compile(
    r'^(?P<prefix>[a-z][a-z0-9-]*-)(?P<slug>[a-z0-9][a-z0-9-]{0,28})--a(?P<agent>0|[1-9][0-9]{0,9})'
    r'-(?P<kind>[rcht])(?P<id>0|[1-9][0-9]{0,11})-(?P<nonce>[0-9a-f]{8,16})\.service$'
)


def unit_name(prefix: str, slug: str, agent_id: int | None, kind: str, work_id: int | None, nonce: str) -> str:
    return f'{prefix}{slug}--a{agent_id or 0}-{kind}{work_id or 0}-{nonce}.service'


def parse_unit(name: str, prefix: str) -> dict[str, Any] | None:
    match = UNIT_RE.match(name or '')
    if not match or match.group('prefix') != prefix:
        return None
    agent = int(match.group('agent'))
    work = int(match.group('id'))
    kind = match.group('kind')
    return {
        'unit': name,
        'slug': match.group('slug'),
        'agentId': agent or None,
        'kind': kind,
        'runId': (work or None) if kind == 'r' else None,
        'messageId': (work or None) if kind == 'c' else None,
    }


# ── Peers ────────────────────────────────────────────────────────────────────────────────

_UCRED = struct.Struct('3i')


def peer_credentials(sock: socket.socket) -> tuple[int, int, int]:
    """(pid, uid, gid) of the process that connected, as the kernel recorded it at connect."""
    data = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, _UCRED.size)
    pid, uid, gid = _UCRED.unpack(data)
    return pid, uid, gid


def unit_of_pid(pid: int) -> str | None:
    """The systemd unit a process runs in, from its cgroup (cgroup v2)."""
    try:
        with open(f'/proc/{int(pid)}/cgroup', 'r', encoding='ascii', errors='replace') as handle:
            lines = handle.read(8192).splitlines()
    except OSError:
        return None
    for line in lines:
        if line.startswith('0::'):
            for part in reversed(line[3:].split('/')):
                if part.endswith('.service'):
                    return part
    return None


# ── Paths ────────────────────────────────────────────────────────────────────────────────

O_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def open_path_nofollow(path: str) -> int:
    """Opens a directory by walking every component from / without following a symbolic
    link anywhere, so a path whose parents someone else can change cannot lead elsewhere."""
    if not path.startswith('/'):
        raise IsolationError('path', 'path must be absolute')
    parts = [part for part in path.split('/') if part]
    fd = os.open('/', O_DIR)
    try:
        for part in parts:
            if part in ('.', '..'):
                raise IsolationError('path', 'path must be normalized')
            try:
                next_fd = os.open(part, O_DIR, dir_fd=fd)
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.ENOTDIR):
                    raise IsolationError('path', f'{path} contains a link or a non-directory') from error
                raise
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def adopt_tree(fd: int, uid: int, gid: int | None, *, only_uid: int, limit: int = 100_000) -> int:
    """Gives the directory at fd and everything below it that belongs to `only_uid` to
    uid:gid (gid None keeps each entry's group), walking by file descriptor. Links are never followed or changed, and a regular
    file with more than one name is left alone, so nothing outside the tree can be reached
    through it. Returns how many entries changed owner; stops after `limit` entries."""
    seen = 0
    changed = 0

    def own(entry_fd: int, info: os.stat_result) -> None:
        nonlocal changed
        wanted = info.st_gid if gid is None else gid
        if info.st_uid == only_uid and (info.st_uid, info.st_gid) != (uid, wanted):
            os.fchown(entry_fd, uid, wanted)
            changed += 1

    def visit(dir_fd: int, depth: int) -> None:
        nonlocal seen
        if depth > 64:
            return
        for name in os.listdir(dir_fd):
            seen += 1
            if seen > limit:
                return
            info = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, O_DIR, dir_fd=dir_fd)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOCTTY | os.O_CLOEXEC,
                                dir_fd=dir_fd)
            else:
                continue
            try:
                opened = os.fstat(child)
                if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                    continue
                own(child, opened)
                if stat.S_ISDIR(opened.st_mode):
                    visit(child, depth + 1)
            finally:
                os.close(child)

    own(fd, os.fstat(fd))
    visit(fd, 0)
    return changed


def is_real_directory(path: str) -> bool:
    try:
        fd = open_path_nofollow(path)
    except (OSError, IsolationError):
        return False
    os.close(fd)
    return True


def within(root: str, candidate: str) -> bool:
    root = os.path.normpath(root)
    candidate = os.path.normpath(candidate)
    return candidate == root or candidate.startswith(root.rstrip('/') + '/')


# ── POSIX ACLs ───────────────────────────────────────────────────────────────────────────
# The kernel's xattr form (system.posix_acl_access / _default): a version header followed by
# (tag, perm, id) entries. Written through a file descriptor, so no path is followed.

ACL_VERSION = 2
ACL_USER_OBJ = 0x01
ACL_USER = 0x02
ACL_GROUP_OBJ = 0x04
ACL_GROUP = 0x08
ACL_MASK = 0x10
ACL_OTHER = 0x20
ACL_UNDEFINED_ID = 0xFFFFFFFF
_ACL_HEADER = struct.Struct('<I')
_ACL_ENTRY = struct.Struct('<HHI')
ACCESS = 'system.posix_acl_access'
DEFAULT = 'system.posix_acl_default'


def acl_decode(data: bytes) -> list[tuple[int, int, int]]:
    if len(data) < _ACL_HEADER.size or (len(data) - _ACL_HEADER.size) % _ACL_ENTRY.size:
        raise ValueError('malformed ACL')
    (version,) = _ACL_HEADER.unpack_from(data, 0)
    if version != ACL_VERSION:
        raise ValueError('unsupported ACL version')
    return [
        _ACL_ENTRY.unpack_from(data, offset)
        for offset in range(_ACL_HEADER.size, len(data), _ACL_ENTRY.size)
    ]


def acl_encode(entries: list[tuple[int, int, int]]) -> bytes:
    order = {ACL_USER_OBJ: 0, ACL_USER: 1, ACL_GROUP_OBJ: 2, ACL_GROUP: 3, ACL_MASK: 4, ACL_OTHER: 5}
    ordered = sorted(entries, key=lambda e: (order[e[0]], e[2] if e[0] in (ACL_USER, ACL_GROUP) else 0))
    return _ACL_HEADER.pack(ACL_VERSION) + b''.join(_ACL_ENTRY.pack(*entry) for entry in ordered)


def _base_entries(mode: int) -> list[tuple[int, int, int]]:
    return [
        (ACL_USER_OBJ, (mode >> 6) & 7, ACL_UNDEFINED_ID),
        (ACL_GROUP_OBJ, (mode >> 3) & 7, ACL_UNDEFINED_ID),
        (ACL_OTHER, mode & 7, ACL_UNDEFINED_ID),
    ]


def acl_with(
    entries: list[tuple[int, int, int]],
    named: dict[tuple[int, int], int],
    *,
    remove: set[tuple[int, int]] = frozenset(),
    group_obj: int | None = None,
    other: int | None = None,
) -> list[tuple[int, int, int]]:
    """Entries with the named (tag, id) → perm set and `remove` dropped; the mask is
    recomputed the way setfacl does: the union of the group class."""
    kept = [
        e for e in entries
        if e[0] != ACL_MASK and (e[0], e[2]) not in named and (e[0], e[2]) not in remove
    ]
    if group_obj is not None:
        kept = [(t, group_obj if t == ACL_GROUP_OBJ else p, i) for t, p, i in kept]
    if other is not None:
        kept = [(t, other if t == ACL_OTHER else p, i) for t, p, i in kept]
    kept += [(tag, perm, ident) for (tag, ident), perm in named.items()]
    group_class = [p for t, p, _ in kept if t in (ACL_USER, ACL_GROUP, ACL_GROUP_OBJ)]
    if any(t in (ACL_USER, ACL_GROUP) for t, _, _ in kept):
        mask = 0
        for perm in group_class:
            mask |= perm
        kept.append((ACL_MASK, mask, ACL_UNDEFINED_ID))
    return kept


def read_acl(fd: int, name: str, mode: int) -> list[tuple[int, int, int]] | None:
    try:
        return acl_decode(os.getxattr(fd, name))
    except OSError as error:
        if error.errno in (errno.ENODATA, getattr(errno, 'ENOATTR', errno.ENODATA)):
            return _base_entries(mode) if name == ACCESS else None
        raise


def set_acl(
    fd: int,
    named: dict[tuple[int, int], int],
    *,
    default: bool,
    remove: set[tuple[int, int]] = frozenset(),
    group_obj: int | None = None,
    other: int | None = None,
    dry_run: bool = False,
) -> bool:
    """Adds or replaces named entries in the ACL of an open file, and in its default ACL
    when `default` (directories only). Answers whether anything changed."""
    info = os.fstat(fd)
    changed = False
    targets = [ACCESS] + ([DEFAULT] if default and stat.S_ISDIR(info.st_mode) else [])
    for name in targets:
        current = read_acl(fd, name, info.st_mode)
        base = current if current is not None else read_acl(fd, ACCESS, info.st_mode)
        desired = acl_with(base or _base_entries(info.st_mode), named, remove=remove,
                           group_obj=group_obj, other=other)
        if current is None or sorted(desired) != sorted(current):
            changed = True
            if not dry_run:
                os.setxattr(fd, name, acl_encode(desired))
    return changed


def describe_acl(entries: list[tuple[int, int, int]], names: dict[int, str] | None = None) -> str:
    names = names or {}
    rendered = []
    labels = {ACL_USER_OBJ: 'u:', ACL_USER: 'u:', ACL_GROUP_OBJ: 'g:', ACL_GROUP: 'g:', ACL_MASK: 'm:', ACL_OTHER: 'o:'}
    for tag, perm, ident in entries:
        who = names.get(ident, str(ident)) if tag in (ACL_USER, ACL_GROUP) else ''
        bits = ''.join(c if perm & b else '-' for c, b in (('r', 4), ('w', 2), ('x', 1)))
        rendered.append(f'{labels[tag]}{who}:{bits}')
    return ','.join(rendered)


# ── HTTP heads ───────────────────────────────────────────────────────────────────────────
# The egress proxy and the Plan socket read one request head each and build what they send
# on from the parsed values, never from the raw bytes.

HEAD_LIMIT = 32 * 1024
TOKEN_RE = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
FIELD_VALUE_RE = re.compile(r'^[\t\x20-\x7e\x80-\xff]*$')


class HttpError(Exception):
    def __init__(self, status: int, reason: str):
        super().__init__(reason)
        self.status = status
        self.reason = reason


@dataclass
class RequestHead:
    method: str
    target: str
    version: str
    headers: list[tuple[str, str]]

    def get(self, name: str) -> list[str]:
        name = name.lower()
        return [value for key, value in self.headers if key.lower() == name]


def parse_request_head(raw: bytes) -> RequestHead:
    """A strict HTTP/1.x request head: no obsolete line folding, no bare CR or LF, no
    whitespace before a colon, header names and values of the allowed characters only."""
    if not raw.endswith(b'\r\n\r\n'):
        raise HttpError(400, 'incomplete head')
    try:
        text = raw[:-4].decode('latin-1')
    except UnicodeDecodeError:
        raise HttpError(400, 'invalid head') from None
    lines = text.split('\r\n')
    if any('\n' in line or '\r' in line for line in lines):
        raise HttpError(400, 'bare line break')
    parts = lines[0].split(' ')
    if len(parts) != 3 or parts[2] not in ('HTTP/1.1', 'HTTP/1.0') or not TOKEN_RE.match(parts[0]):
        raise HttpError(400, 'invalid request line')
    method, target, version = parts
    if not target or any(ord(c) <= 0x20 or ord(c) >= 0x7f for c in target):
        raise HttpError(400, 'invalid request target')
    headers = []
    for line in lines[1:]:
        if not line or line[0] in ' \t':
            raise HttpError(400, 'folded or empty header line')
        name, sep, value = line.partition(':')
        if not sep or not TOKEN_RE.match(name):
            raise HttpError(400, 'invalid header name')
        value = value.strip(' \t')
        if not FIELD_VALUE_RE.match(value):
            raise HttpError(400, 'invalid header value')
        headers.append((name, value))
        if len(headers) > 100:
            raise HttpError(431, 'too many headers')
    return RequestHead(method, target, version, headers)


async def read_head(reader, limit: int = HEAD_LIMIT) -> bytes:
    """Reads up to and including the blank line that ends a head; everything after it stays
    in the reader."""
    import asyncio

    try:
        return await reader.readuntil(b'\r\n\r\n')
    except asyncio.LimitOverrunError:
        raise HttpError(431, 'head too large') from None
    except asyncio.IncompleteReadError as error:
        if not error.partial:
            raise HttpError(0, 'closed') from None
        raise HttpError(400, 'incomplete head') from None


HOST_RE = re.compile(r'^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$')


def normalize_host(host: str) -> str | None:
    """A host name in lower case without a trailing dot, or an IP literal without brackets."""
    import ipaddress

    host = host.strip().lower()
    if host.startswith('[') and host.endswith(']'):
        host = host[1:-1]
        try:
            return str(ipaddress.IPv6Address(host))
        except ValueError:
            return None
    if host.endswith('.'):
        host = host[:-1]
    try:
        return str(ipaddress.IPv4Address(host))
    except ValueError:
        pass
    try:
        host = host.encode('idna').decode('ascii')
    except UnicodeError:
        return None
    return host if HOST_RE.match(host) and not host.replace('.', '').isdigit() else None


def split_host_port(value: str, default_port: int | None) -> tuple[str, int]:
    if value.startswith('['):
        end = value.find(']')
        if end < 0:
            raise HttpError(400, 'invalid host')
        host, rest = value[:end + 1], value[end + 1:]
    else:
        host, _, port_text = value.rpartition(':') if value.count(':') == 1 else (value, '', '')
        rest = f':{port_text}' if port_text else ''
        if not host:
            host, rest = value, ''
    if rest:
        if not rest.startswith(':') or not rest[1:].isdigit():
            raise HttpError(400, 'invalid port')
        port = int(rest[1:])
    elif default_port is not None:
        port = default_port
    else:
        raise HttpError(400, 'port missing')
    if not 1 <= port <= 65535:
        raise HttpError(400, 'invalid port')
    normalized = normalize_host(host)
    if normalized is None:
        raise HttpError(400, 'invalid host')
    return normalized, port


def unix_server_options(activated: bool) -> dict:
    """Keyword arguments for asyncio.start_unix_server. Python 3.13 removes a Unix socket's
    file when the server closes; a socket systemd handed over belongs to its .socket unit,
    which keeps listening after the service stops, so its file must stay (2026-09-24: a
    launcher restart left launch.sock gone and every isolated agent unable to start)."""
    return {'cleanup_socket': False} if activated and sys.version_info >= (3, 13) else {}
