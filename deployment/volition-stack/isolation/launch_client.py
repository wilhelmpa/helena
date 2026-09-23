#!/usr/bin/python3 -I
"""volition-agent-launch: talks to volition-agent-launcher for provisioning, the project
terminal and the proof tests. The runner speaks the same protocol itself
(packages/runner/src/isolation.ts)."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import select
import signal
import socket
import struct
import sys
import termios
import tty

FRAME = struct.Struct('>BI')
T_STDIN, T_EOF, T_RESIZE, T_STOP = 0x01, 0x02, 0x03, 0x04
T_ACCEPT, T_STDOUT, T_STDERR, T_EXIT, T_ERROR, T_RESULT = 0x10, 0x11, 0x12, 0x13, 0x14, 0x15


def connect() -> socket.socket:
    path = os.environ.get('VOLITION_LAUNCHER_SOCKET', '/run/volition-agent-launcher/launch.sock')
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(path)
    return sock


def send(sock: socket.socket, kind: int, payload: bytes = b'') -> None:
    sock.sendall(FRAME.pack(kind, len(payload)) + payload)


def recv_exactly(sock: socket.socket, size: int) -> bytes | None:
    data = bytearray()
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            return None
        data += chunk
    return bytes(data)


def recv_frame(sock: socket.socket) -> tuple[int, bytes] | None:
    head = recv_exactly(sock, FRAME.size)
    if head is None:
        return None
    kind, length = FRAME.unpack(head)
    payload = recv_exactly(sock, length)
    return None if payload is None else (kind, payload)


def request(sock: socket.socket, value: dict) -> None:
    sock.sendall(json.dumps({'v': 1, **value}).encode() + b'\n')


def single(value: dict) -> int:
    sock = connect()
    request(sock, value)
    answer = recv_frame(sock)
    if answer is None:
        print('volition-agent-launch: the launcher closed the connection', file=sys.stderr)
        return 1
    kind, payload = answer
    print(payload.decode())
    return 0 if kind == T_RESULT else 1


def run(args: argparse.Namespace) -> int:
    env = {}
    for item in args.env:
        name, _, value = item.partition('=')
        env[name] = value
    sock = connect()
    request(sock, {'op': 'run', 'slug': args.slug, 'runtime': args.runtime, 'profile': args.profile,
                   'cwd': args.cwd, 'args': args.args, 'env': env,
                   **({'agentId': args.agent_id} if args.agent_id else {}),
                   'work': {'kind': args.kind, 'id': args.work_id}})
    stdin_open = True
    while True:
        readable = [sock] + ([sys.stdin.buffer] if stdin_open else [])
        ready, _, _ = select.select(readable, [], [])
        if sys.stdin.buffer in ready:
            data = os.read(sys.stdin.fileno(), 65536)
            if data:
                send(sock, T_STDIN, data)
            else:
                send(sock, T_EOF)
                stdin_open = False
        if sock in ready:
            item = recv_frame(sock)
            if item is None:
                return 125
            kind, payload = item
            if kind == T_STDOUT:
                os.write(1, payload)
            elif kind == T_STDERR:
                os.write(2, payload)
            elif kind == T_ACCEPT and args.verbose:
                print(f'volition-agent-launch: {payload.decode()}', file=sys.stderr)
            elif kind == T_EXIT:
                return int(json.loads(payload).get('code') or 0)
            elif kind == T_ERROR:
                print(f'volition-agent-launch: {payload.decode()}', file=sys.stderr)
                return 126


def terminal(args: argparse.Namespace) -> int:
    rows, cols = 24, 80
    if os.isatty(0):
        rows, cols, _, _ = struct.unpack('HHHH', fcntl.ioctl(0, termios.TIOCGWINSZ, b'\0' * 8))
    sock = connect()
    request(sock, {'op': 'terminal', 'slug': args.slug, 'rows': rows or 24, 'cols': cols or 80})
    saved = termios.tcgetattr(0) if os.isatty(0) else None
    if saved is not None:
        tty.setraw(0)

    def resize(*_):
        if os.isatty(0):
            r, c, _, _ = struct.unpack('HHHH', fcntl.ioctl(0, termios.TIOCGWINSZ, b'\0' * 8))
            send(sock, T_RESIZE, json.dumps({'rows': r, 'cols': c}).encode())

    signal.signal(signal.SIGWINCH, resize)
    try:
        while True:
            try:
                ready, _, _ = select.select([sock, 0], [], [])
            except InterruptedError:
                continue
            if 0 in ready:
                data = os.read(0, 65536)
                if not data:
                    send(sock, T_STOP)
                    return 0
                send(sock, T_STDIN, data)
            if sock in ready:
                item = recv_frame(sock)
                if item is None:
                    return 0
                kind, payload = item
                if kind == T_STDOUT:
                    os.write(1, payload)
                elif kind == T_EXIT:
                    return int(json.loads(payload).get('code') or 0)
                elif kind == T_ERROR:
                    os.write(2, b'\r\nvolition-agent-launch: ' + payload + b'\r\n')
                    return 1
    finally:
        if saved is not None:
            termios.tcsetattr(0, termios.TCSADRAIN, saved)


def main() -> int:
    parser = argparse.ArgumentParser(prog='volition-agent-launch')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('ping')
    ensure = commands.add_parser('ensure-project-user')
    ensure.add_argument('slug')
    ensure.add_argument('--profile', action='append', default=[])
    remove = commands.add_parser('remove-project-user')
    remove.add_argument('slug')
    term = commands.add_parser('terminal')
    term.add_argument('slug')
    stop = commands.add_parser('terminal-stop')
    stop.add_argument('slug')
    runner = commands.add_parser('run')
    runner.add_argument('--slug', required=True)
    runner.add_argument('--runtime', required=True)
    runner.add_argument('--profile')
    runner.add_argument('--cwd', required=True)
    runner.add_argument('--env', action='append', default=[])
    runner.add_argument('--agent-id', type=int)
    runner.add_argument('--kind', default='run', choices=['run', 'chat', 'helper'])
    runner.add_argument('--work-id', type=int)
    runner.add_argument('--verbose', action='store_true')
    runner.add_argument('args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command == 'ping':
        return single({'op': 'ping'})
    if args.command == 'ensure-project-user':
        return single({'op': 'ensure-project-user', 'slug': args.slug, 'profiles': args.profile})
    if args.command == 'remove-project-user':
        return single({'op': 'remove-project-user', 'slug': args.slug})
    if args.command == 'terminal-stop':
        return single({'op': 'terminal-stop', 'slug': args.slug})
    if args.command == 'terminal':
        return terminal(args)
    if args.args[:1] == ['--']:
        args.args = args.args[1:]
    return run(args)


if __name__ == '__main__':
    raise SystemExit(main())
