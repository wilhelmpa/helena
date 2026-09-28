#!/usr/bin/env python3
"""Read-only checks after Claude has enabled the home network services."""
from __future__ import annotations

import ipaddress
import pathlib
import socket
import ssl
import struct
import subprocess
import sys
import time

HOST = 'helena.volition.one'
LAN = '192.168.2.58'


def dns_a(server: str, name: str) -> list[str]:
    query = bytearray(struct.pack('!HHHHHH', 0x290B, 0x0100, 1, 0, 0, 0))
    for label in name.split('.'):
        query.append(len(label))
        query.extend(label.encode('ascii'))
    query.extend(b'\0\0\1\0\1')
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(3)
    try:
        sock.sendto(query, (server, 53))
        data, _ = sock.recvfrom(4096)
    finally:
        sock.close()
    if len(data) < 12 or data[:2] != query[:2] or data[3] & 15:
        raise RuntimeError(f'DNS query failed for {name} via {server}')
    count = struct.unpack_from('!H', data, 6)[0]
    if not count:
        return []
    # dnsmasq host-record answers have a fixed A RDATA at the end of each answer.
    # Decode all four-octet A records without assuming a compressed-name length.
    found: list[str] = []
    for offset in range(12, len(data) - 10):
        if data[offset:offset + 4] != b'\0\1\0\1':
            continue
        length = struct.unpack_from('!H', data, offset + 8)[0]
        if length == 4 and offset + 14 <= len(data):
            found.append(socket.inet_ntoa(data[offset + 10:offset + 14]))
    return found


def edge_response(path: str) -> tuple[int, bool]:
    result = subprocess.run([
        'curl', '--silent', '--show-error', '--max-time', '10', '--resolve',
        f'{HOST}:443:{LAN}', '-D', '-', '-o', '/dev/null', f'https://{HOST}{path}',
    ], capture_output=True, text=True, check=True)
    blocks = result.stdout.strip().split('\r\n\r\n')
    headers = blocks[-1].replace('\r', '').split('\n')
    status = int(headers[0].split()[1])
    edge = any(line.lower().startswith('cf-ray:') for line in headers[1:])
    return status, edge


def main() -> int:
    failed = False
    for name in (HOST, 'helena-home.volition.one'):
        try:
            answer = dns_a(LAN, name)
            good = LAN in answer
            print(f'DNS {name}: {answer} {"OK" if good else "FAIL"}')
            failed |= not good
        except Exception as exc:
            print(f'DNS {name}: FAIL ({exc})')
            failed = True
    try:
        public = dns_a('1.1.1.1', HOST)
        good = any(ipaddress.ip_address(value).is_global for value in public)
        print(f'Public DNS: {public} {"OK" if good else "FAIL"}')
        failed |= not good
    except Exception as exc:
        print(f'Public DNS: FAIL ({exc})')
        failed = True
    try:
        with socket.create_connection((LAN, 443), timeout=5) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=HOST) as tls:
                cert = tls.getpeercert()
                print(f'TLS certificate: OK, expires {cert["notAfter"]}')
    except Exception as exc:
        print(f'TLS certificate: FAIL ({exc})')
        failed = True
    for path in ('/', '/cdn-cgi/access/login'):
        try:
            status, edge = edge_response(path)
            good = edge and status < 500
            print(f'Edge path {path}: HTTP {status}, CF-Ray={edge} {"OK" if good else "FAIL"}')
            failed |= not good
        except Exception as exc:
            print(f'Edge path {path}: FAIL ({exc})')
            failed = True
    leases = pathlib.Path('/var/lib/helena-dnsmasq/leases')
    if pathlib.Path('/etc/helena/dnsmasq.d/dhcp.conf').exists():
        count = 0
        if leases.exists():
            for line in leases.read_text().splitlines():
                fields = line.split()
                if fields and fields[0].isdigit() and int(fields[0]) > time.time():
                    count += 1
        good = count > 0
        print(f'DHCP: enabled; {count} active lease(s) {"OK" if good else "PENDING CLIENT RENEWAL"}')
    else:
        print('DHCP: disabled')
    print('Valid-cookie local path and stream expiry require a signed-in client acceptance test.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
