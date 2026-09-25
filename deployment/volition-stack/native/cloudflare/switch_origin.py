#!/usr/bin/env python3
"""Moves Helena to its public origin, https://<host> (helena.volition.one, through the tunnel),
and optionally a second one for the home network, https://<home> (helena-home.volition.one,
served by nginx on the LAN directly: cloudflare/lan_https.py). Dry run by default.

It changes only these keys of /etc/volition/plan.env and prints only their names and new
values (none is a secret); every other line of the file is copied through unread:
  APP_URL=https://<host>[,https://<home>]
                                    the web origins; the first is the primary one (links in
                                    mails, OAuth redirects), each is trusted for sign-in
  HELENA_HOME_URL=https://<home>    the home network's origin (the web app switches to it at
                                    home, the API checks its certificate); removed by --no-home
  API_URL=https://<host>/backend    same origin, so the session cookie is host-only (the web
                                    app calls /backend on whichever origin it was opened on)
  SSO_LOGOUT_URL=https://<host>/cdn-cgi/access/logout
                                    signing out on the public origin also ends the Cloudflare
                                    Access session (with the Access sign-in on, it would sign
                                    the owner straight back in otherwise)
  COOKIE_DOMAIN=host-only           never a cookie for all of volition.one (the company's
                                    other sites would receive the session)
  PASSKEY_RP_ID=<host>              passkeys bound to the public name
  SERVICE_URL_API=http://127.0.0.1:3000   the web server's own api calls stay on loopback
  any other value that starts with http://kingston-server.local → https://<host>
and it adds <host> (and <home>) to the terminals' allowed Host headers (systemd drop-ins).
The LAN owner sign-in's origin is local-owner/configure.py --https-host's job.

  sudo python3 switch_origin.py [--apply] [--host helena.volition.one]
                                [--home-host helena-home.volition.one | --no-home]
  sudo python3 switch_origin.py --apply --rollback

Without --home-host or --no-home a re-run keeps the home origin plan.env has.

Restart volition-plan-api, volition-plan-web, volition-terminal and volition-owner-terminal
afterwards (the runbook does it in the go-live window). docs/helena-decisions/security-hardening.md §6.
"""
from __future__ import annotations

import argparse
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time

ENV = pathlib.Path('/etc/volition/plan.env')
BACKUPS = pathlib.Path('/var/lib/helena/hardening/backup')
OLD_ORIGIN = 'http://kingston-server.local'
TERMINAL_UNITS = {
    'volition-terminal': 'TERMINAL_ALLOWED_HOSTS',
    'volition-owner-terminal': 'OWNER_TERMINAL_ALLOWED_HOSTS',
}
KEY = re.compile(r'^([A-Z][A-Z0-9_]*)=(.*)$')


def current_home(lines: list[str]) -> str:
    """The home host plan.env names now (HELENA_HOME_URL), or ''."""
    for line in lines:
        match = KEY.match(line.rstrip('\n'))
        if match and match.group(1) == 'HELENA_HOME_URL':
            value = match.group(2).strip('"\'')
            return value[len('https://'):].rstrip('/') if value.startswith('https://') else ''
    return ''


def rewrite(lines: list[str], host: str, home: str | None = None) -> tuple[list[str], list[str]]:
    """plan.env for the public origin https://host and, when home is a name, the home origin
    https://home. home=None keeps the home plan.env has; home='' removes it."""
    origin = f'https://{host}'
    if home is None:
        home = current_home(lines)
    if home == host:
        home = ''
    wanted = {
        'APP_URL': ','.join([origin] + ([f'https://{home}'] if home else [])),
        'API_URL': f'{origin}/backend',
        'COOKIE_DOMAIN': 'host-only',
        # Passkeys stay bound to the public name: the home name is another site for WebAuthn,
        # and at home the LAN sign-in needs none.
        'PASSKEY_RP_ID': host,
        # The web server's own calls to the api (media and file proxies) stay on loopback:
        # the public name leads through Cloudflare Access, which a server cannot pass.
        'SERVICE_URL_API': 'http://127.0.0.1:3000',
        'SSO_LOGOUT_URL': f'{origin}/cdn-cgi/access/logout',
    }
    if home:
        wanted['HELENA_HOME_URL'] = f'https://{home}'
    seen: set[str] = set()
    out: list[str] = []
    changes: list[str] = []
    for line in lines:
        match = KEY.match(line.rstrip('\n'))
        if not match:
            out.append(line)
            continue
        key, value = match.groups()
        if key == 'HELENA_HOME_URL' and not home:
            changes.append('HELENA_HOME_URL (removed)')
            continue
        new = None
        if key in wanted:
            seen.add(key)
            new = wanted[key]
        elif value.strip('"\'').startswith(OLD_ORIGIN):
            new = origin + value.strip('"\'')[len(OLD_ORIGIN):]
        if new is not None and new != value:
            out.append(f'{key}={new}\n')
            changes.append(f'{key}={new}')
        else:
            out.append(line)
    for key, value in wanted.items():
        if key not in seen:
            out.append(f'{key}={value}\n')
            changes.append(f'{key}={value} (added)')
    return out, changes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rollback', action='store_true')
    parser.add_argument('--host', default='helena.volition.one')
    parser.add_argument('--home-host', default=None)
    parser.add_argument('--no-home', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9.-]+', args.host):
        raise SystemExit('switch_origin.py: invalid host')
    if args.home_host is not None and not re.fullmatch(r'[a-z0-9.-]+\.[a-z0-9.-]+', args.home_host):
        raise SystemExit('switch_origin.py: invalid --home-host')
    home = '' if args.no_home else args.home_host

    if args.rollback:
        kept = sorted(BACKUPS.glob('origin-*/plan.env'))
        if not kept:
            raise SystemExit('switch_origin.py: no backup')
        print(f'switch_origin.py: restoring {ENV} from {kept[-1]} and removing the drop-ins')
        if args.apply:
            shutil.copy2(kept[-1], ENV)
            for unit in TERMINAL_UNITS:
                pathlib.Path(f'/etc/systemd/system/{unit}.service.d/70-helena-origin.conf').unlink(
                    missing_ok=True)
            subprocess.run(['systemctl', 'daemon-reload'], check=True)
        return 0

    lines = ENV.read_text().splitlines(True)
    new_lines, changes = rewrite(lines, args.host, home)
    hosts_wanted = [args.host] + ([h] if (h := current_home(new_lines)) else [])
    for change in changes:
        print(f'switch_origin.py: plan.env {change}')
    dropins = {}
    for unit, var in TERMINAL_UNITS.items():
        current = subprocess.run(['systemctl', 'show', '-p', 'Environment', '--value', unit],
                                 capture_output=True, text=True).stdout
        found = re.search(rf'{var}=(\S+)', current)
        hosts = found.group(1).split(',') if found else ['kingston-server.local', 'kingston-server']
        for wanted_host in hosts_wanted:
            if wanted_host not in hosts:
                hosts.append(wanted_host)
        dropins[unit] = f'[Service]\nEnvironment={var}={",".join(hosts)}\n'
        print(f'switch_origin.py: {unit}: {var}={",".join(hosts)}')
    if not args.apply:
        print('switch_origin.py: dry run; add --apply to write')
        return 0
    backup = BACKUPS / f'origin-{time.strftime("%Y%m%d-%H%M%S")}'
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(ENV, backup / 'plan.env')
    # Same owner, group and mode as before; created 0600 so it is never readable wider.
    stat = ENV.stat()
    tmp = ENV.with_name(ENV.name + '.new')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(''.join(new_lines))
    os.chown(tmp, stat.st_uid, stat.st_gid)
    os.chmod(tmp, stat.st_mode & 0o777)
    tmp.replace(ENV)
    for unit, text in dropins.items():
        path = pathlib.Path(f'/etc/systemd/system/{unit}.service.d/70-helena-origin.conf')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    print(f'switch_origin.py: done (backup {backup}); restart the API, web and both terminal units')
    return 0


if __name__ == '__main__':
    sys.exit(main())
