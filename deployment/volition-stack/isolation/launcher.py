#!/usr/bin/python3 -I
"""volition-agent-launcher: starts agent runs, helper runs and project terminals as the
project's own Unix user, in a sandbox whose properties are fixed here.

It runs as root, socket-activated, and accepts connections only from the runner user
(volition-hermes). A request names a project, a runtime of the configured list, a profile
of that project and a working directory in its workspace; it can never name a property of
the unit. See README.md for the protocol and the sandbox.
"""

from __future__ import annotations

import asyncio
import errno
import fcntl
import grp
import json
import os
import pwd
import secrets
import signal
import socket
import stat
import struct
import sys
import termios
import time

HERE = os.path.dirname(os.path.realpath(__file__))


def _trusted_directory(path: str) -> None:
    """The launcher imports code next to it, so that directory has to be root's alone."""
    info = os.stat(path)
    if os.geteuid() == 0 and (info.st_uid != 0 or info.st_mode & 0o022):
        raise SystemExit(f'{path} must be owned by root and not writable by others')


_trusted_directory(HERE)
sys.path.insert(0, HERE)

from isolation_common import (  # noqa: E402
    unix_server_options,
    ACL_GROUP,
    ACL_USER,
    Config,
    IsolationError,
    O_DIR,
    PROFILE_RE,
    PROJECT_KEY_RE,
    ENV_NAME_RE,
    adopt_tree,
    load_config,
    open_path_nofollow,
    peer_credentials,
    profile_slug,
    project_user,
    set_acl,
    unit_name,
    valid_slug,
    within,
)

FRAME = struct.Struct('>BI')
# Client → launcher
T_STDIN, T_EOF, T_RESIZE, T_STOP = 0x01, 0x02, 0x03, 0x04
# Launcher → client
T_ACCEPT, T_STDOUT, T_STDERR, T_EXIT, T_ERROR, T_RESULT = 0x10, 0x11, 0x12, 0x13, 0x14, 0x15

MAX_REQUEST = 2 * 1024 * 1024
MAX_FRAME = 1024 * 1024
MAX_ARGS_BYTES = 1024 * 1024
MAX_ENV_BYTES = 1024 * 1024
# Characters a path may have to go into a BindPaths=/WorkingDirectory= property unquoted.
SAFE_PATH = __import__('re').compile(r'^/[A-Za-z0-9._@+/-]*$')
# Variables the launcher and the sandbox set; a caller cannot override them.
RESERVED_ENV = {
    'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'HERMES_HOME', 'HERMES_HOME_MODE', 'PYTHONPATH',
    'PYTHONHOME', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'TMPDIR', 'XDG_RUNTIME_DIR',
    'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT', 'CREDENTIALS_DIRECTORY', 'NOTIFY_SOCKET',
}
# VOLITION_AGENT_* is the sandbox's own; other VOLITION_ variables (the vault access of the
# approval guard) are the runtime's.
RESERVED_ENV_PREFIXES = ('VOLITION_AGENT_', 'SYSTEMD_')
PROXY_ENV = {'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'ftp_proxy'}
WORK_KINDS = {'run': 'r', 'chat': 'c', 'helper': 'h'}
REQUEST_KEYS = {
    'ping': {'v', 'op'},
    'run': {'v', 'op', 'slug', 'profile', 'runtime', 'args', 'env', 'cwd', 'agentId', 'work', 'limits'},
    'terminal': {'v', 'op', 'slug', 'rows', 'cols'},
    'terminal-stop': {'v', 'op', 'slug'},
    'ensure-project-user': {'v', 'op', 'slug', 'profiles'},
    'remove-project-user': {'v', 'op', 'slug'},
    'browser-state': {'v', 'op', 'action', 'slug', 'projectId', 'eventId'},
}
REQUIRED_KEYS = {
    'ping': {'v', 'op'},
    'run': {'v', 'op', 'slug', 'runtime', 'args', 'env', 'cwd'},
    'terminal': {'v', 'op', 'slug'},
    'terminal-stop': {'v', 'op', 'slug'},
    'ensure-project-user': {'v', 'op', 'slug'},
    'remove-project-user': {'v', 'op', 'slug'},
    'browser-state': {'v', 'op', 'action', 'slug', 'projectId'},
}
EVENT_ID = __import__('re').compile(r'^[A-Za-z0-9-]{1,64}$')


def log(message: str) -> None:
    print(f'volition-agent-launcher: {message}', file=sys.stderr, flush=True)


def frame(kind: int, payload: bytes = b'') -> bytes:
    return FRAME.pack(kind, len(payload)) + payload


def json_frame(kind: int, value: object) -> bytes:
    return frame(kind, json.dumps(value, separators=(',', ':')).encode())


async def read_frame(reader: asyncio.StreamReader) -> tuple[int, bytes] | None:
    try:
        head = await reader.readexactly(FRAME.size)
    except (asyncio.IncompleteReadError, ConnectionError):
        return None
    kind, length = FRAME.unpack(head)
    if length > MAX_FRAME:
        raise IsolationError('frame', 'frame too large')
    try:
        return kind, await reader.readexactly(length)
    except (asyncio.IncompleteReadError, ConnectionError):
        return None


def _int_or_none(value: object, name: str, low: int = 1, high: int = 10**12) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise IsolationError('request', f'{name} is invalid')
    return value


def _safe_path(path: str, name: str) -> str:
    if not isinstance(path, str) or not SAFE_PATH.match(path) or '//' in path or '/./' in f'{path}/' or '/../' in f'{path}/':
        raise IsolationError('path', f'{name} is not a plain absolute path')
    return os.path.normpath(path)


class Launcher:
    def __init__(self, config: Config):
        self.config = config
        self.active: dict[str, int] = {}
        self.total = 0
        self.lock = asyncio.Lock()
        self.user_lock = asyncio.Lock()
        self.agents_gid = grp.getgrnam(config.agents_group).gr_gid

    # ── Identity ───────────────────────────────────────────────────────────────────────

    def registry_key(self, slug: str) -> str | None:
        """The project key the provisioning registry names for a slug, None for Home. A slug
        without a registry entry is not a provisioned project and is refused."""
        if slug == self.config.home_slug:
            return None
        fd = open_path_nofollow(self.config.registry_root)
        try:
            try:
                file_fd = os.open(f'{slug}.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            except FileNotFoundError:
                raise IsolationError('slug', 'the project is not provisioned') from None
            with os.fdopen(file_fd, 'rb') as handle:
                if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                    raise IsolationError('slug', 'the project registry entry is invalid')
                registry = json.loads(handle.read(1_048_576))
        finally:
            os.close(fd)
        key = (registry.get('project') or {}).get('key') if isinstance(registry, dict) else None
        if registry.get('slug') != slug or not isinstance(key, str) or not PROJECT_KEY_RE.match(key):
            raise IsolationError('slug', 'the project registry entry is invalid')
        return key

    def project_account(self, slug: str) -> pwd.struct_passwd:
        name = project_user(self.config, slug)
        try:
            account = pwd.getpwnam(name)
        except KeyError:
            raise IsolationError('user', 'the project has no Unix user yet') from None
        low, high = self.config.uid_range
        if not low <= account.pw_uid <= high:
            raise IsolationError('user', 'the project user is outside the isolated range')
        if name not in grp.getgrgid(self.agents_gid).gr_mem:
            raise IsolationError('user', 'the project user is not an agent user')
        return account

    def workspace(self, slug: str) -> str:
        if slug == self.config.home_slug:
            return self.config.home_workspace
        return os.path.join(self.config.workspace_root, slug)

    def vault_binds(self, slug: str, key: str | None) -> tuple[list[str], list[str]]:
        """(read-write, read-only) vault folders: the project's own, or for Home its own folder
        and every project folder read-only."""
        root = self.config.vault_root
        if slug == self.config.home_slug:
            return [os.path.join(root, 'Home')], [os.path.join(root, 'Projects')]
        return [os.path.join(root, 'Projects', key)], []

    def owned_directory(self, path: str, uid: int) -> bool:
        try:
            fd = open_path_nofollow(path)
        except (OSError, IsolationError):
            return False
        try:
            return os.fstat(fd).st_uid == uid
        finally:
            os.close(fd)

    # ── Requests ───────────────────────────────────────────────────────────────────────

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            sock = writer.get_extra_info('socket')
            _pid, uid, _gid = peer_credentials(sock)
            try:
                caller = pwd.getpwuid(uid).pw_name
            except KeyError:
                caller = str(uid)
            if uid != 0 and caller not in self.config.callers:
                log(f'refused a request from {caller}')
                raise IsolationError('caller', 'this user may not start agents')
            try:
                line = await asyncio.wait_for(reader.readuntil(b'\n'), timeout=30)
            except (asyncio.LimitOverrunError, asyncio.IncompleteReadError, asyncio.TimeoutError):
                raise IsolationError('request', 'no request line') from None
            try:
                request = json.loads(line)
            except ValueError:
                raise IsolationError('request', 'the request is not JSON') from None
            op = request.get('op') if isinstance(request, dict) else None
            if op not in REQUEST_KEYS or request.get('v') != 1:
                raise IsolationError('request', 'unknown operation')
            keys = set(request)
            if not keys <= REQUEST_KEYS[op] or not REQUIRED_KEYS[op] <= keys:
                # A property, a user or any other field the protocol does not have.
                raise IsolationError('request', f'unexpected fields: {sorted(keys - REQUEST_KEYS[op])}')
            if op == 'ping':
                writer.write(json_frame(T_RESULT, {'ok': True}))
            elif op == 'run':
                await self.run(request, reader, writer, caller)
            elif op == 'terminal':
                await self.terminal(request, reader, writer, caller)
            elif op == 'terminal-stop':
                await self.terminal_stop(request, writer)
            elif op == 'ensure-project-user':
                await self.ensure_project_user(request, writer, caller)
            elif op == 'remove-project-user':
                await self.remove_project_user(request, writer, caller)
            elif op == 'browser-state':
                await self.browser_state(request, writer, caller)
        except IsolationError as error:
            try:
                writer.write(json_frame(T_ERROR, {'error': error.code, 'message': error.message}))
            except (ConnectionError, RuntimeError):
                pass
        except (ConnectionError, asyncio.CancelledError):
            pass
        except Exception as error:  # noqa: BLE001 - never let one request stop the launcher
            log(f'request failed: {type(error).__name__}: {error}')
            try:
                writer.write(json_frame(T_ERROR, {'error': 'internal', 'message': 'the launcher failed'}))
            except (ConnectionError, RuntimeError):
                pass
        finally:
            try:
                await writer.drain()
                writer.close()
                await writer.wait_closed()
            except (ConnectionError, RuntimeError, asyncio.CancelledError):
                pass

    # ── Units ──────────────────────────────────────────────────────────────────────────

    def limits(self, requested: object) -> dict[str, str]:
        limits = self.config.limits
        runtime = int(limits.get('runtimeMaxSec', 7200))
        ceiling = int(limits.get('runtimeMaxSecLimit', 14400))
        if requested is not None:
            if not isinstance(requested, dict) or set(requested) - {'runtimeMaxSec'}:
                raise IsolationError('request', 'limits is invalid')
            asked = _int_or_none(requested.get('runtimeMaxSec'), 'runtimeMaxSec', 30, 86400)
            if asked is not None:
                runtime = min(asked, ceiling)
        return {
            'MemoryMax': str(limits.get('memoryMax', '4G')),
            'CPUQuota': str(limits.get('cpuQuota', '200%')),
            'TasksMax': str(int(limits.get('tasksMax', 512))),
            'RuntimeMaxSec': str(runtime),
        }

    def browser_gateway_bind(self, slug: str) -> str | None:
        """Read-only bind of this project's own browser-gateway directory into the unit, at the
        fixed in-unit path the MCP shim looks in (`<target>/gateway.sock`, see
        packages/browser-gateway/src/shim-protocol.ts). The router listens on
        `{root}/<slug>/gateway.sock` (Home: `home`) and knows the caller's project from the
        socket that accepted it, so only the project's own directory is bound. Optional (`-`):
        an agent of a project without a browser, or while the router is down, still starts;
        its browser tools then answer that the gateway cannot be reached."""
        if not self.config.browser_gateway:
            return None
        root, target = self.config.browser_gateway
        source = os.path.join(root, slug)
        return (
            f'BindReadOnlyPaths=-{_safe_path(source, "browser gateway directory")}'
            f':{_safe_path(target, "browser gateway target")}'
        )

    def sandbox_properties(
        self,
        slug: str,
        account: pwd.struct_passwd,
        rw: list[str],
        ro: list[str],
        limits: dict[str, str],
    ) -> list[str]:
        """Every property of an agent unit. Nothing here comes from a request but the user
        and the browser-gateway socket, which the slug names, and paths the launcher derived
        and checked itself."""
        config = self.config
        props = [
            f'User={account.pw_name}',
            f'Group={grp.getgrgid(account.pw_gid).gr_name}',
            'PrivateNetwork=yes',
            'PrivateTmp=yes',
            'PrivateDevices=yes',
            'PrivateIPC=yes',
            'ProtectSystem=strict',
            'ProtectHome=yes',
            'ProtectKernelTunables=yes',
            'ProtectKernelModules=yes',
            'ProtectKernelLogs=yes',
            'ProtectControlGroups=yes',
            'ProtectClock=yes',
            'ProtectHostname=yes',
            'ProtectProc=invisible',
            'NoNewPrivileges=yes',
            'CapabilityBoundingSet=',
            'AmbientCapabilities=',
            'RestrictSUIDSGID=yes',
            'RestrictNamespaces=yes',
            'RestrictRealtime=yes',
            'LockPersonality=yes',
            'KeyringMode=private',
            'SystemCallArchitectures=native',
            'SystemCallFilter=@system-service',
            'SystemCallErrorNumber=EPERM',
            'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
            'UMask=0007',
            'KillMode=control-group',
            'KillSignal=SIGINT',
            f'TimeoutStopSec={int(config.limits.get("stopGraceSec", 10))}',
            'SendSIGKILL=yes',
            'TemporaryFileSystem=/run:ro',
            'TemporaryFileSystem=/dev/shm',
        ]
        props += [f'{key}={value}' for key, value in limits.items()]
        props += [f'TemporaryFileSystem={path}:ro' for path in config.hide]
        props += [f'InaccessiblePaths=-{path}' for path in config.inaccessible]
        props += [f'BindReadOnlyPaths={path}' for path in config.sockets.values()]
        gateway_bind = self.browser_gateway_bind(slug)
        if gateway_bind:
            props.append(gateway_bind)
        for path in rw:
            props.append(f'BindPaths={_safe_path(path, "bind")}')
        for path in ro:
            props.append(f'BindReadOnlyPaths={_safe_path(path, "bind")}')
        return props

    def runtime_binds(self, runtime, home: str | None) -> tuple[list[str], list[str]]:
        ro = list(runtime.read_only)
        ro += [path for path in runtime.optional_read_only if os.path.lexists(path)]
        ro.append(os.path.dirname(self.config.sandbox))
        extra = []
        for source, target in runtime.credential_binds:
            if not os.path.exists(source):
                continue
            destination = target.replace('{home}', home or '/nonexistent')
            extra.append(f'BindReadOnlyPaths={_safe_path(source, "credential")}:{_safe_path(destination, "credential target")}')
        return ro, extra

    def base_env(self, account: pwd.struct_passwd, home: str, runtime) -> list[str]:
        env = {
            'HOME': home,
            'USER': account.pw_name,
            'LOGNAME': account.pw_name,
            'PATH': self.config.path,
            'LANG': 'C.UTF-8',
            'VOLITION_AGENT_SANDBOX': '1',
        }
        if runtime.needs_profile:
            env['HERMES_HOME'] = home
        env.update(runtime.env)
        return [f'--setenv={key}={value}' for key, value in env.items()]

    def sandbox_args(self, mode: str, runtime, home: str | None, extra: list[str]) -> list[str]:
        args = [self.config.python, '-I', self.config.sandbox, mode]
        for name, port in self.config.forwards.items():
            args += ['--forward', f'{int(port)}={self.config.sockets[name]}']
        if home and runtime is not None:
            for link, target in runtime.profile_links.items():
                if os.path.lexists(target):
                    args += ['--link', f'{link}={target}']
        return args + extra

    async def systemctl(self, *args: str, timeout: float = 60) -> int:
        process = await asyncio.create_subprocess_exec(
            self.config.systemctl, *args,
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            return await asyncio.wait_for(process.wait(), timeout)
        except asyncio.TimeoutError:
            process.kill()
            return -1

    async def stop_unit(self, unit: str) -> None:
        # KillSignal=SIGINT lets the runtime end its turn; TimeoutStopSec later SIGKILL.
        await self.systemctl('stop', unit, timeout=120)

    async def reserve(self, slug: str) -> None:
        async with self.lock:
            per_project = int(self.config.limits.get('maxUnitsPerProject', 24))
            total = int(self.config.limits.get('maxUnits', 96))
            if self.active.get(slug, 0) >= per_project or self.total >= total:
                raise IsolationError('busy', 'too many agent units are running')
            self.active[slug] = self.active.get(slug, 0) + 1
            self.total += 1

    async def release(self, slug: str) -> None:
        async with self.lock:
            self.active[slug] = max(0, self.active.get(slug, 0) - 1)
            self.total = max(0, self.total - 1)

    # ── run ────────────────────────────────────────────────────────────────────────────

    def check_run(self, request: dict) -> dict:
        config = self.config
        slug = request['slug']
        if not valid_slug(slug):
            raise IsolationError('slug', 'invalid project slug')
        key = self.registry_key(slug)
        account = self.project_account(slug)
        runtime = config.runtimes.get(request['runtime']) if isinstance(request['runtime'], str) else None
        if runtime is None:
            raise IsolationError('runtime', 'unknown runtime')

        profile = request.get('profile')
        home_dir = None
        if runtime.needs_profile:
            if not isinstance(profile, str) or not PROFILE_RE.match(profile):
                raise IsolationError('profile', 'invalid profile')
            if slug == config.home_slug:
                if profile != config.home_slug:
                    raise IsolationError('profile', 'the profile does not belong to the project')
            elif profile_slug(profile) != slug:
                raise IsolationError('profile', 'the profile does not belong to the project')
            home_dir = os.path.join(config.profiles_root, profile)
            if not self.owned_directory(home_dir, account.pw_uid):
                raise IsolationError('profile', 'the profile is missing or not owned by the project')
        elif profile is not None:
            raise IsolationError('profile', 'this runtime takes no profile')

        agent_id = _int_or_none(request.get('agentId'), 'agentId')
        match = PROFILE_RE.match(profile) if isinstance(profile, str) else None
        if match and match.group('agent') and agent_id is not None and int(match.group('agent')) != agent_id:
            raise IsolationError('profile', 'the profile belongs to another agent')

        work = request.get('work') or {'kind': 'run', 'id': None}
        if not isinstance(work, dict) or set(work) - {'kind', 'id'} or work.get('kind') not in WORK_KINDS:
            raise IsolationError('request', 'work is invalid')
        work_id = _int_or_none(work.get('id'), 'work id')

        args = request['args']
        if not isinstance(args, list) or not all(isinstance(a, str) and '\0' not in a for a in args):
            raise IsolationError('request', 'args must be a list of strings')
        if sum(len(a.encode()) for a in args) > MAX_ARGS_BYTES:
            raise IsolationError('request', 'args are too long')
        if args and not runtime.caller_args:
            raise IsolationError('request', 'this runtime takes no arguments')

        env = request['env']
        if not isinstance(env, dict):
            raise IsolationError('request', 'env must be an object')
        size = 0
        for name, value in env.items():
            if not isinstance(name, str) or not ENV_NAME_RE.match(name) or not isinstance(value, str) or '\0' in value:
                raise IsolationError('request', 'env is invalid')
            if name in RESERVED_ENV or name.lower() in PROXY_ENV or name.startswith(RESERVED_ENV_PREFIXES):
                raise IsolationError('request', f'env may not set {name}')
            size += len(name) + len(value.encode())
        if size > MAX_ENV_BYTES:
            raise IsolationError('request', 'env is too large')

        workspace = self.workspace(slug)
        if not self.owned_directory(workspace, account.pw_uid):
            raise IsolationError('workspace', 'the workspace is missing or not owned by the project')
        cwd = _safe_path(request['cwd'], 'cwd')
        if not within(workspace, cwd):
            raise IsolationError('cwd', 'the working directory is outside the workspace')
        # A folder the agent replaced with a link runs in the workspace itself.
        try:
            os.close(open_path_nofollow(cwd))
        except (OSError, IsolationError):
            cwd = workspace

        vault_rw, vault_ro = self.vault_binds(slug, key)
        return {
            'slug': slug,
            'account': account,
            'runtime': runtime,
            'home': home_dir,
            'agent_id': agent_id,
            'work_kind': WORK_KINDS[work['kind']],
            'work_id': work_id,
            'args': args,
            'env': env,
            'cwd': cwd,
            'workspace': workspace,
            'vault_rw': [p for p in vault_rw if os.path.isdir(p)],
            'vault_ro': [p for p in vault_ro if os.path.isdir(p)],
            'limits': self.limits(request.get('limits')),
        }

    async def run(self, request: dict, reader, writer, caller: str) -> None:
        checked = self.check_run(request)
        slug, account, runtime = checked['slug'], checked['account'], checked['runtime']
        unit = unit_name(self.config.unit_prefix, slug, checked['agent_id'], checked['work_kind'],
                         checked['work_id'], secrets.token_hex(6))
        runtime_ro, credential_props = self.runtime_binds(runtime, checked['home'])
        rw = [checked['workspace'], *checked['vault_rw']] + ([checked['home']] if checked['home'] else [])
        props = self.sandbox_properties(slug, account, rw, [*checked['vault_ro'], *runtime_ro], checked['limits'])
        props += credential_props
        home = checked['home'] or checked['workspace']
        command = [
            self.config.systemd_run, f'--unit={unit}', '--quiet', '--collect', '--wait', '--pipe',
            '--service-type=exec', f'--description=Volition agent {slug} ({runtime.name})',
            f'--working-directory={checked["cwd"]}',
            *[f'--property={p}' for p in props],
            *self.base_env(account, home, runtime),
            '--',
            *self.sandbox_args('run', runtime, checked['home'], ['--env-header', '--', runtime.exec,
                                                                *runtime.fixed_args, *checked['args']]),
        ]
        await self.reserve(slug)
        try:
            await self.stream(command, unit, checked['env'], reader, writer)
        finally:
            await self.release(slug)
        log(f'{caller}: {unit} ({runtime.name}) finished')

    async def stream(self, command: list[str], unit: str, env: dict, reader, writer) -> None:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        writer.write(json_frame(T_ACCEPT, {'unit': unit}))
        # The caller's variables reach the sandbox on stdin, ahead of the task: a property
        # (--setenv) would show them to every local user through the unit's D-Bus object.
        header = json.dumps(env, separators=(',', ':')).encode()
        process.stdin.write(b'%010d\n' % len(header) + header)
        stop_requested = False

        async def pump(stream, kind):
            while True:
                chunk = await stream.read(65536)
                if not chunk:
                    return
                writer.write(frame(kind, chunk))
                await writer.drain()

        async def feed():
            nonlocal stop_requested
            while True:
                item = await read_frame(reader)
                if item is None:
                    return
                kind, payload = item
                if kind == T_STDIN and process.stdin and not process.stdin.is_closing():
                    process.stdin.write(payload)
                    await process.stdin.drain()
                elif kind == T_EOF and process.stdin:
                    process.stdin.close()
                elif kind == T_STOP:
                    stop_requested = True
                    return

        pumps = asyncio.gather(pump(process.stdout, T_STDOUT), pump(process.stderr, T_STDERR))
        feeder = asyncio.ensure_future(feed())
        waiter = asyncio.ensure_future(process.wait())
        try:
            done, _ = await asyncio.wait({feeder, waiter}, return_when=asyncio.FIRST_COMPLETED)
            if waiter not in done:
                # The caller hung up or asked to stop: the run is over for it.
                await self.stop_unit(unit)
                try:
                    await asyncio.wait_for(asyncio.shield(waiter), 30)
                except asyncio.TimeoutError:
                    process.kill()
                    await waiter
                if not stop_requested:
                    return
            code = await waiter
            try:
                await asyncio.wait_for(pumps, 30)
            except asyncio.TimeoutError:
                pass
            writer.write(json_frame(T_EXIT, {'code': code, 'unit': unit}))
        except (ConnectionError, BrokenPipeError):
            await self.stop_unit(unit)
        finally:
            feeder.cancel()
            if process.returncode is None:
                process.kill()
                await process.wait()
            pumps.cancel()

    # ── terminal ───────────────────────────────────────────────────────────────────────

    def terminal_paths(self, slug: str) -> tuple[str, str]:
        base = os.path.join(os.path.dirname(self.config.sockets.get('egress', '/run/volition-agents/x')), 'terminal')
        return base, os.path.join(base, slug)

    def project_profiles(self, slug: str, uid: int) -> list[str]:
        config = self.config
        names = []
        try:
            fd = open_path_nofollow(config.profiles_root)
        except (OSError, IsolationError):
            return []
        try:
            for name in os.listdir(fd):
                if slug == config.home_slug:
                    ok = name == slug
                else:
                    ok = PROFILE_RE.match(name) is not None and profile_slug(name) == slug
                if ok and self.owned_directory(os.path.join(config.profiles_root, name), uid):
                    names.append(os.path.join(config.profiles_root, name))
        finally:
            os.close(fd)
        return sorted(names)

    def terminal_runtime_dir(self, slug: str, account: pwd.struct_passwd) -> str:
        base, directory = self.terminal_paths(slug)
        os.makedirs(base, mode=0o755, exist_ok=True)
        base_fd = open_path_nofollow(base)
        try:
            try:
                os.mkdir(slug, 0o700, dir_fd=base_fd)
            except FileExistsError:
                pass
            fd = os.open(slug, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=base_fd)
            try:
                os.fchown(fd, account.pw_uid, account.pw_gid)
                os.fchmod(fd, 0o700)
            finally:
                os.close(fd)
        finally:
            os.close(base_fd)
        return directory

    async def ensure_terminal_host(self, slug: str) -> tuple[pwd.struct_passwd, str, str]:
        key = self.registry_key(slug)
        account = self.project_account(slug)
        workspace = self.workspace(slug)
        if not self.owned_directory(workspace, account.pw_uid):
            raise IsolationError('workspace', 'the workspace is missing or not owned by the project')
        directory = self.terminal_runtime_dir(slug, account)
        socket_path = os.path.join(directory, 'tmux.sock')
        unit = f'{self.config.terminal_prefix}{slug}.service'
        if await self.systemctl('is-active', '--quiet', unit, timeout=15) == 0:
            return account, directory, workspace
        vault_rw, vault_ro = self.vault_binds(slug, key)
        rw = [workspace, directory, *[p for p in vault_rw if os.path.isdir(p)],
              *self.project_profiles(slug, account.pw_uid)]
        ro = [*[p for p in vault_ro if os.path.isdir(p)], os.path.dirname(self.config.sandbox), self.config.tmux_conf]
        limits = self.limits(None)
        limits['RuntimeMaxSec'] = 'infinity'
        props = self.sandbox_properties(slug, account, rw, ro, limits)
        command = [
            self.config.systemd_run, f'--unit={unit}', '--quiet', '--collect', '--service-type=exec',
            f'--description=Volition project terminal {slug}', f'--working-directory={workspace}',
            *[f'--property={p}' for p in props],
            f'--setenv=HOME={workspace}', f'--setenv=USER={account.pw_name}',
            f'--setenv=LOGNAME={account.pw_name}', f'--setenv=PATH={self.config.path}',
            '--setenv=LANG=C.UTF-8', '--setenv=TERM=xterm-256color', '--setenv=VOLITION_AGENT_SANDBOX=1',
            '--',
            *self.sandbox_args('terminal-server', None, None,
                               ['--socket', socket_path, '--conf', self.config.tmux_conf]),
        ]
        process = await asyncio.create_subprocess_exec(
            *command, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE)
        _, error = await process.communicate()
        if process.returncode != 0:
            log(f'terminal host {unit} failed to start: {error.decode(errors="replace")[:300]}')
            raise IsolationError('terminal', 'the project terminal could not be started')
        for _ in range(100):
            if os.path.exists(socket_path):
                break
            await asyncio.sleep(0.05)
        return account, directory, workspace

    async def terminal(self, request: dict, reader, writer, caller: str) -> None:
        slug = request['slug']
        if not valid_slug(slug):
            raise IsolationError('slug', 'invalid project slug')
        rows = _int_or_none(request.get('rows'), 'rows', 1, 1000) or 24
        cols = _int_or_none(request.get('cols'), 'cols', 1, 1000) or 80
        account, directory, workspace = await self.ensure_terminal_host(slug)
        unit = unit_name(self.config.unit_prefix, slug, None, 't', None, secrets.token_hex(6))
        limits = self.limits(None)
        limits['RuntimeMaxSec'] = 'infinity'
        props = self.sandbox_properties(slug, account, [directory], [os.path.dirname(self.config.sandbox)], limits)
        command = [
            self.config.systemd_run, f'--unit={unit}', '--quiet', '--collect', '--wait', '--pty',
            '--service-type=exec', f'--description=Volition project terminal {slug} (view)',
            f'--working-directory={directory}',
            *[f'--property={p}' for p in props],
            f'--setenv=HOME={directory}', f'--setenv=PATH={self.config.path}', '--setenv=LANG=C.UTF-8',
            '--setenv=TERM=xterm-256color',
            '--',
            self.config.python, '-I', self.config.sandbox, 'terminal-attach',
            '--socket', os.path.join(directory, 'tmux.sock'), '--session', f'volition-{slug}',
            '--cwd', workspace,
        ]
        master, slave = os.openpty()
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

        def controlling_terminal():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        await self.reserve(slug)
        try:
            process = await asyncio.create_subprocess_exec(
                *command, stdin=slave, stdout=slave, stderr=slave, preexec_fn=controlling_terminal,
                env={'PATH': '/usr/bin:/bin', 'TERM': 'xterm-256color', 'SYSTEMD_ADJUST_TERMINAL_TITLE': '0',
                     'SYSTEMD_TINT_BACKGROUND': '0', 'LANG': 'C.UTF-8'},
            )
            os.close(slave)
            slave = -1
            writer.write(json_frame(T_ACCEPT, {'unit': unit}))
            loop = asyncio.get_running_loop()
            os.set_blocking(master, False)
            output: asyncio.Queue[bytes | None] = asyncio.Queue()

            def readable():
                try:
                    data = os.read(master, 65536)
                except OSError:
                    data = b''
                if not data:
                    loop.remove_reader(master)
                output.put_nowait(data or None)

            loop.add_reader(master, readable)

            async def pump():
                while True:
                    data = await output.get()
                    if data is None:
                        return
                    writer.write(frame(T_STDOUT, data))
                    await writer.drain()

            async def feed():
                while True:
                    item = await read_frame(reader)
                    if item is None:
                        return
                    kind, payload = item
                    if kind == T_STDIN:
                        view = memoryview(payload)
                        while view:
                            try:
                                written = os.write(master, view)
                            except BlockingIOError:
                                await asyncio.sleep(0.01)
                                continue
                            view = view[written:]
                    elif kind == T_RESIZE:
                        size = json.loads(payload or b'{}')
                        r = _int_or_none(size.get('rows'), 'rows', 1, 1000)
                        c = _int_or_none(size.get('cols'), 'cols', 1, 1000)
                        if r and c:
                            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
                    elif kind in (T_STOP, T_EOF):
                        return

            pumper = asyncio.ensure_future(pump())
            feeder = asyncio.ensure_future(feed())
            waiter = asyncio.ensure_future(process.wait())
            try:
                done, _ = await asyncio.wait({feeder, waiter}, return_when=asyncio.FIRST_COMPLETED)
                if waiter not in done:
                    # Only the view ends; the project's tmux session keeps running.
                    await self.stop_unit(unit)
                    await asyncio.wait_for(waiter, 30)
                else:
                    try:
                        await asyncio.wait_for(pumper, 5)
                    except asyncio.TimeoutError:
                        pass
                    writer.write(json_frame(T_EXIT, {'code': waiter.result(), 'unit': unit}))
            finally:
                feeder.cancel()
                pumper.cancel()
                try:
                    loop.remove_reader(master)
                except (ValueError, OSError):
                    pass
                if process.returncode is None:
                    process.kill()
                    await process.wait()
        finally:
            if slave >= 0:
                os.close(slave)
            os.close(master)
            await self.release(slug)

    async def terminal_stop(self, request: dict, writer) -> None:
        slug = request['slug']
        if not valid_slug(slug):
            raise IsolationError('slug', 'invalid project slug')
        await self.systemctl('stop', f'{self.config.terminal_prefix}{slug}.service', timeout=60)
        writer.write(json_frame(T_RESULT, {'stopped': slug}))

    # ── project users ──────────────────────────────────────────────────────────────────

    def ledger_path(self) -> str:
        return os.path.join(self.config.state_root, 'uids.json')

    def read_ledger(self) -> dict:
        try:
            with open(self.ledger_path(), 'rb') as handle:
                ledger = json.loads(handle.read(1_048_576))
        except FileNotFoundError:
            return {'schemaVersion': 1, 'users': {}}
        if not isinstance(ledger, dict) or not isinstance(ledger.get('users'), dict):
            raise IsolationError('ledger', 'the UID ledger is invalid')
        return ledger

    def write_ledger(self, ledger: dict) -> None:
        os.makedirs(self.config.state_root, mode=0o700, exist_ok=True)
        temporary = f'{self.ledger_path()}.{os.getpid()}.tmp'
        with open(temporary, 'w', encoding='utf-8') as handle:
            json.dump(ledger, handle, indent=2, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.ledger_path())

    def allocate_uid(self, name: str) -> int:
        """A UID of the isolated range that no project user ever had: a removed project's
        files keep its UID in the trash, and a new project must not inherit them. The ledger
        keeps every UID it gave out, and each user's earlier ones."""
        ledger = self.read_ledger()
        allocated = set(ledger.setdefault('allocated', []))
        for entry in ledger['users'].values():
            if isinstance(entry, dict):
                allocated.add(int(entry.get('uid', -1)))
                allocated.update(int(v) for v in entry.get('previous', []))
        low, high = self.config.uid_range
        for uid in range(low, high + 1):
            if uid in allocated:
                continue
            try:
                pwd.getpwuid(uid)
                continue
            except KeyError:
                pass
            try:
                grp.getgrgid(uid)
                continue
            except KeyError:
                pass
            before = ledger['users'].get(name) if isinstance(ledger['users'].get(name), dict) else None
            previous = [*before.get('previous', []), before['uid']] if before else []
            ledger['users'][name] = {'uid': uid, 'previous': previous,
                                     'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            ledger['allocated'] = sorted(allocated | {uid})
            self.write_ledger(ledger)
            return uid
        raise IsolationError('user', 'no free UID in the isolated range')

    def earlier_uids(self, name: str) -> set[int]:
        """The UIDs a project user had before it was removed and made again: what it left in
        place (a workspace that is not moved to the trash) is still the project's."""
        entry = self.read_ledger()['users'].get(name)
        return {int(v) for v in entry.get('previous', [])} if isinstance(entry, dict) else set()

    async def command(self, *argv: str) -> None:
        process = await asyncio.create_subprocess_exec(
            *argv, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE)
        _, error = await process.communicate()
        if process.returncode != 0:
            log(f'{os.path.basename(argv[0])} failed: {error.decode(errors="replace")[:300]}')
            raise IsolationError('user', f'{os.path.basename(argv[0])} failed')

    def grant_directory(self, path: str, account: pwd.struct_passwd, *, own: bool,
                        named: dict[tuple[int, int], int], owners: set[int],
                        group: int | None = None) -> bool:
        """Gives a directory the launcher found at a path it derived itself to the project
        user (when `own`) and sets named ACL entries, with defaults for what is created in it
        later. It never recurses: what an agent created below is left as it is. `owners` are
        the users the directory may belong to before, `group` the group it must have."""
        try:
            fd = open_path_nofollow(path)
        except FileNotFoundError:
            return False
        except IsolationError:
            raise IsolationError('path', f'{path} is not a plain directory')
        try:
            info = os.fstat(fd)
            if info.st_uid not in owners | {account.pw_uid}:
                raise IsolationError('path', f'{path} belongs to someone else')
            if group is not None and info.st_gid != group:
                raise IsolationError('path', f'{path} has an unexpected group')
            if own and (info.st_uid != account.pw_uid or info.st_gid != account.pw_gid):
                os.fchown(fd, account.pw_uid, account.pw_gid)
            set_acl(fd, named, default=True)
            return True
        finally:
            os.close(fd)

    def adopt_new_git(self, workspace: str, account: pwd.struct_passwd, runner: int) -> int:
        """The .git provisioning made in a new project's workspace. Git refuses a repository
        whose folder belongs to someone else, so the project's agents could not use it: the
        project user gets it, as migrate gave it the older projects'. Only a .git that still
        belongs to the runner is taken over; once it is the project's, it is left alone."""
        try:
            top = open_path_nofollow(workspace)
        except (FileNotFoundError, IsolationError):
            return 0
        try:
            try:
                fd = os.open('.git', O_DIR, dir_fd=top)
            except OSError as error:
                if error.errno in (errno.ENOENT, errno.ELOOP, errno.ENOTDIR):
                    return 0
                raise
            try:
                if os.fstat(fd).st_uid != runner:
                    return 0
                return adopt_tree(fd, account.pw_uid, account.pw_gid, only_uid=runner)
            finally:
                os.close(fd)
        finally:
            os.close(top)

    async def ensure_project_user(self, request: dict, writer, caller: str) -> None:
        async with self.user_lock:
            result = await self._ensure_project_user(request, caller)
        writer.write(json_frame(T_RESULT, result))

    async def _ensure_project_user(self, request: dict, caller: str) -> dict:
        config = self.config
        slug = request['slug']
        if not valid_slug(slug):
            raise IsolationError('slug', 'invalid project slug')
        key = self.registry_key(slug)
        profiles = request.get('profiles') or []
        if not isinstance(profiles, list) or len(profiles) > 256:
            raise IsolationError('request', 'profiles is invalid')
        for profile in profiles:
            if not isinstance(profile, str) or not PROFILE_RE.match(profile):
                raise IsolationError('profile', 'invalid profile')
            if (profile != slug if slug == config.home_slug else profile_slug(profile) != slug):
                raise IsolationError('profile', 'the profile does not belong to the project')
        name = project_user(config, slug)
        created = False
        try:
            pwd.getpwnam(name)
        except KeyError:
            try:
                grp.getgrnam(name)
                raise IsolationError('user', 'a group of that name exists already')
            except KeyError:
                pass
            uid = self.allocate_uid(name)
            await self.command(config.groupadd, '--gid', str(uid), name)
            await self.command(config.useradd, '--uid', str(uid), '--gid', str(uid), '--groups',
                               config.agents_group, '--no-create-home', '--home-dir', '/nonexistent',
                               '--shell', '/usr/sbin/nologin', '--comment', f'Volition project {slug}', name)
            created = True
            log(f'{caller}: created {name} ({uid})')
        account = self.project_account(slug)
        runner = pwd.getpwnam(config.runner_user).pw_uid
        readers = grp.getgrnam(config.readers_group).gr_gid
        earlier = self.earlier_uids(name)
        rwx, rx = 7, 5

        workspace = self.workspace(slug)
        if slug == config.home_slug:
            parent = open_path_nofollow(os.path.dirname(workspace))
            try:
                try:
                    os.mkdir(os.path.basename(workspace), 0o770, dir_fd=parent)
                    fd = os.open(os.path.basename(workspace), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                 dir_fd=parent)
                    try:
                        os.fchown(fd, account.pw_uid, account.pw_gid)
                    finally:
                        os.close(fd)
                except FileExistsError:
                    pass
            finally:
                os.close(parent)
        done = {
            'workspace': self.grant_directory(workspace, account, own=True, owners={runner, *earlier}, named={
                (ACL_USER, account.pw_uid): rwx, (ACL_USER, runner): rwx, (ACL_GROUP, readers): rx}),
            'git': self.adopt_new_git(workspace, account, runner),
        }
        # Profiles are the agents' alone: the runner reaches them only through helper runs.
        profile_root = open_path_nofollow(config.profiles_root)
        try:
            for profile in profiles:
                try:
                    os.mkdir(profile, 0o700, dir_fd=profile_root)
                except FileExistsError:
                    pass
                fd = os.open(profile, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=profile_root)
                try:
                    info = os.fstat(fd)
                    if info.st_uid not in {account.pw_uid, runner, 0, *earlier}:
                        raise IsolationError('path', f'profile {profile} belongs to someone else')
                    if info.st_uid != account.pw_uid or info.st_gid != account.pw_gid:
                        os.fchown(fd, account.pw_uid, account.pw_gid)
                    os.fchmod(fd, 0o700)
                finally:
                    os.close(fd)
        finally:
            os.close(profile_root)
        done['profiles'] = len(profiles)

        # The vault keeps its owners and the group every service reads it through; the
        # project user gets its own folder, and Home reads every project's.
        rw, ro = self.vault_binds(slug, key)
        vault_owners = {0, runner}
        for path in rw:
            done[path] = self.grant_directory(path, account, own=False, owners=vault_owners, group=readers,
                                              named={(ACL_USER, account.pw_uid): rwx})
        if slug != config.home_slug:
            try:
                home = pwd.getpwnam(project_user(config, config.home_slug))
                for path in rw:
                    self.grant_directory(path, account, own=False, owners=vault_owners, group=readers,
                                         named={(ACL_USER, home.pw_uid): rx})
            except KeyError:
                pass
        else:
            for path in ro:
                done[path] = self.grant_directory(path, account, own=False, owners=vault_owners, group=readers,
                                                  named={(ACL_USER, account.pw_uid): rx})
        return {'user': name, 'uid': account.pw_uid, 'created': created, 'granted': done}

    async def remove_project_user(self, request: dict, writer, caller: str) -> None:
        async with self.user_lock:
            await self._remove_project_user(request, writer, caller)

    async def _remove_project_user(self, request: dict, writer, caller: str) -> None:
        config = self.config
        slug = request['slug']
        if not valid_slug(slug) or slug == config.home_slug:
            raise IsolationError('slug', 'invalid project slug')
        name = project_user(config, slug)
        try:
            account = self.project_account(slug)
        except IsolationError:
            writer.write(json_frame(T_RESULT, {'user': name, 'removed': False}))
            return
        await self.systemctl('stop', f'{config.terminal_prefix}{slug}.service', timeout=60)
        units = await asyncio.create_subprocess_exec(
            config.systemctl, 'list-units', '--plain', '--no-legend', '--all',
            f'{config.unit_prefix}{slug}--*', stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL)
        listing, _ = await units.communicate()
        for line in listing.decode(errors='replace').splitlines():
            unit = line.split()[0] if line.split() else ''
            if unit.startswith(f'{config.unit_prefix}{slug}--'):
                await self.stop_unit(unit)
        await self.command(config.userdel, name)
        try:
            grp.getgrnam(name)
            await self.command('/usr/sbin/groupdel', name)
        except KeyError:
            pass
        log(f'{caller}: removed {name} ({account.pw_uid}); the UID stays reserved')
        writer.write(json_frame(T_RESULT, {'user': name, 'removed': True, 'uid': account.pw_uid}))

    # ── browser state ──────────────────────────────────────────────────────────────────

    async def browser_state(self, request: dict, writer, caller: str) -> None:
        """Writes or removes a project's browser state as the browser user, whose alone it
        is: the provisioning service no longer opens browser profiles."""
        browser = self.config.browser
        if not browser:
            raise IsolationError('browser', 'no browser user is configured')
        action = request['action']
        slug = request['slug']
        project_id = _int_or_none(request.get('projectId'), 'projectId', 1, 2**31 - 1)
        event_id = request.get('eventId')
        if action not in ('ensure', 'remove') or not valid_slug(slug) or project_id is None:
            raise IsolationError('request', 'invalid browser request')
        if (action == 'remove') != (event_id is not None) or (
                event_id is not None and (not isinstance(event_id, str) or not EVENT_ID.match(event_id))):
            raise IsolationError('request', 'invalid browser request')
        registry = self.registry_entry(slug)
        if registry is None or registry.get('project', {}).get('id') != project_id:
            raise IsolationError('slug', 'the project is not provisioned')
        account = pwd.getpwnam(browser['user'])
        state_root = os.path.dirname(browser['root'])
        args = [action, slug, str(project_id)] + ([event_id] if event_id else [])
        command = [
            self.config.systemd_run, f'--unit={self.config.unit_prefix}browser-state-{secrets.token_hex(6)}', '--quiet',
            '--collect', '--wait', '--pipe', '--service-type=exec', f'--uid={account.pw_uid}',
            f'--gid={account.pw_gid}', '--property=NoNewPrivileges=yes', '--property=PrivateNetwork=yes',
            '--property=PrivateTmp=yes', '--property=ProtectSystem=strict', '--property=ProtectHome=yes',
            '--property=CapabilityBoundingSet=', '--property=UMask=0077',
            f'--property=ReadWritePaths={_safe_path(state_root, "browser state")}',
            f'--setenv=PROJECT_BROWSER_ROOT={browser["root"]}', f'--setenv=PROJECT_BROWSER_TRASH_ROOT={browser["trash"]}',
            *[f'--setenv={k}={v}' for k, v in browser['env'].items()],
            '--', browser['node'], browser['script'], *args,
        ]
        process = await asyncio.create_subprocess_exec(
            *command, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE)
        out, error = await asyncio.wait_for(process.communicate(), 120)
        if process.returncode != 0:
            log(f'{caller}: browser state {action} {slug} failed: {error.decode(errors="replace")[-300:]}')
            raise IsolationError('browser', 'the browser state could not be written')
        try:
            answer = json.loads(out.decode().strip().splitlines()[-1])
        except (ValueError, IndexError):
            raise IsolationError('browser', 'the browser state script answered nothing readable') from None
        writer.write(json_frame(T_RESULT, answer))

    def registry_entry(self, slug: str) -> dict | None:
        try:
            self.registry_key(slug)
        except IsolationError:
            return None
        fd = open_path_nofollow(self.config.registry_root)
        try:
            file_fd = os.open(f'{slug}.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            with os.fdopen(file_fd, 'rb') as handle:
                return json.loads(handle.read(1_048_576))
        finally:
            os.close(fd)

    # ── start ──────────────────────────────────────────────────────────────────────────

    async def stop_orphans(self) -> None:
        """Agent units whose launcher went away have no one reading their output any more."""
        process = await asyncio.create_subprocess_exec(
            self.config.systemctl, 'list-units', '--plain', '--no-legend', '--all',
            f'{self.config.unit_prefix}*', stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL)
        listing, _ = await process.communicate()
        for line in listing.decode(errors='replace').splitlines():
            unit = line.split()[0] if line.split() else ''
            if unit.startswith(self.config.unit_prefix) and '--a' in unit:
                log(f'stopping orphaned {unit}')
                await self.stop_unit(unit)


async def serve(config: Config) -> None:
    launcher = Launcher(config)
    await launcher.stop_orphans()
    listen_fds = int(os.environ.get('LISTEN_FDS', '0') or 0)
    if listen_fds >= 1 and os.environ.get('LISTEN_PID') == str(os.getpid()):
        sock = socket.socket(fileno=3)
        activated = True
    else:
        path = os.environ.get('VOLITION_LAUNCHER_SOCKET', '/run/volition-agent-launcher/launch.sock')
        group = os.environ.get('VOLITION_LAUNCHER_GROUP', 'volition-launcher')
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(path)
        os.chown(path, 0, grp.getgrnam(group).gr_gid)
        os.chmod(path, 0o660)
        sock.listen(64)
    server = await asyncio.start_unix_server(launcher.handle, sock=sock, limit=MAX_REQUEST, **unix_server_options(activated))
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(signum, stop.set)
    async with server:
        await stop.wait()


def main() -> int:
    config_path = os.environ.get('VOLITION_LAUNCHER_CONFIG', '/usr/local/lib/volition-isolation/launcher.json')
    try:
        config = load_config(config_path, require_root=os.geteuid() == 0)
    except (OSError, ValueError, IsolationError) as error:
        log(f'cannot read {config_path}: {error}')
        return 1
    asyncio.run(serve(config))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
