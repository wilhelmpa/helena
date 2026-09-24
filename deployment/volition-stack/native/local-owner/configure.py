#!/usr/bin/env python3
"""Enable explicit single-user access at the Kingston LAN entry point."""
import os
import pathlib
import re
import secrets
import subprocess
import sys

USAGE = 'Usage: sudo python3 configure.py [--rotate] [--https-host HOST | --lan-http] [owner@example.com]'
args = sys.argv[1:]
# --rotate replaces the capability with a new one (e.g. after it was shown somewhere).
rotate = '--rotate' in args
args = [arg for arg in args if arg != '--rotate']
# --https-host: the public name the LAN also reaches over HTTPS (cloudflare/lan_https.py);
# the sign-in then happens there, on port 443, and the origin becomes https://HOST.
https_host = ''
# --lan-http: back to http://kingston-server.local (the rollback of --https-host).
lan_http = '--lan-http' in args
args = [arg for arg in args if arg != '--lan-http']
if '--https-host' in args:
    at = args.index('--https-host')
    if at + 1 >= len(args):
        raise SystemExit(USAGE)
    https_host = args[at + 1]
    del args[at:at + 2]
    if not https_host or any(not (c.isalnum() or c in '.-') for c in https_host):
        raise SystemExit('Invalid --https-host')
if os.geteuid() != 0 or len(args) > 1:
    raise SystemExit(USAGE)
os.umask(0o077)
config = pathlib.Path('/etc/volition/local-owner.env')
values = dict(line.split('=', 1) for line in config.read_text().splitlines() if '=' in line) if config.exists() else {}
# Without an address the configured owner stays, so a rotation never needs it typed again.
email = args[0] if args else values.get('LOCAL_SINGLE_USER_EMAIL', '')
if '@' not in email:
    raise SystemExit(USAGE)
if any(c in email for c in '\n\r\"\'\\ '):
    raise SystemExit('Invalid owner email')
token = secrets.token_hex(32) if rotate else values.get('LOCAL_SINGLE_USER_TOKEN', secrets.token_hex(32))
if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
    raise SystemExit('Invalid existing capability')
# Without --https-host a re-run keeps the origin it had (a rotation must not undo HTTPS).
origin = (f'https://{https_host}' if https_host
          else 'http://kingston-server.local' if lan_http
          else values.get('LOCAL_SINGLE_USER_ORIGIN', 'http://kingston-server.local'))
host_name = origin.split('://', 1)[1]
config.write_text(
    f'LOCAL_SINGLE_USER_EMAIL={email}\nLOCAL_SINGLE_USER_TOKEN={token}\n'
    f'LOCAL_SINGLE_USER_ORIGIN={origin}\n'
    'LOCAL_SINGLE_USER_API_URL=http://127.0.0.1:3000/api/auth/sign-in/local-owner\n'
)
config.chmod(0o600)
nginx_map = pathlib.Path('/etc/nginx/conf.d/volition-local-owner.conf')
# The home network signs in without a password. Loopback is left out on purpose, because the
# Cloudflare tunnel reaches nginx from there; link-local too, because a process on this
# machine can bind its own fe80:: address (docs/helena-decisions/security-hardening.md H-01).
#
# Natively, this machine's own LAN address is inside that network too, so a connection from
# the machine itself (source address == the address it connects to) never counts as the
# owner, whatever Host it sends; helena-local-owner-guard.conf (written below) adds that the
# request must have reached nginx on a LAN-facing address, and the hardening firewall refuses
# local connections to nginx from a non-loopback source. The kiosk on the machine's own
# screens reaches nginx on 127.0.0.1:8088 instead, which nftables lets only the kiosk user
# reach (kiosk/helena-kiosk.nft, installed by kiosk/install.sh).
lan_port = '443' if origin.startswith('https://') else '80'
nginx_map.write_text(
    'geo $volition_local_owner_source {\n    default 0;\n'
    '    192.168.2.0/24 1;\n}\n'
    'map "$remote_addr|$server_addr" $volition_local_self {\n'
    '    default 0;\n    "~^([^|]+)\\|\\1$" 1;\n}\n'
    'map "$host:$volition_local_owner_source:$server_port:$volition_local_self" '
    '$volition_local_owner_token {\n'
    '    default "";\n'
    f'    "{host_name}:1:{lan_port}:0" "{token}";\n'
    # The kiosk keeps its LAN name on its own loopback listener as well as the public one.
    f'    "~^(kingston-server\\.local|{re.escape(host_name)}):[01]:8088:[01]$" "{token}";\n'
    '}\n'
)
nginx_map.chmod(0o600)
site = pathlib.Path('/etc/nginx/sites-available/volition.conf')
if not site.exists():
    site = pathlib.Path('/etc/nginx/sites-enabled/volition.conf').resolve()
text = site.read_text()
# The kiosk's own entry (see the map above), next to the LAN's port 80.
if 'listen 127.0.0.1:8088;' not in text:
    anchor = '    listen [::]:80 default_server;\n'
    if text.count(anchor) != 1:
        raise SystemExit('Expected one IPv6 listen on port 80')
    text = text.replace(anchor, anchor + '    listen 127.0.0.1:8088;\n')
guard = pathlib.Path('/etc/nginx/conf.d/helena-local-owner-guard.conf')
guard.write_text((pathlib.Path(__file__).resolve().parent.parent
                  / 'hardening/files/helena-local-owner-guard.conf').read_text())
guard.chmod(0o644)
text = text.replace('X-Volition-Local-Access $volition_local_owner_token;',
                    'X-Volition-Local-Access $helena_owner_capability;')
for location, value in [('location /backend/ {', '""'), ('location / {', '$helena_owner_capability')]:
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
print('Local single-user mode enabled for the existing owner'
      + (' with a new capability' if rotate else '') + '; capability not printed.')
