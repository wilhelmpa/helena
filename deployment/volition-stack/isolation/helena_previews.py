"""Project preview lifecycle on systemd; the launcher is the only privileged caller."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import re
import shlex
import stat
import time

from isolation_common import IsolationError, open_path_nofollow, valid_slug, within
from helena_preview_worker import clean_line, pipe

NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,39}$')
SLOTS = 8
PORT_BASE = 24000
RUNTIME_ROOT = '/run/helena-previews'
STATE_ROOT = '/var/lib/helena-previews'
OPS = {
    'preview-start': {'v', 'op', 'slug', 'name', 'cwd', 'command', 'idleTimeoutSec'},
    'preview-status': {'v', 'op', 'slug', 'name'},
    'preview-stop': {'v', 'op', 'slug', 'name'},
    'preview-logs': {'v', 'op', 'slug', 'name', 'tail'},
}


def ports(uid: int, first_uid: int) -> range:
    start = PORT_BASE + (uid - first_uid) * SLOTS
    return range(start, start + SLOTS)


def read_json(path: Path, maximum: int = 256 * 1024) -> dict:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                return {}
            data = handle.read(maximum + 1)
            if len(data) > maximum:
                return {}
            value = json.loads(data)
            return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix('.new')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(value, handle)
    os.replace(temporary, path)


def working_directory(workspace: str, relative: object) -> str:
    if relative is None:
        relative = '.'
    if not isinstance(relative, str) or len(relative) > 512 or '\0' in relative:
        raise IsolationError('invalid', 'The preview directory is invalid')
    if os.path.isabs(relative) or '..' in relative.split('/'):
        raise IsolationError('invalid', 'The preview directory must be relative to this project workspace')
    target = os.path.normpath(os.path.join(workspace, relative))
    if not within(workspace, target):
        raise IsolationError('invalid', 'The preview directory is outside this project')
    try:
        os.close(open_path_nofollow(target))
    except (OSError, IsolationError):
        raise IsolationError('invalid', 'The preview directory must exist and contain no symlinks') from None
    return target


def discover_directory(workspace: str) -> str:
    if (Path(workspace) / 'package.json').is_file():
        return workspace
    found = []
    visited = 0
    for directory, children, files in os.walk(workspace, followlinks=False):
        visited += 1
        depth = len(Path(directory).relative_to(workspace).parts)
        children[:] = sorted(child for child in children if not child.startswith('.')
                             and child not in {'node_modules', 'dist', 'build', 'vendor'}
                             and not Path(directory, child).is_symlink()) if depth < 3 else []
        if visited > 128:
            raise IsolationError('invalid', 'Specify the preview directory; the project contains many folders')
        if 'package.json' not in files:
            continue
        package = read_json(Path(directory) / 'package.json', 1_048_576)
        scripts = package.get('scripts')
        script = scripts.get('dev') if isinstance(scripts, dict) else None
        if isinstance(script, str) and re.match(r'^(?:astro dev|vite|next dev)(?: |$)', script):
            found.append(directory)
    if len(found) != 1:
        raise IsolationError('invalid', 'Specify the app directory; no unique supported development app was found')
    return working_directory(workspace, os.path.relpath(found[0], workspace))


def development_command(cwd: str, requested: object, port: int) -> tuple[list[str], str]:
    if requested is not None and not isinstance(requested, str):
        raise IsolationError('invalid', 'The development command must be a string')
    package = read_json(Path(cwd) / 'package.json', 1_048_576)
    dependencies = {}
    for key in ('dependencies', 'devDependencies'):
        if isinstance(package.get(key), dict):
            dependencies.update(package[key])
    script = package['scripts'].get('dev', '') if isinstance(package.get('scripts'), dict) else ''
    if not isinstance(script, str):
        raise IsolationError('invalid', 'The development script must be a string')
    if len(requested or script) > 2048:
        raise IsolationError('invalid', 'The development command is too long')
    try:
        words = shlex.split(requested or script)
    except (TypeError, ValueError):
        raise IsolationError('invalid', 'The development command is invalid') from None
    if requested in ('npm run dev', 'bun run dev') or not requested:
        try:
            words = shlex.split(script)
        except (TypeError, ValueError):
            words = []
    choices = {'astro': ['dev'], 'vite': [], 'next': ['dev']}
    name = next((key for key, prefix in choices.items()
                 if words[:1 + len(prefix)] == [key, *prefix]), None)
    if name is None or name not in dependencies:
        raise IsolationError('invalid', 'Use a local Astro, Vite or Next dev script; install dependencies separately')
    remainder = words[1 + len(choices[name]):]
    booleans = {'astro': {'--verbose', '--silent'}, 'vite': {'--force', '--clearScreen=false'},
                'next': {'--turbo', '--turbopack', '--webpack'}}
    valued = {'astro': {'--config', '--base'}, 'vite': {'--config', '--base', '--mode'}, 'next': set()}
    index = 0
    while index < len(remainder):
        flag = remainder[index]
        if flag in booleans[name]:
            index += 1
            continue
        if flag not in valued[name] or index + 1 == len(remainder):
            raise IsolationError('invalid', 'Unsupported development flag; Helena assigns the host and port')
        value = remainder[index + 1]
        if not re.fullmatch(r'[A-Za-z0-9_./-]{1,200}', value) or '..' in value.split('/'):
            raise IsolationError('invalid', 'The development flag value is invalid')
        if flag == '--config' and (value.startswith('/') or not within(cwd, os.path.realpath(os.path.join(cwd, value)))):
            raise IsolationError('invalid', 'The development config must remain inside the app directory')
        index += 2
    executable = str(Path(cwd) / 'node_modules' / '.bin' / name)
    if not os.path.isfile(executable):
        raise IsolationError('unavailable', 'Project dependencies are missing; install them before starting a preview')
    host_flag = '--hostname' if name == 'next' else '--host'
    command = [executable, *choices[name], *remainder, host_flag, '127.0.0.1', '--port', str(port)]
    if name == 'vite':
        command += ['--strictPort']
    return command, shlex.join([name, *choices[name], *remainder])


class Previews:
    def __init__(self, launcher):
        self.launcher, self.config = launcher, launcher.config
        self.state = Path(STATE_ROOT)
        self.runtime = Path(RUNTIME_ROOT)
        self.servers: dict[int, asyncio.Server] = {}
        self.locks: dict[str, asyncio.Lock] = {}
        self.firewall_signature = None
        self.connections = 0
        self.listener_lock = asyncio.Lock()

    def metadata(self, slug: str) -> list[dict]:
        directory = self.state / slug
        if not directory.is_dir():
            return []
        return [value for path in sorted(directory.glob('*.json'))
                if (value := read_json(path)) and value.get('slug') == slug and NAME.fullmatch(value.get('name', ''))]

    def directory(self, preview: dict) -> Path:
        return self.runtime / preview['slug'] / str(preview['port'])

    def snapshot(self, preview: dict) -> dict:
        state = read_json(self.directory(preview) / 'status.json')
        status = state.get('status')
        if status not in {'starting', 'running', 'stopped', 'failed'}:
            status = 'stopped'
        heartbeat = state.get('heartbeatAt', 0)
        if status == 'running' and (not isinstance(heartbeat, int) or time.time() * 1000 - heartbeat > 10000):
            status = 'failed'
        if preview.get('retired'):
            status = 'stopped'
            state = {}
        result = {key: value for key, value in preview.items() if key not in {'argv', 'unit', 'absoluteCwd', 'retired'}}
        result['status'] = status
        for key in ('startedAt', 'lastActivityAt'):
            result[key] = state.get(key) if isinstance(state.get(key), int) else None
        if isinstance(state.get('error'), str):
            result['error'] = clean_line(state['error'])
        return result

    def lines(self, preview: dict, tail: int) -> list[str]:
        if preview.get('retired'):
            return []
        values = read_json(self.directory(preview) / 'status.json').get('lines', [])
        return [clean_line(value) for value in values[-tail:] if isinstance(value, str)] if isinstance(values, list) else []

    async def request(self, request: dict) -> dict:
        slug = request['slug']
        if not valid_slug(slug):
            raise IsolationError('invalid', 'Invalid project slug')
        self.launcher.registry_key(slug)
        account = self.launcher.project_account(slug)
        name = request.get('name', 'main')
        if not isinstance(name, str) or not NAME.fullmatch(name):
            raise IsolationError('invalid', 'Preview names use lowercase letters, digits and hyphens')
        op = request['op']
        if op == 'preview-status':
            values = self.metadata(slug)
            return {'previews': [self.snapshot(value) for value in values
                                 if 'name' not in request or value['name'] == name]}
        async with self.locks.setdefault(slug, asyncio.Lock()):
            values = self.metadata(slug)
            preview = next((value for value in values if value['name'] == name), None)
            if op == 'preview-start':
                return await self.start(request, account, values, preview)
            if preview is None:
                raise IsolationError('not-found', 'The preview does not exist')
            if op == 'preview-logs':
                tail = request.get('tail', 100)
                if not isinstance(tail, int) or isinstance(tail, bool) or not 1 <= tail <= 200:
                    raise IsolationError('invalid', 'Log tail must be between 1 and 200')
                return {'preview': self.snapshot(preview), 'lines': self.lines(preview, tail)}
            if preview.get('retired'):
                return {'preview': self.snapshot(preview)}
            await self.launcher.stop_unit(preview['unit'])
            await self.close_listener(preview['port'])
            state = read_json(self.directory(preview) / 'status.json')
            state['status'] = 'stopped'
            write_json(self.directory(preview) / 'status.json', state)
            return {'preview': self.snapshot(preview)}

    async def start(self, request, account, values, existing) -> dict:
        slug, name = request['slug'], request.get('name', 'main')
        if existing and self.snapshot(existing)['status'] in {'starting', 'running'}:
            if (request.get('cwd') not in (None, existing['cwd'])
                    or request.get('command') not in (None, existing['command'], 'npm run dev', 'bun run dev')):
                raise IsolationError('busy', 'Stop this preview before changing its directory or command')
            return await self.await_ready(existing)
        workspace = self.launcher.workspace(slug)
        if not self.launcher.owned_directory(workspace, account.pw_uid):
            raise IsolationError('invalid', 'The project workspace is unavailable')
        relative = request.get('cwd', existing.get('cwd') if existing else None)
        cwd = discover_directory(workspace) if relative is None else working_directory(workspace, relative)
        idle = request.get('idleTimeoutSec', 14400)
        if not isinstance(idle, int) or isinstance(idle, bool) or not 60 <= idle <= 86400:
            raise IsolationError('invalid', 'Idle timeout must be between 60 and 86400 seconds')
        used = {value['port'] for value in values if self.snapshot(value)['status'] in {'starting', 'running'}}
        assigned = ports(account.pw_uid, self.config.uid_range[0])
        port = existing['port'] if existing and existing['port'] in assigned and existing['port'] not in used else next(
            (p for p in assigned if p not in used), None)
        if port is None:
            raise IsolationError('busy', 'This project already has eight active previews; stop one first')
        argv, command = development_command(cwd, request.get('command'), port)
        preview = {'slug': slug, 'name': name, 'port': port, 'url': f'http://127.0.0.1:{port}',
                   'cwd': os.path.relpath(cwd, workspace), 'absoluteCwd': cwd, 'command': command,
                   'argv': argv, 'idleTimeoutSec': idle, 'unit': f'helena-preview-{slug}--{name}.service'}
        self.prepare_directories(preview, account)
        for previous in values:
            if previous['port'] == port and previous['name'] != name and not previous.get('retired'):
                await self.launcher.stop_unit(previous['unit'])
                previous['retired'] = True
                write_json(self.state / slug / f'{previous["name"]}.json', previous)
        await self.close_listener(port)
        await self.launcher.stop_unit(preview['unit'])
        await self.launcher.systemctl('reset-failed', preview['unit'])
        write_json(self.state / slug / f'{name}.json', preview)
        write_json(self.directory(preview) / 'status.json', {'status': 'starting'})
        os.chown(self.directory(preview) / 'status.json', account.pw_uid, account.pw_gid, follow_symlinks=False)
        props = self.launcher.sandbox_properties(slug, account, [workspace, str(self.directory(preview))],
                                                [os.path.dirname(self.config.sandbox)],
                                                {'MemoryMax': '4G', 'CPUQuota': '200%', 'TasksMax': '512'})
        props = [prop for prop in props if not prop.startswith(f'BindReadOnlyPaths=-{RUNTIME_ROOT}/')]
        args = [self.config.systemd_run, f'--unit={preview["unit"]}', '--quiet', '--collect',
                '--service-type=exec', f'--working-directory={cwd}',
                *[f'--property={prop}' for prop in props], '--property=StandardOutput=null',
                '--property=StandardError=null', f'--setenv=PATH={self.config.path}',
                f'--setenv=HOME={workspace}', '--setenv=NODE_ENV=development', '--setenv=CI=1',
                '--', self.config.python, '-I', str(Path(self.config.sandbox).with_name('helena_preview_worker.py')),
                '--directory', str(self.directory(preview)), '--port', str(port), '--idle', str(idle), '--', *argv]
        process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL,
                                                      stderr=asyncio.subprocess.DEVNULL)
        try:
            code = await asyncio.wait_for(process.wait(), 15)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            await self.launcher.stop_unit(preview['unit'])
            raise IsolationError('unavailable', 'Starting the development service timed out') from None
        if code != 0:
            write_json(self.directory(preview) / 'status.json',
                       {'status': 'failed', 'error': 'The persistent development service could not start'})
            raise IsolationError('unavailable', 'The persistent development service could not start')
        return await self.await_ready(preview)

    async def await_ready(self, preview) -> dict:
        deadline = time.monotonic() + 65
        while time.monotonic() < deadline:
            value = self.snapshot(preview)
            if value['status'] == 'running':
                try:
                    await self.listen(preview)
                except BaseException:
                    await self.launcher.stop_unit(preview['unit'])
                    raise
                return {'preview': value}
            if value['status'] in {'failed', 'stopped'}:
                return {'preview': value, 'lines': self.lines(preview, 30)}
            await asyncio.sleep(.25)
        await self.launcher.stop_unit(preview['unit'])
        raise IsolationError('readiness', 'The development server did not become ready; inspect preview logs')

    def prepare_directories(self, preview, account) -> None:
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        (self.state / preview['slug']).mkdir(mode=0o700, exist_ok=True)
        self.runtime.mkdir(mode=0o755, parents=True, exist_ok=True)
        parent = self.runtime / preview['slug']
        parent.mkdir(mode=0o711, exist_ok=True)
        directory = self.directory(preview)
        directory.mkdir(mode=0o700, exist_ok=True)
        os.chown(directory, account.pw_uid, account.pw_gid)

    async def connection(self, preview, reader, writer) -> None:
        if self.connections >= 256:
            writer.close()
            return
        self.connections += 1
        upstream = None
        try:
            remote, upstream = await asyncio.wait_for(
                asyncio.open_unix_connection(str(self.directory(preview) / 'http.sock')), 3)
            await asyncio.gather(pipe(reader, upstream, lambda: None), pipe(remote, writer, lambda: None))
        except (OSError, ConnectionError, asyncio.TimeoutError):
            pass
        finally:
            self.connections -= 1
            writer.close()
            if upstream:
                upstream.close()

    async def listen(self, preview) -> None:
        async with self.listener_lock:
            if preview['port'] in self.servers:
                return
            await self.firewall()
            self.servers[preview['port']] = await asyncio.start_server(
                lambda r, w: self.connection(preview, r, w), '127.0.0.1', preview['port'])

    async def close_listener(self, port: int) -> None:
        async with self.listener_lock:
            server = self.servers.pop(port, None)
            if server:
                server.close()
                await server.wait_closed()

    async def firewall(self) -> None:
        # Implemented separately so platform checks and firewall updates can be exercised without systemd.
        from helena_preview_firewall import sync
        self.firewall_signature = await sync(self.config, self.firewall_signature)

    async def stop_project(self, slug: str) -> None:
        async with self.locks.setdefault(slug, asyncio.Lock()):
            for preview in self.metadata(slug):
                if preview.get('retired'):
                    continue
                await self.launcher.stop_unit(preview['unit'])
                await self.close_listener(preview['port'])
                preview['retired'] = True
                write_json(self.state / slug / f'{preview["name"]}.json', preview)

    async def reconcile(self) -> None:
        while True:
            try:
                await self.firewall()
                desired = set()
                for directory in sorted(self.state.glob('*')):
                    if not valid_slug(directory.name):
                        continue
                    for preview in self.metadata(directory.name):
                        if self.snapshot(preview)['status'] == 'running':
                            desired.add(preview['port'])
                            await self.listen(preview)
                for port in set(self.servers) - desired:
                    await self.close_listener(port)
            except (OSError, IsolationError):
                # Failure closes every published port. Persistent services remain in their private networks.
                for port in list(self.servers):
                    await self.close_listener(port)
            await asyncio.sleep(5)
