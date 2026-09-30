"""Fixed development spool operations for the API's Home-agent routes."""
from __future__ import annotations

import fcntl
import os
import re
import stat
import signal
from contextlib import contextmanager

from .common import HostError, iso

SLUG = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
TASK = re.compile(r'^([0-9]{1,9})-[a-z0-9][a-z0-9-]*\.md$')
MODELS = ('gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol')
EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')


@contextmanager
def directory(path):
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.split('/'):
            if not part:
                continue
            if part in ('.', '..'):
                raise HostError('InvalidParameter', 'Invalid spool path')
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            except OSError:
                raise HostError('InvalidParameter', 'Cannot open development spool') from None
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)


def work_path(ctx):
    path = ctx.config.data.get('development', {}).get('workDir', '/home/wilhelmpa/agent-work')
    if not isinstance(path, str) or not path.startswith('/') or path == '/':
        raise HostError('InvalidParameter', 'Invalid development spool configuration')
    return path


def open_file(fd, name, flags, mode=0o600):
    try:
        result = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, mode, dir_fd=fd)
    except FileNotFoundError:
        raise
    except OSError:
        raise HostError('InvalidParameter', 'Cannot open spool entry') from None
    info = os.fstat(result)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        os.close(result)
        raise HostError('InvalidParameter', 'Spool entries must be regular files without links')
    return result


def read(fd, name, limit=65536):
    try:
        entry = open_file(fd, name, os.O_RDONLY)
    except FileNotFoundError:
        return None
    try:
        size = os.fstat(entry).st_size
        os.lseek(entry, max(0, size - limit), os.SEEK_SET)
        return os.read(entry, limit).decode('utf-8', 'replace')
    finally:
        os.close(entry)


def enqueue(ctx, params):
    slug = params['name']
    content = params['body']
    if set(content) != {'text'} or not isinstance(content['text'], str):
        raise HostError('InvalidParameter', 'Invalid task content')
    body = content['text']
    model = params['model']
    effort = params['effort']
    if (not SLUG.fullmatch(slug) or len(slug) > 64 or model not in MODELS or
            effort not in EFFORTS or not body.strip() or len(body) > 32000 or '\x00' in body):
        raise HostError('InvalidParameter', 'Invalid development task')
    with directory(work_path(ctx) + '/codex-tasks') as fd:
        lock = open_file(fd, '.volition-queue.lock', os.O_RDWR | os.O_CREAT)
        try:
            if os.geteuid() == 0:
                owner = os.fstat(fd)
                os.fchown(lock, owner.st_uid, owner.st_gid)
            fcntl.flock(lock, fcntl.LOCK_EX)
            numbers = [int(match[1]) for name in os.listdir(fd) if (match := TASK.fullmatch(name))]
            number = max(numbers, default=0) + 1
            if number > 999999999:
                raise HostError('Busy', 'Task numbers exhausted')
            name = f'{number:03d}-{slug}.md'
            queue = open_file(fd, 'queue.txt', os.O_WRONLY | os.O_APPEND | os.O_CREAT)
            try:
                entry = open_file(fd, name, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
                try:
                    owner = os.fstat(fd)
                    if os.geteuid() == 0:
                        os.fchown(entry, owner.st_uid, owner.st_gid)
                        os.fchown(queue, owner.st_uid, owner.st_gid)
                    with os.fdopen(entry, 'w', encoding='utf-8') as handle:
                        handle.write(f'Modell: {model}\nDenktiefe: {effort}\n{body.rstrip()}\n')
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.write(queue, (name + '\n').encode())
                    os.fsync(queue)
                except Exception:
                    os.unlink(name, dir_fd=fd)
                    raise
            finally:
                os.close(queue)
            return {'number': number, 'file': name}
        finally:
            os.close(lock)


def status(ctx, _):
    with directory(work_path(ctx) + '/codex-tasks') as fd:
        queue = read(fd, 'queue.txt') or ''
        log = read(fd, 'queue.log', 16384) or ''
    process = ctx.host.run(['ps', '-eo', 'pid,args'], timeout=5, output_limit=262144)
    running = []
    for line in process.stdout.splitlines():
        if 'codex exec' not in line:
            continue
        match = re.search(r'^\s*(\d+).* -o ' + re.escape(work_path(ctx)) + r'/codex-tasks/(\d+)-last\.md(?:\s|$)', line)
        if match:
            running.append({'pid': int(match[1]), 'number': int(match[2])})
    return {'queue': [line for line in queue.splitlines() if TASK.fullmatch(line)],
            'log': log, 'running': running}


def report(ctx, params):
    number = params['number']
    if isinstance(number, bool) or not 1 <= number <= 999999999:
        raise HostError('InvalidParameter', 'Invalid task number')
    with directory(work_path(ctx) + '/codex-tasks') as fd:
        content = read(fd, f'{number:03d}-bericht.md')
        if content is None and number < 100:
            content = read(fd, f'{number}-bericht.md')
    if content is None:
        raise HostError('NotFound', 'Report not found')
    return {'number': number, 'content': content}


def release(ctx, _):
    gates = []
    with directory(work_path(ctx)) as fd:
        for name in ('api-full.log', 'web-full.log', 'extra-full.log'):
            content = read(fd, name)
            summary = [] if content is None else [line for line in content.splitlines()
                if re.fullmatch(r'\s*\d+ (?:pass|fail).*', line) or line.startswith('helena-gate-extra:')]
            modified = iso(os.stat(name, dir_fd=fd, follow_symlinks=False).st_mtime) if content is not None else None
            gates.append({'file': name, 'summary': summary[-8:], 'available': content is not None, 'modifiedAt': modified})
    sha = ctx.host.run(['git', '-C', '/srv/volition/source/plan', 'rev-parse', 'HEAD'], timeout=5)
    return {'liveSha': sha.stdout.strip() if sha.returncode == 0 and re.fullmatch(r'[a-f0-9]{40}', sha.stdout.strip()) else None,
            'gates': gates}


def queue_control(ctx, params):
    number = params['number']
    action = params['action']
    if not 1 <= number <= 999999999 or action not in ('stop', 'requeue'):
        raise HostError('InvalidParameter', 'Invalid queue action')
    with directory(work_path(ctx) + '/codex-tasks') as fd:
        lock = open_file(fd, '.volition-queue.lock', os.O_RDWR | os.O_CREAT)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX)
            names = [name for name in os.listdir(fd) if (match := TASK.fullmatch(name)) and int(match[1]) == number and not name.endswith(('-bericht.md', '-last.md'))]
            if len(names) != 1:
                raise HostError('NotFound', 'One unambiguous task file is required')
            read(fd, names[0])
            queue = open_file(fd, 'queue.txt', os.O_RDWR | os.O_CREAT)
            try:
                if os.fstat(queue).st_size > 1048576:
                    raise HostError('Busy', 'Queue is too large to rewrite safely')
                lines = os.read(queue, 1048576).decode('utf-8').splitlines()
                lines = [line for line in lines if line != names[0]]
                processes = status(ctx, {})['running']
                if action == 'requeue':
                    if any(item['number'] == number for item in processes):
                        raise HostError('Busy', 'Stop the running task before requeueing')
                    lines.append(names[0])
                else:
                    for item in processes:
                        if item['number'] != number:
                            continue
                        pidfd = os.pidfd_open(item['pid'])
                        try:
                            with open(f"/proc/{item['pid']}/cmdline", 'rb') as handle:
                                argv = handle.read(65536).split(b'\x00')
                            output = f"{work_path(ctx)}/codex-tasks/{number:03d}-last.md".encode()
                            if b'exec' not in argv or not any(b'codex' in arg for arg in argv) or output not in argv:
                                raise HostError('Busy', 'Task process changed before stopping')
                            signal.pidfd_send_signal(pidfd, signal.SIGTERM)
                        finally:
                            os.close(pidfd)
                os.ftruncate(queue, 0)
                os.lseek(queue, 0, os.SEEK_SET)
                os.write(queue, ('\n'.join(lines) + ('\n' if lines else '')).encode())
                os.fsync(queue)
            finally:
                os.close(queue)
        finally:
            os.close(lock)
    return {'number': number, 'action': action}


def set_max(ctx, params):
    maximum = params['maximum']
    if isinstance(maximum, bool) or not 1 <= maximum <= 5:
        raise HostError('InvalidParameter', 'Codex concurrency must be between one and five')
    with directory(work_path(ctx) + '/codex-tasks') as fd:
        lock = open_file(fd, '.volition-queue.lock', os.O_RDWR | os.O_CREAT)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX)
            file = open_file(fd, 'max.txt', os.O_CREAT | os.O_RDWR)
            try:
                if os.geteuid() == 0:
                    owner = os.fstat(fd)
                    os.fchown(file, owner.st_uid, owner.st_gid)
                os.ftruncate(file, 0)
                os.write(file, (str(maximum) + '\n').encode())
                os.fsync(file)
            finally:
                os.close(file)
        finally:
            os.close(lock)
    return {'maximum': maximum}
