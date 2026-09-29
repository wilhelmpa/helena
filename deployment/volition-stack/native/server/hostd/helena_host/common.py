"""Shared pieces of helena-hostd: the host object every reader and writer goes through (so the
tests can hand in a fake file system root and fake commands), errors, subprocess without a
shell, atomic state files and locks."""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
import selectors
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from typing import Callable, Iterator

VERSION = '1.0.0'

# Commands run with this environment only: no inherited variables, a fixed PATH and the C
# locale, so their output parses the same way on every machine.
BASE_ENV = {
    'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'LC_ALL': 'C',
    'LANG': 'C',
}


class HostError(Exception):
    """An error a caller may see: a stable code (the varlink error name's last part) and a
    short English message without paths or secrets."""

    def __init__(self, code: str, message: str, **parameters: object):
        super().__init__(message)
        self.code = code
        self.message = message
        self.parameters = parameters


@dataclass
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


Runner = Callable[..., CommandResult]


def run_command(argv: list[str], *, timeout: float = 30, input: str | None = None,
                env: dict[str, str] | None = None, stdout_path: str | None = None,
                stdin_path: str | None = None, output_limit: int | None = None) -> CommandResult:
    """Runs a command without a shell. `stdout_path` streams stdout into a new file (0600)
    instead of memory, for database dumps; `stdin_path` feeds a file root opened (a dump
    handed to a tool that runs as another user)."""
    full_env = dict(BASE_ENV)
    if env:
        full_env.update(env)
    if output_limit is not None:
        proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, env=full_env)
        captured = bytearray()
        deadline = time.monotonic() + timeout
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(proc.stdout, selectors.EVENT_READ)
                while selector.get_map():
                    if time.monotonic() >= deadline:
                        raise subprocess.TimeoutExpired(argv, timeout, output=bytes(captured))
                    for key, _ in selector.select(0.1):
                        chunk = os.read(key.fd, 65536)
                        if not chunk:
                            selector.unregister(key.fd)
                        else:
                            captured.extend(chunk[:max(0, output_limit - len(captured))])
                code = proc.wait(timeout=max(0.1, deadline - time.monotonic()))
            return CommandResult(code, captured.decode('utf-8', 'replace'), '')
        except subprocess.TimeoutExpired as error:
            error.output = bytes(captured)
            raise
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            proc.stdout.close()
    if stdin_path is not None:
        with open(stdin_path, 'rb') as source:
            proc = subprocess.run(argv, stdin=source, capture_output=True, env=full_env,
                                  timeout=timeout, check=False)
        return CommandResult(proc.returncode, proc.stdout.decode('utf-8', 'replace'),
                             proc.stderr.decode('utf-8', 'replace'))
    if stdout_path is not None:
        fd = os.open(stdout_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        with os.fdopen(fd, 'wb') as out:
            proc = subprocess.run(argv, stdout=out, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                                  env=full_env, timeout=timeout, check=False)
        return CommandResult(proc.returncode, '', proc.stderr.decode('utf-8', 'replace'))
    proc = subprocess.run(argv, input=input.encode() if input is not None else None,
                          stdin=None if input is not None else subprocess.DEVNULL,
                          capture_output=True, env=full_env, timeout=timeout, check=False)
    return CommandResult(proc.returncode, proc.stdout.decode('utf-8', 'replace'),
                         proc.stderr.decode('utf-8', 'replace'))


@dataclass
class Host:
    """Everything hostd touches on the machine. `root` prefixes every absolute path read or
    written through `path()` (the tests point it at a temporary tree); `run` executes a
    command; `which` finds a program (the tests say which ones exist)."""

    root: str = '/'
    run: Runner = run_command
    now: Callable[[], float] = time.time
    sleep: Callable[[float], None] = time.sleep
    programs: dict[str, str] | None = None
    extra: dict[str, object] = field(default_factory=dict)

    def path(self, absolute: str) -> str:
        if not absolute.startswith('/'):
            raise ValueError(f'not absolute: {absolute}')
        if self.root == '/':
            return absolute
        return os.path.join(self.root, absolute.lstrip('/'))

    def which(self, name: str) -> str | None:
        if self.programs is not None:
            return self.programs.get(name)
        for directory in BASE_ENV['PATH'].split(':'):
            candidate = os.path.join(directory, name)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
        return None

    def read(self, absolute: str, limit: int = 1_048_576) -> str | None:
        """A file's text, or None when it is missing or unreadable."""
        try:
            with open(self.path(absolute), 'rb') as handle:
                return handle.read(limit).decode('utf-8', 'replace')
        except OSError:
            return None

    def read_int(self, absolute: str) -> int | None:
        text = self.read(absolute, 256)
        if text is None:
            return None
        try:
            return int(text.strip().split()[0])
        except (ValueError, IndexError):
            return None

    def exists(self, absolute: str) -> bool:
        return os.path.exists(self.path(absolute))

    def listdir(self, absolute: str) -> list[str]:
        try:
            return sorted(os.listdir(self.path(absolute)))
        except OSError:
            return []

    def write_sysfs(self, absolute: str, value: str) -> None:
        """Writes one value into a kernel attribute. Only paths under /sys are allowed."""
        if not absolute.startswith('/sys/'):
            raise HostError('Internal', 'refusing to write outside /sys')
        try:
            with open(self.path(absolute), 'w', encoding='ascii') as handle:
                handle.write(value)
        except OSError as error:
            raise HostError('WriteFailed', f'the kernel refused the value ({error.strerror})') from None


# ── Values ───────────────────────────────────────────────────────────────────────────────

SAFE_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$')


def json_load_file(path: str, default: object = None) -> object:
    try:
        with open(path, 'rb') as handle:
            return json.loads(handle.read(4_194_304))
    except (OSError, ValueError):
        return default


def atomic_write_json(path: str, value: object, mode: int = 0o600) -> None:
    """Writes a JSON file so a reader sees the old or the new content, never half of it."""
    directory = os.path.dirname(path)
    fd, temp = tempfile.mkstemp(prefix='.tmp-', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, mode)
        os.replace(temp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temp)
        raise


def atomic_write_text(path: str, text: str, mode: int = 0o644) -> None:
    directory = os.path.dirname(path)
    fd, temp = tempfile.mkstemp(prefix='.tmp-', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, mode)
        os.replace(temp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temp)
        raise


@contextlib.contextmanager
def file_lock(path: str, *, blocking: bool = True) -> Iterator[bool]:
    """An exclusive flock on `path` (created 0600). Yields whether it was taken."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_CLOEXEC, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            yield False
            return
        yield True
    finally:
        os.close(fd)


def iso(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(timestamp))


def clip(text: str | None, limit: int = 4000) -> str:
    """The tail of a command's output for a log: bounded, and never more than `limit`."""
    if not text:
        return ''
    text = text.strip()
    return text if len(text) <= limit else '…' + text[-limit:]
