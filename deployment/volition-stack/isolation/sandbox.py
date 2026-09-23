#!/usr/bin/python3 -I
"""volition-agent-sandbox: the first program of every agent unit.

The unit has a network namespace of its own with nothing but a loopback device. This program
makes the two ways out that an agent has reachable on that loopback, each a plain byte pipe to
a Unix socket bound into the unit from the host:

    127.0.0.1:3128 → egress.sock   the HTTP(S) proxy, which only reaches public addresses
    127.0.0.1:3000 → plan.sock     the Plan API, which checks the agent's key against its project

and then replaces itself with the runtime (Hermes, Claude Code, Codex, a shell), with the proxy
in its environment. It runs as the project user and has no more rights than the runtime.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import socket
import sys
import time

MAX_HEADER = 4 * 1024 * 1024
PROXY_PORT = 3128


def fail(message: str, code: int = 70) -> 'NoReturn':  # noqa: F821
    print(f'volition-agent-sandbox: {message}', file=sys.stderr, flush=True)
    raise SystemExit(code)


def read_exactly(fd: int, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        chunk = os.read(fd, size - len(data))
        if not chunk:
            fail('the launcher closed the unit input early')
        data += chunk
    return bytes(data)


def read_env_header() -> dict[str, str]:
    """The caller's variables arrive on stdin ahead of the task, read to the byte so that
    everything after them reaches the runtime untouched."""
    head = read_exactly(0, 11)
    if head[10:11] != b'\n' or not head[:10].isdigit():
        fail('the unit input has no variable header')
    size = int(head[:10])
    if size > MAX_HEADER:
        fail('the variable header is too large')
    value = json.loads(read_exactly(0, size) or b'{}')
    if not isinstance(value, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
        fail('the variable header is invalid')
    return value


def proxy_environment(forwards: dict[int, str]) -> dict[str, str]:
    env = {
        'NO_PROXY': 'localhost,127.0.0.1,::1',
        'no_proxy': 'localhost,127.0.0.1,::1',
    }
    if PROXY_PORT in forwards:
        proxy = f'http://127.0.0.1:{PROXY_PORT}'
        env.update({
            'HTTP_PROXY': proxy,
            'HTTPS_PROXY': proxy,
            'http_proxy': proxy,
            'https_proxy': proxy,
            'NODE_USE_ENV_PROXY': '1',
            'npm_config_proxy': proxy,
            'npm_config_https_proxy': proxy,
        })
    return env


def ensure_links(home: str, links: list[tuple[str, str]]) -> None:
    """Links the runtime expects in its profile (the shared Hermes configuration, the Plan
    approval guard). Made here, as the project user, so no one else writes in a profile."""
    for name, target in links:
        path = os.path.join(home, name)
        parent = os.path.dirname(path)
        try:
            os.makedirs(parent, mode=0o700, exist_ok=True)
            if os.path.islink(path):
                if os.readlink(path) == target:
                    continue
                os.unlink(path)
            elif os.path.lexists(path):
                print(f'volition-agent-sandbox: {name} in the profile is not a link, left as it is',
                      file=sys.stderr, flush=True)
                continue
            os.symlink(target, path)
        except OSError as error:
            print(f'volition-agent-sandbox: cannot link {name}: {error.strerror}', file=sys.stderr, flush=True)


# ── Forwarders ───────────────────────────────────────────────────────────────────────────


async def splice(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk:
                break
            writer.write(chunk)
            await writer.drain()
        if writer.can_write_eof():
            writer.write_eof()
    except (ConnectionError, OSError):
        pass


async def forward(client_reader, client_writer, socket_path: str) -> None:
    try:
        upstream_reader, upstream_writer = await asyncio.open_unix_connection(socket_path)
    except OSError:
        client_writer.close()
        return
    try:
        await asyncio.gather(
            splice(client_reader, upstream_writer),
            splice(upstream_reader, client_writer),
        )
    finally:
        for writer in (client_writer, upstream_writer):
            try:
                writer.close()
            except (ConnectionError, OSError, RuntimeError):
                pass


async def follow_parent(parent: int) -> None:
    """The forwarders live exactly as long as the runtime: when it exits, this process is
    handed to another parent and ends too, so the unit stops at once."""
    while os.getppid() == parent:
        await asyncio.sleep(0.25)
    os._exit(0)


async def serve_forwards(forwards: dict[int, str], ready_fd: int, parent: int) -> None:
    asyncio.ensure_future(follow_parent(parent))
    servers = []
    for port, socket_path in forwards.items():
        handler = lambda r, w, p=socket_path: forward(r, w, p)  # noqa: E731
        servers.append(await asyncio.start_server(handler, '127.0.0.1', port))
        try:
            servers.append(await asyncio.start_server(handler, '::1', port))
        except OSError:
            pass  # no IPv6 loopback in this namespace
    os.write(ready_fd, b'1')
    os.close(ready_fd)
    await asyncio.gather(*(server.serve_forever() for server in servers))


def start_forwards(forwards: dict[int, str]) -> None:
    """Forks the process that keeps the forwarders open while the runtime runs. It stays in
    the unit, so stopping the unit stops it too."""
    if not forwards:
        return
    read_end, write_end = os.pipe()
    parent = os.getpid()
    pid = os.fork()
    if pid == 0:
        os.close(read_end)
        devnull = os.open(os.devnull, os.O_RDWR)
        os.dup2(devnull, 0)
        os.dup2(devnull, 1)
        os.close(devnull)
        # The runtime is the unit's main process. A stop interrupts it, and it may still need
        # the network while it ends its turn; this process follows it out (follow_parent).
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        try:
            asyncio.run(serve_forwards(forwards, write_end, parent))
        except BaseException as error:  # noqa: BLE001
            print(f'volition-agent-sandbox: forwarder stopped: {error}', file=sys.stderr, flush=True)
        os._exit(0)
    os.close(write_end)
    ready = os.read(read_end, 1)
    os.close(read_end)
    if ready != b'1':
        fail('the forwarders did not start')


# ── Modes ────────────────────────────────────────────────────────────────────────────────


def parse(argv: list[str]) -> argparse.Namespace:
    """Options up to `--`, the runtime's command line after it, taken as it is."""
    split = argv.index('--') if '--' in argv else len(argv)
    parser = argparse.ArgumentParser(prog='volition-agent-sandbox')
    parser.add_argument('mode', choices=['run', 'terminal-server', 'terminal-attach'])
    parser.add_argument('--forward', action='append', default=[])
    parser.add_argument('--link', action='append', default=[])
    parser.add_argument('--env-header', action='store_true')
    parser.add_argument('--socket')
    parser.add_argument('--conf')
    parser.add_argument('--session')
    parser.add_argument('--cwd')
    args = parser.parse_args(argv[:split])
    args.command = argv[split + 1:]
    return args


def main(argv: list[str]) -> None:
    args = parse(argv)
    forwards: dict[int, str] = {}
    for item in args.forward:
        port, _, path = item.partition('=')
        if not port.isdigit() or not path.startswith('/'):
            fail(f'invalid forward {item}')
        forwards[int(port)] = path
    links = []
    for item in args.link:
        name, _, target = item.partition('=')
        if not name or '..' in name.split('/') or name.startswith('/') or not target.startswith('/'):
            fail(f'invalid link {item}')
        links.append((name, target))

    env = dict(os.environ)
    env.pop('VOLITION_AGENT_SANDBOX_ARGS', None)
    if args.mode == 'run':
        command = args.command
        if not command:
            fail('no runtime to start')
        if args.env_header:
            env.update(read_env_header())
        env.update(proxy_environment(forwards))
        home = env.get('HERMES_HOME') or env.get('HOME')
        if home and links:
            ensure_links(home, links)
        start_forwards(forwards)
        try:
            os.execve(command[0], command, env)
        except OSError as error:
            fail(f'cannot start {os.path.basename(command[0])}: {error.strerror}', 127)

    if args.mode == 'terminal-server':
        if not args.socket or not args.conf:
            fail('terminal-server needs --socket and --conf')
        env.update(proxy_environment(forwards))
        start_forwards(forwards)
        try:
            os.unlink(args.socket)
        except FileNotFoundError:
            pass
        os.umask(0o077)
        os.execve('/usr/bin/tmux', ['tmux', '-D', '-S', args.socket, '-f', args.conf], env)

    if args.mode == 'terminal-attach':
        if not args.socket or not args.session or not args.cwd:
            fail('terminal-attach needs --socket, --session and --cwd')
        deadline = time.monotonic() + 10
        while not os.path.exists(args.socket):
            if time.monotonic() > deadline:
                fail('the project terminal is not running')
            time.sleep(0.05)
        os.execve('/usr/bin/tmux', ['tmux', '-S', args.socket, 'new-session', '-A', '-s', args.session,
                                    '-c', args.cwd, '/bin/bash', '-l'], env)


if __name__ == '__main__':
    main(sys.argv[1:])
