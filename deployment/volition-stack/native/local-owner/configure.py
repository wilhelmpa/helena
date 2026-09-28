#!/usr/bin/env python3
"""Enable explicit single-user access at the Kingston LAN entry point."""
import os
import json
import pwd
import pathlib
import re
import secrets
import subprocess
import sys

USAGE = 'Usage: sudo python3 configure.py [--personal | --single-user] [--rotate] [--https-host HOST | --lan-http] [owner@example.com]'
HERE = pathlib.Path(__file__).resolve().parent
# The home network's IPv6 prefixes and this machine's own addresses, kept current by
# helena-lan6-sync (hardening/files): included in the geo below, never written here.
OWNER_NETWORKS = pathlib.Path('/etc/nginx/helena-owner-networks.conf')
NETWORKS_SYNC = HERE.parent / 'hardening/files/helena-lan6-sync'


def owner_map(host_name: str, lan_port: str, token: str, networks: str = str(OWNER_NETWORKS)) -> str:
    """The owner map (/etc/nginx/conf.d/volition-local-owner.conf).

    The home network signs in without a password. Loopback is left out on purpose, because the
    Cloudflare tunnel reaches nginx from there; link-local too, because a process on this
    machine can bind its own fe80:: address (docs/helena-decisions/security-hardening.md H-01).
    IPv4 is the home /24; IPv6 comes from the included file: the /64s this machine has on its
    LAN interface, and every address of the machine itself as 0 (the most specific entry wins
    in a geo), so no local process is the owner from any of its addresses.

    Natively, this machine's own LAN address is inside that network too, so a connection from
    the machine itself (source address == the address it connects to) never counts as the
    owner, whatever Host it sends; helena-local-owner-guard.conf adds that the request must have
    reached nginx on a LAN-facing address, and the hardening firewall refuses local connections
    to nginx from a non-loopback source (IPv4 and IPv6). The kiosk on the machine's own screens
    reaches nginx on 127.0.0.1:8088 instead, which nftables lets only the kiosk user reach
    (kiosk/helena-kiosk.nft, installed by kiosk/install.sh).
    """
    return (
        'geo $volition_local_owner_source {\n    default 0;\n'
        '    192.168.2.0/24 1;\n'
        f'    include {networks};\n}}\n'
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


def kiosk_guard_loaded(ruleset: dict, uid: int) -> bool:
    items = ruleset.get('nftables', [])
    chains = [item['chain'] for item in items if 'chain' in item]
    if not any(c.get('name') == 'filter_output' and c.get('table') == 'helena_kiosk'
               and c.get('family') == 'inet' and c.get('type') == 'filter'
               and c.get('hook') == 'output' and c.get('prio') == 0 for c in chains):
        return False
    rules = [item['rule'] for item in items if 'rule' in item
             and item['rule'].get('chain') == 'filter_output'
             and item['rule'].get('table') == 'helena_kiosk'
             and item['rule'].get('family') == 'inet']
    expected = [
        {'match': {'op': '==', 'left': {'payload': {'protocol': 'ip', 'field': 'daddr'}}, 'right': '127.0.0.1'}},
        {'match': {'op': '==', 'left': {'payload': {'protocol': 'tcp', 'field': 'dport'}}, 'right': 8088}},
        {'match': {'op': '!=', 'left': {'meta': {'key': 'skuid'}}, 'right': uid}},
        {'reject': {'type': 'tcp reset'}},
    ]
    return len(rules) == 1 and rules[0].get('expr') == expected


def require_kiosk_guard() -> None:
    try:
        uid = pwd.getpwnam('plan-kiosk').pw_uid
        result = subprocess.run(['nft', '-j', 'list', 'table', 'inet', 'helena_kiosk'],
                                capture_output=True, text=True, check=True)
        if kiosk_guard_loaded(json.loads(result.stdout), uid):
            return
    except (KeyError, OSError, ValueError, subprocess.CalledProcessError):
        pass
    raise SystemExit('Local owner listener refused: load kiosk/helena-kiosk.nft first')


def ensure_networks() -> None:
    """The include must exist before nginx reads the map: written by the sync (no reload
    here; this script reloads nginx at the end), or an empty placeholder if it cannot run."""
    if OWNER_NETWORKS.exists():
        return
    result = subprocess.run([sys.executable, '-I', str(NETWORKS_SYNC), '--nginx-only', '--no-reload'],
                            check=False)
    if result.returncode != 0 or not OWNER_NETWORKS.exists():
        OWNER_NETWORKS.write_text('# Helena: filled by helena-lan6-sync (hardening); IPv4 only until then.\n')
    OWNER_NETWORKS.chmod(0o644)


def write_if_changed(path: pathlib.Path, text: str, mode: int) -> bool:
    if path.exists() and path.read_text() == text:
        path.chmod(mode)
        return False
    path.write_text(text)
    path.chmod(mode)
    return True


def main(args: list[str]) -> None:
    if '--personal' in args and '--single-user' in args:
        raise SystemExit(USAGE)
    mode = 'single-user' if '--single-user' in args else 'personal'
    args = [arg for arg in args if arg not in ('--personal', '--single-user')]
    # --rotate replaces the capability with a new one (e.g. after it was shown somewhere).
    rotate = '--rotate' in args
    args = [arg for arg in args if arg != '--rotate']
    # --https-host: the name the LAN reaches Helena on over HTTPS (cloudflare/lan_https.py; the
    # home network's own, helena-home.volition.one); the sign-in then happens there, on port
    # 443, and the origin becomes https://HOST.
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
    if mode == 'single-user':
        require_kiosk_guard()
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
    # The API and the web read this file at start: they restart only when it changed.
    restart = write_if_changed(config, (
        f'HELENA_LOCAL_SIGN_IN_MODE={mode}\n'
        f'LOCAL_SINGLE_USER_EMAIL={email}\nLOCAL_SINGLE_USER_TOKEN={token}\n'
        f'LOCAL_SINGLE_USER_ORIGIN={origin}\n'
        'LOCAL_SINGLE_USER_API_URL=http://127.0.0.1:3000/api/auth/sign-in/local-owner\n'
    ), 0o600)
    lan_port = '443' if origin.startswith('https://') else '80'
    ensure_networks()
    nginx_map = pathlib.Path('/etc/nginx/conf.d/volition-local-owner.conf')
    write_if_changed(nginx_map, owner_map(host_name, lan_port, token if mode == 'single-user' else ''), 0o600)
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
    write_if_changed(guard, (HERE.parent / 'hardening/files/helena-local-owner-guard.conf').read_text(), 0o644)
    text = text.replace('X-Volition-Local-Access $volition_local_owner_token;',
                        'X-Volition-Local-Access $helena_owner_capability;')
    for location, value in [('location /backend/ {', '""'), ('location / {', '$helena_owner_capability')]:
        marker = f'        proxy_set_header X-Volition-Local-Access {value};'
        if marker not in text:
            if text.count(location) != 1:
                raise SystemExit(f'Expected one {location}')
            text = text.replace(location, location + '\n' + marker)
    if site.read_text() != text:
        site.write_text(text)
    dropins = False
    for service in ['volition-plan-api', 'volition-plan-web']:
        dropin = pathlib.Path(f'/etc/systemd/system/{service}.service.d/50-local-owner.conf')
        dropin.parent.mkdir(parents=True, exist_ok=True)
        dropins |= write_if_changed(dropin, '[Service]\nEnvironmentFile=/etc/volition/local-owner.env\n', 0o644)
    subprocess.run(['nginx', '-t'], check=True)
    if dropins:
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
    if restart or dropins:
        subprocess.run(['systemctl', 'restart', 'volition-plan-api', 'volition-plan-web'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    print('Local sign-in mode: ' + mode
          + (' with a new capability' if rotate else '')
          + ('' if restart or dropins else ' (API and web unchanged, not restarted)')
          + '; capability not printed.')


if __name__ == '__main__':
    main(sys.argv[1:])
