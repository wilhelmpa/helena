#!/usr/bin/python3 -I
"""volition-agent-plan: the Plan API as isolated agents reach it.

Listens on a Unix socket only project users can open and forwards one request per connection
to the Plan API on the host's loopback, which is the only place it ever connects to. It
- names the project of the Unix user that connected (X-Volition-Agent-Project) and the unit
  (X-Volition-Agent-Unit); Plan then accepts only an agent key of that project;
- rebuilds the request head from the parsed request and forwards only the headers an agent's
  API or MCP call needs: no cookie, no forwarding header, nothing the host's own proxies set;
- frames the body itself (Content-Length or chunked, never both), so a second request cannot
  ride along in the first one's body.
"""

from __future__ import annotations

import asyncio
import grp
import os
import pwd
import re
import socket
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)

from isolation_common import (  # noqa: E402
    unix_server_options,
    HttpError,
    parse_request_head,
    parse_unit,
    peer_credentials,
    read_head,
    unit_of_pid,
    valid_slug,
)

FORWARDED_HEADERS = {
    'accept', 'accept-encoding', 'accept-language', 'authorization', 'cache-control', 'content-type',
    'if-match', 'if-modified-since', 'if-none-match', 'last-event-id', 'mcp-protocol-version',
    'mcp-session-id', 'range', 'traceparent', 'tracestate', 'user-agent', 'x-api-key', 'x-request-id',
}
METHODS = {'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'}
TARGET_RE = re.compile(r"^/[A-Za-z0-9\-._~!$&'()*+,;=:@/%?]*$")
MAX_BODY = 64 * 1024 * 1024
CHUNK_LINE = 4096


def log(message: str) -> None:
    print(f'volition-agent-plan: {message}', file=sys.stderr, flush=True)


class PlanProxy:
    def __init__(self, upstream: tuple[str, int], user_prefix: str, unit_prefix: str, agents_group: str):
        self.upstream = upstream
        self.user_prefix = user_prefix
        self.unit_prefix = unit_prefix
        self.agents_group = agents_group

    def identify(self, writer) -> tuple[str, str] | None:
        pid, uid, _gid = peer_credentials(writer.get_extra_info('socket'))
        try:
            name = pwd.getpwuid(uid).pw_name
        except KeyError:
            return None
        if not name.startswith(self.user_prefix):
            return None
        slug = name[len(self.user_prefix):]
        if not valid_slug(slug):
            return None
        try:
            if name not in grp.getgrnam(self.agents_group).gr_mem:
                return None
        except KeyError:
            return None
        unit = unit_of_pid(pid) or ''
        meta = parse_unit(unit, self.unit_prefix)
        return slug, (unit if meta and meta['slug'] == slug else '')

    async def respond(self, writer, status: int, message: str) -> None:
        body = f'{{"error":"{message}"}}'.encode()
        writer.write(
            f'HTTP/1.1 {status} Refused\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n'
            f'Connection: close\r\n\r\n'.encode() + body)
        try:
            await writer.drain()
        except (ConnectionError, OSError):
            pass

    async def handle(self, reader, writer) -> None:
        upstream_writer = None
        try:
            identity = self.identify(writer)
            if identity is None:
                return
            slug, unit = identity
            try:
                raw = await asyncio.wait_for(read_head(reader), 30)
                head = parse_request_head(raw)
                if head.method not in METHODS:
                    raise HttpError(405, 'method not allowed')
                if not TARGET_RE.match(head.target) or head.target.startswith('//'):
                    raise HttpError(400, 'only origin-form targets are forwarded')
                lengths = head.get('content-length')
                encodings = [v.strip().lower() for v in ','.join(head.get('transfer-encoding')).split(',') if v.strip()]
                if lengths and encodings:
                    raise HttpError(400, 'both Content-Length and Transfer-Encoding')
                if encodings and encodings != ['chunked']:
                    raise HttpError(400, 'unsupported transfer encoding')
                if len(set(lengths)) > 1 or (lengths and not lengths[0].isdigit()):
                    raise HttpError(400, 'invalid Content-Length')
                length = int(lengths[0]) if lengths else 0
                if length > MAX_BODY:
                    raise HttpError(413, 'body too large')
                if head.get('upgrade'):
                    raise HttpError(400, 'upgrades are not forwarded')
            except HttpError as error:
                if error.status:
                    await self.respond(writer, error.status, error.reason)
                return

            lines = [f'{head.method} {head.target} HTTP/1.1', f'Host: {self.upstream[0]}:{self.upstream[1]}']
            for name, value in head.headers:
                if name.lower() in FORWARDED_HEADERS:
                    lines.append(f'{name}: {value}')
            if encodings:
                lines.append('Transfer-Encoding: chunked')
            elif lengths or head.method in {'POST', 'PUT', 'PATCH'}:
                lines.append(f'Content-Length: {length}')
            lines += [f'X-Volition-Agent-Project: {slug}', 'Connection: close']
            if unit:
                lines.append(f'X-Volition-Agent-Unit: {unit}')

            upstream_reader, upstream_writer = await asyncio.wait_for(
                asyncio.open_connection(*self.upstream, limit=1 << 20), 10)
            upstream_writer.write(('\r\n'.join(lines) + '\r\n\r\n').encode('latin-1'))
            body = asyncio.ensure_future(self.body(reader, upstream_writer, length, bool(encodings)))
            response = asyncio.ensure_future(self.response(upstream_reader, writer))
            try:
                done, _ = await asyncio.wait({body, response}, return_when=asyncio.FIRST_COMPLETED)
                if body in done and body.exception() is not None:
                    # A body that breaks its own framing ends the exchange; Plan never sees
                    # what came after the break.
                    return
                await response
            finally:
                body.cancel()
                response.cancel()
        except (ConnectionError, OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, HttpError):
            pass
        finally:
            for stream in (writer, upstream_writer):
                if stream is not None:
                    try:
                        stream.close()
                    except (ConnectionError, OSError, RuntimeError):
                        pass

    async def body(self, reader, upstream, length: int, chunked: bool) -> None:
        """Exactly one body, read by its own framing. Whatever follows it on the connection is
        never forwarded."""
        total = 0
        if not chunked:
            remaining = length
            while remaining:
                chunk = await reader.read(min(remaining, 65536))
                if not chunk:
                    return
                remaining -= len(chunk)
                upstream.write(chunk)
                await upstream.drain()
            return
        while True:
            line = await reader.readuntil(b'\r\n')
            if len(line) > CHUNK_LINE:
                raise HttpError(400, 'chunk line too long')
            size_text = line[:-2].split(b';', 1)[0].strip()
            if not size_text or not re.fullmatch(rb'[0-9A-Fa-f]{1,8}', size_text):
                raise HttpError(400, 'invalid chunk size')
            size = int(size_text, 16)
            total += size
            if total > MAX_BODY:
                raise HttpError(413, 'body too large')
            upstream.write(b'%x\r\n' % size)
            if size == 0:
                # Trailers are dropped; the body ends here.
                while True:
                    trailer = await reader.readuntil(b'\r\n')
                    if trailer == b'\r\n':
                        break
                    if len(trailer) > CHUNK_LINE:
                        raise HttpError(400, 'trailer too long')
                upstream.write(b'\r\n')
                await upstream.drain()
                return
            data = await reader.readexactly(size)
            if await reader.readexactly(2) != b'\r\n':
                raise HttpError(400, 'invalid chunk')
            upstream.write(data + b'\r\n')
            await upstream.drain()

    async def response(self, upstream_reader, writer) -> None:
        """The status line and headers as Plan sent them, but always `Connection: close`: one
        request per connection keeps every request's head under this proxy's control."""
        raw = await read_head(upstream_reader, 256 * 1024)
        lines = raw[:-4].split(b'\r\n')
        rebuilt = [lines[0]]
        for line in lines[1:]:
            name = line.split(b':', 1)[0].strip().lower()
            if name in (b'connection', b'keep-alive'):
                continue
            rebuilt.append(line)
        rebuilt.append(b'Connection: close')
        writer.write(b'\r\n'.join(rebuilt) + b'\r\n\r\n')
        await writer.drain()
        while True:
            chunk = await upstream_reader.read(65536)
            if not chunk:
                break
            writer.write(chunk)
            await writer.drain()


async def serve() -> None:
    upstream = os.environ.get('VOLITION_PLAN_UPSTREAM', '127.0.0.1:3000')
    host, _, port = upstream.rpartition(':')
    if host not in ('127.0.0.1', '::1') or not port.isdigit():
        raise SystemExit('VOLITION_PLAN_UPSTREAM must be a loopback address')
    proxy = PlanProxy((host, int(port)), os.environ.get('VOLITION_USER_PREFIX', 'vp-'),
                      os.environ.get('VOLITION_UNIT_PREFIX', 'volition-agent-'),
                      os.environ.get('VOLITION_AGENTS_GROUP', 'volition-agents'))
    if int(os.environ.get('LISTEN_FDS', '0') or 0) >= 1 and os.environ.get('LISTEN_PID') == str(os.getpid()):
        sock = socket.socket(fileno=3)
        activated = True
    else:
        path = os.environ['VOLITION_PLAN_SOCKET']
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(path)
        sock.listen(256)
    server = await asyncio.start_unix_server(proxy.handle, sock=sock, limit=64 * 1024, **unix_server_options(activated))
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
