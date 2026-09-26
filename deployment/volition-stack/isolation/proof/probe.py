#!/usr/bin/python3 -I
"""Runs inside an agent unit during the proof tests and reports, as JSON, what the unit can
reach: each argument is one check, `kind:arg[,arg…]`."""

from __future__ import annotations

import errno
import json
import os
import socket
import subprocess
import sys
import urllib.error
import urllib.request


def result(ok: bool, detail: str) -> dict:
    return {'ok': ok, 'detail': detail}


def err(error: OSError) -> str:
    return errno.errorcode.get(error.errno or 0, str(error.errno))


def check(spec: str) -> dict:
    kind, _, arg = spec.partition(':')
    args = arg.split(',') if arg else []
    try:
        if kind == 'whoami':
            return result(True, json.dumps({
                'uid': os.getuid(), 'gid': os.getgid(), 'groups': os.getgroups(), 'cwd': os.getcwd(),
                'home': os.environ.get('HOME'), 'hermes_home': os.environ.get('HERMES_HOME'),
                'proxy': os.environ.get('HTTPS_PROXY'), 'no_proxy': os.environ.get('NO_PROXY'),
                'node_proxy': os.environ.get('NODE_USE_ENV_PROXY'),
                'env_key': 'ITSAPLAN_API_KEY' in os.environ,
            }))
        if kind == 'tcp':
            host, port = args[0], int(args[1])
            sock = socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET)
            sock.settimeout(3)
            try:
                sock.connect((host, port))
                return result(True, 'connected')
            except OSError as error:
                return result(False, err(error) if error.errno else type(error).__name__)
            finally:
                sock.close()
        if kind == 'unix':
            sock = socket.socket(socket.AF_UNIX)
            sock.settimeout(3)
            try:
                sock.connect(args[0])
                return result(True, 'connected')
            except OSError as error:
                return result(False, err(error))
            finally:
                sock.close()
        if kind in ('unixread', 'unixtwice'):
            # What a Unix socket answers on connect (the browser gateway proof's stand-in says
            # which project it serves); `unixtwice` reads again after a pause, across a restart
            # of the listener, to prove a bound directory still reaches the new socket.
            def read_once(path: str) -> str:
                sock = socket.socket(socket.AF_UNIX)
                sock.settimeout(3)
                try:
                    sock.connect(path)
                    return sock.recv(64).decode('utf-8', 'replace').strip()
                except OSError as error:
                    return f'!{err(error)}'
                finally:
                    sock.close()
            first = read_once(args[0])
            if kind == 'unixread':
                return result(not first.startswith('!'), first)
            import time  # noqa: PLC0415
            time.sleep(float(args[1]))
            second = read_once(args[0])
            return result(not first.startswith('!') and not second.startswith('!'), f'{first}|{second}')
        if kind == 'read':
            path = args[0]
            try:
                if os.path.isdir(path):
                    return result(True, f'listed {len(os.listdir(path))}')
                with open(path, 'rb') as handle:
                    return result(True, f'read {len(handle.read(64))}')
            except OSError as error:
                return result(False, err(error))
        if kind == 'write':
            path = args[0]
            try:
                with open(path, 'w') as handle:
                    handle.write('probe\n')
                return result(True, 'written')
            except OSError as error:
                return result(False, err(error))
        if kind == 'curl':
            # curl with the unit's environment: the proxy unless --noproxy is given.
            command = ['curl', '-sS', '-o', '/dev/null', '-w', 'http=%{http_code} connect=%{http_connect}', '--max-time', '15', *args]
            done = subprocess.run(command, capture_output=True, text=True, timeout=30)
            code = done.stdout.strip()
            return result(done.returncode == 0 and code.startswith(('http=2', 'http=3')),
                          f'rc={done.returncode} {code} {done.stderr.strip()[:160]}')
        if kind == 'plan':
            # A request to the Plan API on the unit's loopback: method, path, header=value…
            method, path, *headers = args
            request = urllib.request.Request(f'http://127.0.0.1:3000{path}', method=method)
            for header in headers:
                name, _, value = header.partition('=')
                if value.startswith('$'):
                    value = os.environ.get(value[1:], '')
                request.add_header(name, value)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                with opener.open(request, timeout=15) as response:
                    return result(True, f'http={response.status}')
            except urllib.error.HTTPError as error:
                return result(False, f'http={error.code}')
            except OSError as error:
                return result(False, str(error)[:160])
        if kind == 'raw':
            # Raw bytes to a TCP port on the unit's loopback, answer's status line back.
            host, port, payload = args[0], int(args[1]), bytes.fromhex(args[2])
            sock = socket.create_connection((host, port), timeout=5)
            try:
                sock.sendall(payload)
                data = b''
                while b'\r\n' not in data and len(data) < 4096:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                return result(True, data.split(b'\r\n', 1)[0].decode('latin-1'))
            finally:
                sock.close()
        if kind == 'exec':
            done = subprocess.run(args, capture_output=True, text=True, timeout=60)
            return result(done.returncode == 0, f'rc={done.returncode} {(done.stdout + done.stderr).strip()[:300]}')
        return result(False, f'unknown check {kind}')
    except Exception as error:  # noqa: BLE001
        return result(False, f'{type(error).__name__}: {error}'[:200])


def main() -> None:
    specs = [a for a in sys.argv[1:] if a != '--']
    print(json.dumps({spec: check(spec) for spec in specs}))


if __name__ == '__main__':
    main()
