#!/usr/bin/env python3
"""Enable explicit single-user access at the Kingston LAN entry point."""
import os
import pathlib
import secrets
import subprocess
import sys

if os.geteuid() != 0 or len(sys.argv) != 2 or '@' not in sys.argv[1]:
    raise SystemExit('Usage: sudo python3 configure.py owner@example.com')
os.umask(0o077)
email = sys.argv[1]
if any(c in email for c in '\n\r\"\'\\ '):
    raise SystemExit('Invalid owner email')
config = pathlib.Path('/etc/volition/local-owner.env')
values = dict(line.split('=', 1) for line in config.read_text().splitlines() if '=' in line) if config.exists() else {}
token = values.get('LOCAL_SINGLE_USER_TOKEN', secrets.token_hex(32))
if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
    raise SystemExit('Invalid existing capability')
config.write_text(
    f'LOCAL_SINGLE_USER_EMAIL={email}\nLOCAL_SINGLE_USER_TOKEN={token}\n'
    'LOCAL_SINGLE_USER_ORIGIN=http://kingston-server.local\n'
    'LOCAL_SINGLE_USER_API_URL=http://127.0.0.1:3000/api/auth/sign-in/local-owner\n'
)
config.chmod(0o600)
nginx_map = pathlib.Path('/etc/nginx/conf.d/volition-local-owner.conf')
# The home network signs in without a password: the relay on the nspawn host
# (192.168.122.1) and, when Kingston boots natively, the LAN itself. Loopback is left out
# on purpose, because the Cloudflare tunnel reaches nginx from there.
nginx_map.write_text(
    'geo $volition_local_owner_source {\n    default 0;\n'
    '    192.168.122.1/32 1;\n    192.168.2.0/24 1;\n    fe80::/10 1;\n}\n'
    'map "$host:$volition_local_owner_source" $volition_local_owner_token {\n'
    f'    default "";\n    "kingston-server.local:1" "{token}";\n}}\n'
)
nginx_map.chmod(0o600)
site = pathlib.Path('/etc/nginx/sites-available/volition.conf')
if not site.exists():
    site = pathlib.Path('/etc/nginx/sites-enabled/volition.conf').resolve()
text = site.read_text()
for location, value in [('location /backend/ {', '""'), ('location / {', '$volition_local_owner_token')]:
    marker = f'        proxy_set_header X-Volition-Local-Access {value};'
    if marker not in text:
        if text.count(location) != 1:
            raise SystemExit(f'Expected one {location}')
        text = text.replace(location, location + '\n' + marker)
site.write_text(text)
for service in ['volition-plan-api', 'volition-plan-web']:
    dropin = pathlib.Path(f'/etc/systemd/system/{service}.service.d/50-local-owner.conf')
    dropin.parent.mkdir(parents=True, exist_ok=True)
    dropin.write_text('[Service]\nEnvironmentFile=/etc/volition/local-owner.env\n')
subprocess.run(['nginx', '-t'], check=True)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'restart', 'volition-plan-api', 'volition-plan-web'], check=True)
subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
print('Local single-user mode enabled for the existing owner; capability not printed.')
