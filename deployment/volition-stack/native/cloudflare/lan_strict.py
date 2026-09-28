#!/usr/bin/env python3
"""Prepare the strict canonical LAN entry. Dry run by default; never touches DNS.

Requires the existing tunnel entry, entry proof and LAN HTTPS site. --apply is for a
separate, approved installation after the browser and policy acceptance steps.
"""
from __future__ import annotations

import argparse
import ipaddress
import pathlib
import re
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
HOST = 'helena.volition.one'
WEB = '127.0.0.1:3001'
TUNNEL = HERE / 'nginx-tunnel.conf.in'
HEADERS = HERE / 'helena-lan-strict-headers.conf'
SITE = pathlib.Path('/etc/nginx/sites-available/helena-lan-strict.conf')
ENABLED = pathlib.Path('/etc/nginx/sites-enabled/helena-lan-strict.conf')
LEGACY = pathlib.Path('/etc/nginx/sites-available/volition.conf')
ENTRY_MAP = pathlib.Path('/etc/nginx/conf.d/helena-edge-entry.conf')
SNIPPET = pathlib.Path('/etc/nginx/snippets/helena-lan-strict-headers.conf')
BACKUPS = pathlib.Path('/var/lib/helena/hardening/backup')


def render(tunnel: str, certs: pathlib.Path, snippet: pathlib.Path = SNIPPET) -> str:
    """Use the existing tunnel routing and Helena permission checks verbatim."""
    marker = 'server {\n'
    if tunnel.count(marker) != 1:
        raise ValueError('expected one tunnel server block')
    server = tunnel[tunnel.index(marker):].replace('@HOST@', HOST)
    if server.count('    server_name helena.volition.one;\n') != 1 or \
            server.count('auth_request off;') != 3 or \
            '$helena_owner_capability' in server:
        raise ValueError('tunnel routing no longer matches the strict LAN security anchors')
    changes = {
        '    listen 127.0.0.1:@PORT@;\n': (
            '    listen 443 ssl;\n    listen [::]:443 ssl;\n    http2 on;\n'
            f'    ssl_certificate {certs}/fullchain.pem;\n'
            f'    ssl_certificate_key {certs}/privkey.pem;\n'
            '    include /etc/nginx/snippets/helena-tls.conf;\n'
            '    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;\n'
            '    access_log off;\n    error_log /dev/null crit;\n'
            '    if ($host != "helena.volition.one") { return 421; }\n'
            '    resolver 1.1.1.1 1.0.0.1 ipv6=off valid=30s;\n'
            '    resolver_timeout 3s;\n'
        ),
        '    auth_request /_helena_edge;': '    auth_request /_helena_lan;',
        'location = /_helena_edge': 'location = /_helena_lan',
        '/auth/verify/edge;': '/auth/verify/lan;',
        'include /etc/nginx/snippets/helena-tunnel-headers.conf;': f'include {snippet};',
        'return 301 /browser/;': 'rewrite ^ /browser/ last;',
        'return 301 /code/;': 'rewrite ^ /code/ last;',
        '        proxy_set_header X-Forwarded-Prefix /browser;\n': '',
        '        proxy_set_header X-Forwarded-Prefix /code;\n': '',
        '        proxy_set_header X-Forwarded-Prefix /terminal;\n': '',
        '        proxy_set_header X-Owner-Terminal-Token $owner_terminal_token;\n': '',
        # $http_cookie keeps only the first of multiple Cookie fields. Forward the
        # original fields so the API can reject conflicting Access cookies.
        '        proxy_set_header Cookie $http_cookie;\n': '',
    }
    for before, after in changes.items():
        if before not in server:
            raise ValueError(f'tunnel template changed: {before}')
        server = server.replace(before, after)
    for location in ('/_helena_lan', '/_plan_auth', '/_owner_terminal_auth'):
        anchor = f'    location = {location} {{\n        internal;\n'
        if server.count(anchor) != 1:
            raise ValueError(f'auth subrequest {location} changed')
        server = server.replace(anchor, anchor + '        proxy_cache off;\n', 1)
    # Access callbacks must use the public edge even though this hostname resolves to LAN.
    # Unknown /cdn-cgi/access paths are deliberately refused until individually reviewed.
    access = '''    location ~ ^/cdn-cgi/access/(login|authorized|logout)$ {
        auth_request off;
        proxy_cache off;
        access_log off;
        error_log /dev/null crit;
        proxy_pass https://$helena_public_host$request_uri;
        proxy_ssl_server_name on;
        proxy_ssl_name helena.volition.one;
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
        proxy_ssl_verify_depth 3;
        proxy_connect_timeout 3s;
        proxy_read_timeout 5s;
        proxy_set_header Host helena.volition.one;
        proxy_set_header Cookie $http_cookie;
        proxy_set_header Authorization "";
        proxy_set_header X-Helena-Entry "";
        proxy_set_header X-Helena-Edge-Entry "";
        proxy_set_header X-Helena-Edge-Email "";
        proxy_set_header Cf-Access-Jwt-Assertion "";
        proxy_set_header Cf-Access-Authenticated-User-Email "";
        proxy_set_header Cf-Access-Authenticated-User-Id "";
        proxy_set_header Cf-Access-Client-Id "";
        proxy_set_header Cf-Access-Client-Secret "";
        proxy_set_header Cf-Connecting-IP "";
        proxy_set_header True-Client-IP "";
        proxy_set_header CF-Ray "";
        proxy_set_header CF-IPCountry "";
        proxy_set_header X-Volition-Local-Access "";
        proxy_set_header X-Volition-Agent-Project "";
        proxy_set_header X-Volition-Agent-Unit "";
        proxy_set_header X-Owner-Terminal-Token "";
        proxy_set_header X-Forwarded-For "";
        proxy_set_header X-Real-IP "";
        proxy_set_header X-Forwarded-Host "";
        proxy_set_header X-Forwarded-Proto "";
        proxy_set_header X-Forwarded-Port "";
        proxy_set_header X-Forwarded-Prefix "";
        proxy_set_header X-Forwarded-User "";
        proxy_set_header X-Forwarded-Email "";
        proxy_set_header X-Forwarded-Client-Cert "";
        proxy_set_header X-Original-URI "";
        proxy_set_header X-Rewrite-URL "";
        proxy_set_header Forwarded "";
    }
    location /cdn-cgi/access/ { return 404; }
    location @helena_lan_login {
        internal;
        auth_request off;
        if ($http_sec_fetch_mode = navigate) {
            return 302 /cdn-cgi/access/login?redirect_url=%2F;
        }
        return 403;
    }
'''
    server = server.replace('    server_name helena.volition.one;\n',
                            '    server_name helena.volition.one;\n'
                            '    set $helena_public_host helena.volition.one;\n' + access, 1)
    if '    location / {\n' not in server:
        raise ValueError('tunnel web location missing')
    server = server.replace('    location / {\n',
                            '    location / {\n'
                            '        error_page 403 = @helena_lan_login;\n', 1)
    return ('''# Direct LAN TLS entry. Every application path uses the local and public Access gate.
# The assertion map is volatile: tool requests must not inherit a subrequest's token.
map "$server_name:$proxy_host" $helena_lan_assertion {
    volatile;
    default "";
    "helena.volition.one:127.0.0.1:3000" $cookie_CF_Authorization;
    "helena.volition.one:127.0.0.1:3001" $cookie_CF_Authorization;
}
map $proxy_host $helena_lan_prefix {
    volatile;
    default "";
    "127.0.0.1:6082" /browser;
    "127.0.0.1:8443" /code;
    "127.0.0.1:8444" /terminal;
}
''' + server)


def redirect_legacy(site: str) -> str:
    if 'listen 443 ssl default_server;' not in site or \
            'if ($helena_lan_https_redirect)' not in site:
        raise ValueError('legacy LAN site must have the existing HTTPS and HTTP redirect')
    if 'return 308 https://helena.volition.one$request_uri;' in site:
        return site
    match = re.search(r'^    server_name [^;]+;\n', site, re.MULTILINE)
    if not match:
        raise ValueError('legacy server_name missing')
    line = match.group().replace(' helena.volition.one', '')
    return site[:match.start()] + line + \
        '    if ($server_port = 443) { return 308 https://helena.volition.one$request_uri; }\n' + \
        site[match.end():]


def extend_entry_map(text: str, address: str) -> str:
    key = f'{address}:443:{WEB}'
    match = re.search(r'"127\.0\.0\.1:[0-9]+:127\.0\.0\.1:3001" "([0-9a-f]{64})";', text)
    if not match or not text.rstrip().endswith('}'):
        raise ValueError('existing tunnel entry proof map not recognised')
    existing = re.findall(r'"([0-9.]+):443:127\.0\.0\.1:3001" "([0-9a-f]{64})";', text)
    if existing:
        if existing != [(address, match.group(1))]:
            raise ValueError('an inconsistent LAN proof key already exists')
        return text
    return text.rstrip()[:-1] + f'    "{key}" "{match.group(1)}";\n}}\n'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--address', default='192.168.2.58')
    parser.add_argument('--site', type=pathlib.Path, default=SITE)
    parser.add_argument('--legacy', type=pathlib.Path, default=LEGACY)
    parser.add_argument('--entry-map', type=pathlib.Path, default=ENTRY_MAP)
    parser.add_argument('--snippet', type=pathlib.Path, default=SNIPPET)
    parser.add_argument('--enabled', type=pathlib.Path, default=ENABLED)
    args = parser.parse_args()
    address = ipaddress.ip_address(args.address)
    if address.version != 4 or not address.is_private:
        parser.error('--address must be a private IPv4 LAN address')
    certs = pathlib.Path(f'/etc/letsencrypt/live/{HOST}')
    rendered = render(TUNNEL.read_text(), certs, args.snippet)
    legacy = redirect_legacy(args.legacy.read_text())
    # Do not read or print the entry proof in dry mode.
    print(f'lan_strict.py: prepare {args.site}, {args.snippet}, legacy 443 redirect, '
          f'entry proof map for {address}:443')
    if not args.apply:
        print('lan_strict.py: dry run; no files changed')
        return 0
    if not (certs / 'fullchain.pem').is_file() or not (certs / 'privkey.pem').is_file():
        raise SystemExit('lan_strict.py: canonical TLS certificate is missing')
    if (args.enabled.exists() or args.enabled.is_symlink()) and \
            args.enabled.resolve() != args.site.resolve():
        raise SystemExit('lan_strict.py: enabled path points to a different site')
    entry_map = extend_entry_map(args.entry_map.read_text(), str(address))
    changes = {args.site: rendered, args.legacy: legacy,
               args.entry_map: entry_map, args.snippet: HEADERS.read_text()}
    backup = BACKUPS / f'lan-strict-{time.strftime("%Y%m%d-%H%M%S")}-{time.time_ns()}'
    backup.mkdir(parents=True, mode=0o700)
    old = {}
    enabled_before = args.enabled.is_symlink()
    try:
        for path, contents in changes.items():
            old[path] = path.read_bytes() if path.exists() else None
            if old[path] is not None:
                shutil.copy2(path, backup / path.name)
            path.write_text(contents)
            path.chmod(0o600 if path == args.entry_map else 0o644)
        if not enabled_before:
            args.enabled.symlink_to(args.site)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    except Exception:
        if not enabled_before:
            args.enabled.unlink(missing_ok=True)
        for path, content in old.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(content)
        subprocess.run(['nginx', '-t'], check=False)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=False)
        raise
    print(f'lan_strict.py: installed; backup {backup}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
