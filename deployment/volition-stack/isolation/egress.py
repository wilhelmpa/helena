#!/usr/bin/python3 -I
"""volition-egress: the only way from an isolated agent to the internet.

An HTTP proxy on a Unix socket that only project users can open. It
- names the project from the kernel's peer credentials (the Unix user), never from the request;
- resolves the host itself and connects only to public addresses, to the address it checked
  (a second lookup cannot rebind the name to the LAN or to the host itself);
- allows ports 80 and 443, and the mail ports for a project with the mail role;
- applies the project's domain lists from Plan;
- reports host, port, decision and byte counts per unit to Plan, never contents.
"""

from __future__ import annotations

import asyncio
import fcntl
import ipaddress
import json
import grp
import os
import pwd
import socket
import struct
import sys
import time
import urllib.error
import urllib.request
from collections import OrderedDict

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)

from isolation_common import (  # noqa: E402
    HttpError,
    normalize_host,
    parse_request_head,
    parse_unit,
    peer_credentials,
    read_head,
    split_host_port,
    unit_of_pid,
    valid_slug,
)

BASE_PORTS = frozenset({80, 443})
MAIL_PORTS = frozenset({465, 587, 993})
HOP_BY_HOP = {
    'connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate',
    'te', 'trailer', 'upgrade',
}

BLOCKED_V4 = [ipaddress.IPv4Network(n) for n in (
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
    '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15',
    '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4', '255.255.255.255/32',
)]
BLOCKED_V6 = [ipaddress.IPv6Network(n) for n in (
    '::/128', '::1/128', '::ffff:0:0/96', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64',
    '2001::/32', '2001:db8::/32', '2002::/16', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8',
)]


def log(message: str) -> None:
    print(f'volition-egress: {message}', file=sys.stderr, flush=True)


# ── Addresses ────────────────────────────────────────────────────────────────────────────


def local_addresses() -> set[ipaddress._BaseAddress]:
    """The host's own addresses. A public one would otherwise be a way back to the host's
    services from outside the loopback."""
    found: set[ipaddress._BaseAddress] = set()
    try:
        with open('/proc/net/if_inet6', encoding='ascii') as handle:
            for line in handle:
                raw = line.split()[0]
                found.add(ipaddress.IPv6Address(int(raw, 16)))
    except OSError:
        pass
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        for _index, name in socket.if_nameindex():
            try:
                packed = fcntl.ioctl(probe.fileno(), 0x8915, struct.pack('256s', name.encode()[:15]))
                found.add(ipaddress.IPv4Address(packed[20:24]))
            except OSError:
                continue
    finally:
        probe.close()
    return found


class AddressPolicy:
    def __init__(self) -> None:
        self.local: set = set()
        self.refreshed = 0.0

    def refresh(self) -> None:
        if time.monotonic() - self.refreshed > 60:
            self.local = local_addresses()
            self.refreshed = time.monotonic()

    def public(self, address: str) -> bool:
        try:
            ip = ipaddress.ip_address(address.split('%', 1)[0])
        except ValueError:
            return False
        if isinstance(ip, ipaddress.IPv6Address):
            if ip.ipv4_mapped is not None:
                return self.public(str(ip.ipv4_mapped))
            if any(ip in network for network in BLOCKED_V6):
                return False
        elif any(ip in network for network in BLOCKED_V4):
            return False
        if not ip.is_global or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return False
        self.refresh()
        return ip not in self.local


# ── Policies from Plan ───────────────────────────────────────────────────────────────────

DEFAULT_POLICY = {'mode': 'open', 'allow': [], 'deny': [], 'mailPorts': False, 'projectId': None, 'agents': {}}


def domain_matches(host: str, domains: list[str]) -> bool:
    return any(host == domain or host.endswith(f'.{domain}') for domain in domains)


MODES = ('open', 'allowlist', 'blocked')


def effective_mode(policy: dict, agent_id: int | None) -> str:
    """The agent's own mode where the project gives it one, else the project's."""
    own = (policy.get('agents') or {}).get(str(agent_id)) if agent_id else None
    if own in MODES:
        return own
    mode = policy.get('mode')
    return mode if mode in MODES else 'open'


def decide(policy: dict, host: str, port: int, agent_id: int | None = None) -> str | None:
    """The reason a destination is refused before it is resolved, None when it may be tried."""
    mode = effective_mode(policy, agent_id)
    if mode == 'blocked':
        return 'blocked'
    ports = BASE_PORTS | (MAIL_PORTS if policy.get('mailPorts') else frozenset())
    if port not in ports:
        return 'port'
    if domain_matches(host, policy.get('deny') or []):
        return 'denylisted'
    if mode == 'allowlist' and not domain_matches(host, policy.get('allow') or []):
        return 'not-allowlisted'
    return None


class Plan:
    """Reads the project policies from Plan and reports the connection log to it. Plan may be
    away (restart, deploy): the last policies it answered are kept on disk, and the log is
    held back and sent later, within a bound."""

    def __init__(self, url: str, token_file: str | None, state_dir: str | None):
        self.url = url.rstrip('/')
        self.token_file = token_file
        self.cache = os.path.join(state_dir, 'policy.json') if state_dir else None
        self.policies: dict[str, dict] = {}
        self.pending: OrderedDict = OrderedDict()
        if self.cache:
            try:
                with open(self.cache, encoding='utf-8') as handle:
                    self.policies = json.load(handle).get('projects', {})
            except (OSError, ValueError):
                pass

    def token(self) -> str | None:
        if not self.token_file:
            return None
        try:
            with open(self.token_file, encoding='utf-8') as handle:
                return handle.read().strip() or None
        except OSError:
            return None

    def request(self, method: str, path: str, body: dict | None = None) -> dict | None:
        token = self.token()
        if not token:
            return None
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            f'{self.url}{path}', data=data, method=method,
            headers={'authorization': f'Bearer {token}', 'content-type': 'application/json'},
        )
        # Plan is on this host's loopback; the host's own proxy settings do not apply.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=10) as response:
                return json.loads(response.read(8 * 1024 * 1024))
        except (urllib.error.URLError, OSError, ValueError):
            return None

    def policy(self, slug: str) -> dict:
        return self.policies.get(slug) or DEFAULT_POLICY

    async def refresh(self) -> None:
        answer = await asyncio.to_thread(self.request, 'GET', '/internal/agent-egress/policy')
        projects = answer.get('projects') if isinstance(answer, dict) else None
        if not isinstance(projects, dict):
            return
        self.policies = {k: v for k, v in projects.items() if valid_slug(k) and isinstance(v, dict)}
        if self.cache:
            temporary = f'{self.cache}.tmp'
            try:
                with open(temporary, 'w', encoding='utf-8') as handle:
                    json.dump({'projects': self.policies}, handle)
                os.replace(temporary, self.cache)
            except OSError:
                pass

    def record(self, entry: dict, bytes_out: int, bytes_in: int) -> None:
        key = tuple(entry[k] for k in ('slug', 'agentId', 'runId', 'host', 'port', 'decision', 'reason'))
        now = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
        current = self.pending.get(key)
        if current is None:
            if len(self.pending) >= 5000:
                self.pending.popitem(last=False)
            self.pending[key] = {**entry, 'connections': 1, 'bytesOut': bytes_out, 'bytesIn': bytes_in,
                                 'firstAt': now, 'lastAt': now}
        else:
            current['connections'] += 1
            current['bytesOut'] += bytes_out
            current['bytesIn'] += bytes_in
            current['lastAt'] = now

    async def flush(self) -> None:
        if not self.pending:
            return
        batch = list(self.pending.items())[:500]
        answer = await asyncio.to_thread(self.request, 'POST', '/internal/agent-egress/events',
                                         {'events': [value for _, value in batch]})
        if isinstance(answer, dict) and 'stored' in answer:
            for key, _ in batch:
                self.pending.pop(key, None)

    async def loop(self, refresh_sec: float = 30, flush_sec: float = 10) -> None:
        last_refresh = 0.0
        while True:
            if time.monotonic() - last_refresh > refresh_sec:
                await self.refresh()
                last_refresh = time.monotonic()
            await self.flush()
            await asyncio.sleep(flush_sec)


# ── Connections ──────────────────────────────────────────────────────────────────────────


class Egress:
    def __init__(self, plan: Plan, user_prefix: str, unit_prefix: str, agents_group: str,
                 limits: dict | None = None):
        self.plan = plan
        self.user_prefix = user_prefix
        self.unit_prefix = unit_prefix
        self.agents_group = agents_group
        self.addresses = AddressPolicy()
        self.connections: dict[str, int] = {}
        self.limits = {'perProject': 256, 'total': 2048, 'idleSec': 900, 'connectSec': 10, **(limits or {})}

    def identify(self, writer) -> dict | None:
        sock = writer.get_extra_info('socket')
        pid, uid, _gid = peer_credentials(sock)
        try:
            name = pwd.getpwuid(uid).pw_name
        except KeyError:
            return None
        if not name.startswith(self.user_prefix):
            return None
        slug = name[len(self.user_prefix):]
        if not valid_slug(slug):
            return None
        # Only a project user is an agent: one of the agents group, as the launcher made it.
        try:
            if name not in grp.getgrnam(self.agents_group).gr_mem:
                return None
        except KeyError:
            return None
        meta = parse_unit(unit_of_pid(pid) or '', self.unit_prefix)
        same = meta is not None and meta['slug'] == slug
        return {
            'slug': slug,
            'agentId': meta['agentId'] if same else None,
            'runId': meta['runId'] if same else None,
        }

    async def respond(self, writer, status: int, reason: str, detail: str) -> None:
        text = {400: 'Bad Request', 403: 'Forbidden', 431: 'Request Header Fields Too Large',
                502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout'}.get(status, 'Error')
        body = f'volition egress: {detail}\n'.encode()
        writer.write(
            f'HTTP/1.1 {status} {text}\r\nContent-Type: text/plain; charset=utf-8\r\n'
            f'Content-Length: {len(body)}\r\nConnection: close\r\nX-Volition-Egress: {reason}\r\n\r\n'.encode()
            + body
        )
        try:
            await writer.drain()
        except (ConnectionError, OSError):
            pass

    async def resolve(self, host: str, port: int) -> list[str]:
        loop = asyncio.get_running_loop()
        try:
            ipaddress.ip_address(host)
            return [host]
        except ValueError:
            pass
        infos = await asyncio.wait_for(
            loop.getaddrinfo(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP), 10)
        seen: list[str] = []
        for family, _type, _proto, _canon, address in sorted(infos, key=lambda i: i[0] != socket.AF_INET):
            if address[0] not in seen:
                seen.append(address[0])
        return seen

    async def connect(self, addresses: list[str], port: int):
        last_error: Exception | None = None
        for address in addresses:
            try:
                return await asyncio.wait_for(
                    asyncio.open_connection(address, port, limit=1 << 20), self.limits['connectSec'])
            except (OSError, asyncio.TimeoutError) as error:
                last_error = error
        raise last_error or OSError('no address')

    async def handle(self, reader, writer) -> None:
        identity = None
        try:
            identity = self.identify(writer)
            if identity is None:
                return
            slug = identity['slug']
            if self.connections.get(slug, 0) >= self.limits['perProject'] or \
                    sum(self.connections.values()) >= self.limits['total']:
                await self.respond(writer, 503, 'busy', 'too many connections')
                return
            self.connections[slug] = self.connections.get(slug, 0) + 1
            try:
                await self.proxy(identity, reader, writer)
            finally:
                self.connections[slug] -= 1
        except HttpError as error:
            if error.status and identity:
                await self.respond(writer, error.status, 'bad-request', error.reason)
        except (ConnectionError, OSError, asyncio.TimeoutError, asyncio.IncompleteReadError):
            pass
        finally:
            try:
                writer.close()
            except (ConnectionError, OSError, RuntimeError):
                pass

    async def proxy(self, identity: dict, reader, writer) -> None:
        raw = await asyncio.wait_for(read_head(reader), 30)
        head = parse_request_head(raw)
        if head.method == 'CONNECT':
            host, port = split_host_port(head.target, None)
            forward_head = None
        else:
            target = head.target
            if not target.lower().startswith('http://'):
                raise HttpError(400, 'only absolute http:// requests and CONNECT are proxied')
            rest = target[7:]
            authority, slash, path = rest.partition('/')
            if '@' in authority:
                raise HttpError(400, 'credentials in the URL are not proxied')
            host, port = split_host_port(authority, 80)
            origin_form = f'/{path}' if slash else '/'
            headers = [(k, v) for k, v in head.headers if k.lower() not in HOP_BY_HOP and k.lower() != 'host']
            authority_header = f'[{host}]' if ':' in host else host
            if port != 80:
                authority_header += f':{port}'
            lines = [f'{head.method} {origin_form} {head.version}', f'Host: {authority_header}']
            lines += [f'{k}: {v}' for k, v in headers]
            lines.append('Connection: close')
            forward_head = ('\r\n'.join(lines) + '\r\n\r\n').encode('latin-1')

        entry = {'slug': identity['slug'], 'agentId': identity['agentId'], 'runId': identity['runId'],
                 'host': host, 'port': port, 'decision': 'blocked', 'reason': None}
        policy = self.plan.policy(identity['slug'])
        reason = decide(policy, host, port, identity['agentId'])
        if reason:
            return await self.block(writer, entry, reason, 403)
        try:
            addresses = await self.resolve(host, port)
        except (OSError, asyncio.TimeoutError, UnicodeError):
            return await self.block(writer, entry, 'dns', 502)
        public = [address for address in addresses if self.addresses.public(address)]
        if not public or len(public) != len(addresses):
            # A name that points anywhere private is refused as a whole: it is either a
            # misconfiguration or an attempt to reach the LAN through a public name.
            return await self.block(writer, entry, 'private-address', 403)
        try:
            upstream_reader, upstream_writer = await self.connect(public, port)
        except (OSError, asyncio.TimeoutError):
            return await self.block(writer, entry, 'connect-failed', 502)

        entry['decision'] = 'allowed'
        counts = {'out': 0, 'in': 0}
        try:
            if forward_head is None:
                writer.write(b'HTTP/1.1 200 Connection established\r\n\r\n')
                await writer.drain()
            else:
                upstream_writer.write(forward_head)
                counts['out'] += len(forward_head)
            await asyncio.gather(
                self.pipe(reader, upstream_writer, counts, 'out'),
                self.pipe(upstream_reader, writer, counts, 'in'),
            )
        finally:
            try:
                upstream_writer.close()
            except (ConnectionError, OSError, RuntimeError):
                pass
            self.plan.record(entry, counts['out'], counts['in'])

    async def pipe(self, reader, writer, counts: dict, direction: str) -> None:
        try:
            while True:
                chunk = await asyncio.wait_for(reader.read(65536), self.limits['idleSec'])
                if not chunk:
                    break
                counts[direction] += len(chunk)
                writer.write(chunk)
                await writer.drain()
            if writer.can_write_eof():
                writer.write_eof()
        except (ConnectionError, OSError, asyncio.TimeoutError):
            try:
                writer.close()
            except (ConnectionError, OSError, RuntimeError):
                pass

    async def block(self, writer, entry: dict, reason: str, status: int) -> None:
        entry['reason'] = reason
        self.plan.record(entry, 0, 0)
        log(f'{entry["slug"]}: refused {entry["host"]}:{entry["port"]} ({reason})')
        await self.respond(writer, status, reason, f'{entry["host"]}:{entry["port"]} refused ({reason})')


async def serve() -> None:
    token_file = os.environ.get('VOLITION_EGRESS_TOKEN_FILE')
    if not token_file and os.environ.get('CREDENTIALS_DIRECTORY'):
        token_file = os.path.join(os.environ['CREDENTIALS_DIRECTORY'], 'agent_egress_token')
    plan = Plan(
        os.environ.get('VOLITION_PLAN_URL', 'http://127.0.0.1:3000'),
        token_file,
        os.environ.get('STATE_DIRECTORY', '').split(':')[0] or None,
    )
    egress = Egress(plan, os.environ.get('VOLITION_USER_PREFIX', 'vp-'),
                    os.environ.get('VOLITION_UNIT_PREFIX', 'volition-agent-'),
                    os.environ.get('VOLITION_AGENTS_GROUP', 'volition-agents'))
    if int(os.environ.get('LISTEN_FDS', '0') or 0) >= 1 and os.environ.get('LISTEN_PID') == str(os.getpid()):
        sock = socket.socket(fileno=3)
    else:
        path = os.environ['VOLITION_EGRESS_SOCKET']
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(path)
        sock.listen(256)
    server = await asyncio.start_unix_server(egress.handle, sock=sock, limit=64 * 1024)
    background = asyncio.ensure_future(plan.loop(
        float(os.environ.get('VOLITION_EGRESS_REFRESH_SEC', '30')),
        float(os.environ.get('VOLITION_EGRESS_FLUSH_SEC', '10')),
    ))
    async with server:
        try:
            await server.serve_forever()
        finally:
            background.cancel()
            await plan.flush()


if __name__ == '__main__':
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
