#!/usr/bin/python3 -I
"""Persistent preview supervisor, running as the project user inside its network namespace."""

from __future__ import annotations

import argparse
import asyncio
from collections import deque
import json
import os
from pathlib import Path
import re
import signal
import time


def now() -> int:
    return int(time.time() * 1000)


def clean_line(value: str) -> str:
    value = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', value)
    value = re.sub(r'(?i)(authorization\s*:\s*\S+\s+)\S+', r'\1[redacted]', value)
    value = re.sub(r'(?i)((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+',
                   r'\1[redacted]', value)
    value = re.sub(r'(https?://)[^\s/@:]+:[^\s/@]+@', r'\1[redacted]@', value)
    return ''.join(c for c in value if c in '\t' or ord(c) >= 32)[:1000]


async def pipe(reader, writer, touch) -> None:
    try:
        while data := await reader.read(65536):
            touch()
            writer.write(data)
            await writer.drain()
        if writer.can_write_eof():
            writer.write_eof()
    except (OSError, ConnectionError):
        pass


async def ready(port: int) -> bool:
    writer = None
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection('127.0.0.1', port), 1)
        writer.write(f'GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n'.encode())
        await writer.drain()
        line = await asyncio.wait_for(reader.readline(), 2)
        match = re.match(rb'HTTP/1\.[01] ([0-9]{3}) ', line)
        return bool(match and 200 <= int(match[1]) < 400)
    except (OSError, ConnectionError, asyncio.TimeoutError, ValueError):
        return False
    finally:
        if writer:
            writer.close()


class Supervisor:
    def __init__(self, directory: str, port: int, idle: int, command: list[str], timeout: int = 60):
        self.directory = Path(directory)
        self.port, self.idle, self.command, self.timeout = port, idle, command, timeout
        self.lines: deque[str] = deque(maxlen=200)
        self.state = {'status': 'starting', 'startedAt': now(), 'lastActivityAt': now()}
        self.stop = asyncio.Event()

    def touch(self) -> None:
        self.state['lastActivityAt'] = now()

    def save(self) -> None:
        bounded, size = [], 0
        for line in reversed(self.lines):
            size += len(json.dumps(line).encode()) + 2
            if size > 210_000:
                break
            bounded.append(line)
        value = {**self.state, 'heartbeatAt': now(), 'lines': list(reversed(bounded))}
        data = json.dumps(value)
        temporary = self.directory / 'status.new'
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as handle:
            handle.write(data)
        os.replace(temporary, self.directory / 'status.json')

    async def logs(self, reader) -> None:
        pending = b''
        while chunk := await reader.read(4096):
            pending += chunk
            while b'\n' in pending or len(pending) >= 4096:
                boundary = pending.find(b'\n')
                length = boundary + 1 if 0 <= boundary < 4096 else 4096
                self.lines.append(clean_line(pending[:length].decode(errors='replace').rstrip()))
                pending = pending[length:]
        if pending:
            self.lines.append(clean_line(pending.decode(errors='replace')))

    async def connection(self, reader, writer) -> None:
        upstream = None
        try:
            remote, upstream = await asyncio.open_connection('127.0.0.1', self.port)
            self.touch()
            await asyncio.gather(pipe(reader, upstream, self.touch), pipe(remote, writer, self.touch))
        except (OSError, ConnectionError):
            pass
        finally:
            writer.close()
            if upstream:
                upstream.close()

    async def run(self) -> int:
        self.save()
        loop = asyncio.get_running_loop()
        for signum in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(signum, self.stop.set)
        try:
            process = await asyncio.create_subprocess_exec(
                *self.command, stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                start_new_session=True)
        except OSError:
            self.state.update(status='failed', error='The installed development executable could not start')
            self.save()
            return 1
        log_task = asyncio.create_task(self.logs(process.stdout))
        socket_path = self.directory / 'http.sock'
        socket_path.unlink(missing_ok=True)
        server = await asyncio.start_unix_server(self.connection, path=str(socket_path))
        os.chmod(socket_path, 0o600)
        deadline = time.monotonic() + self.timeout
        try:
            while not self.stop.is_set():
                if process.returncode is not None:
                    self.state.update(status='failed', error=f'Development server exited ({process.returncode})')
                    break
                if self.state['status'] == 'starting':
                    if await ready(self.port):
                        self.state['status'] = 'running'
                        self.touch()
                    elif time.monotonic() >= deadline:
                        self.state.update(status='failed', error=f'HTTP readiness timed out after {self.timeout:g} seconds')
                        break
                elif now() - self.state['lastActivityAt'] >= self.idle * 1000:
                    self.state.update(status='stopped', error='Preview stopped after inactivity')
                    break
                self.save()
                try:
                    await asyncio.wait_for(self.stop.wait(), .5)
                except asyncio.TimeoutError:
                    pass
        finally:
            server.close()
            await server.wait_closed()
            if process.returncode is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    await asyncio.wait_for(process.wait(), 8)
                except asyncio.TimeoutError:
                    os.killpg(process.pid, signal.SIGKILL)
                    await process.wait()
            await log_task
            if self.state['status'] != 'failed':
                self.state['status'] = 'stopped'
            self.save()
            socket_path.unlink(missing_ok=True)
        return 1 if self.state['status'] == 'failed' else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--idle', type=int, required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    return asyncio.run(Supervisor(args.directory, args.port, args.idle, command).run())


if __name__ == '__main__':
    raise SystemExit(main())
