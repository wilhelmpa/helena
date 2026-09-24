#!/usr/bin/env python3
"""Adds HTTPS under the public name to the LAN site of nginx (helena.volition.one on the
home network, with the Let's Encrypt certificate from tls-setup.sh). Dry run by default: it
prints the diff. With --apply it writes, runs nginx -t, reloads, and puts the old file back
when nginx refuses the new one. Idempotent. No secret is read: the site file has none.

  sudo python3 lan_https.py [--apply] [--host helena.volition.one]
                            [--site /etc/nginx/sites-available/volition.conf]
  sudo python3 lan_https.py --apply --rollback

docs/helena-decisions/security-hardening.md §5. The LAN owner sign-in on the new name comes
from local-owner/configure.py --https-host (it holds the capability; this script never
touches it)."""
import argparse
import difflib
import pathlib
import shutil
import subprocess
import sys
import time

TLS_SNIPPET = pathlib.Path('/etc/nginx/snippets/helena-tls.conf')
REDIRECT_SITE = pathlib.Path('/etc/nginx/sites-available/helena-https-redirect.conf')
REDIRECT_LINK = pathlib.Path('/etc/nginx/sites-enabled/helena-https-redirect.conf')
BACKUPS = pathlib.Path('/var/lib/helena/hardening/backup')

TLS = """# Helena: TLS for the LAN entry (Mozilla "intermediate"). HSTS comes from the web app.
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ecdh_curve X25519:prime256v1:secp384r1;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:helena_tls:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
"""


def redirect(host: str) -> str:
    return (
        "# Helena: plain http under the public name goes to https (lan_https.py).\n"
        "server {\n    listen 80;\n    listen [::]:80;\n"
        f"    server_name {host};\n"
        "    return 301 https://$host$request_uri;\n}\n"
    )


def edit(text: str, host: str) -> str:
    """The LAN site with HTTPS for host. Every anchor must appear exactly as expected."""
    cert = f'/etc/helena/tls/lego/certificates/{host}'

    def once(old: str, new: str, done: str) -> None:
        nonlocal text
        if done in text:
            return
        if text.count(old) != 1:
            raise SystemExit(f'lan_https.py: expected exactly one {old.strip()!r} in the site')
        text = text.replace(old, new)

    once('    "http://kingston-server" 1;\n',
         f'    "http://kingston-server" 1;\n    "https://{host}" 1;\n',
         f'"https://{host}" 1;')
    once('    listen [::]:80 default_server;\n',
         '    listen [::]:80 default_server;\n'
         '    listen 443 ssl default_server;\n'
         '    listen [::]:443 ssl default_server;\n'
         f'    ssl_certificate {cert}.crt;\n'
         f'    ssl_certificate_key {cert}.key;\n'
         f'    include {TLS_SNIPPET};\n',
         'listen 443 ssl default_server;')
    once('    server_name kingston-server.local kingston-server;\n',
         f'    server_name kingston-server.local kingston-server {host};\n',
         f'server_name kingston-server.local kingston-server {host};')
    csp_old = "connect-src 'self' ws://kingston-server.local ws://kingston-server\""
    csp_new = f"connect-src 'self' ws://kingston-server.local ws://kingston-server wss://{host}\""
    if csp_new not in text:
        text = text.replace(csp_old, csp_new)
    return text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rollback', action='store_true')
    parser.add_argument('--host', default='helena.volition.one')
    parser.add_argument('--site', default='/etc/nginx/sites-available/volition.conf')
    args = parser.parse_args()
    site = pathlib.Path(args.site)
    if not all(c.isalnum() or c in '.-' for c in args.host):
        raise SystemExit('lan_https.py: invalid host')

    if args.rollback:
        kept = sorted(BACKUPS.glob('lan-https-*/' + site.name))
        if not kept:
            raise SystemExit('lan_https.py: no backup to roll back to')
        print(f'lan_https.py: restoring {site} from {kept[-1]}')
        if args.apply:
            shutil.copy2(kept[-1], site)
            REDIRECT_LINK.unlink(missing_ok=True)
            subprocess.run(['nginx', '-t'], check=True)
            subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        return 0

    before = site.read_text()
    after = edit(before, args.host)
    cert = pathlib.Path(f'/etc/helena/tls/lego/certificates/{args.host}.crt')
    sys.stdout.writelines(difflib.unified_diff(
        before.splitlines(True), after.splitlines(True), str(site), str(site) + ' (new)'))
    if not args.apply:
        print('lan_https.py: dry run; add --apply to write')
        return 0
    if not cert.exists():
        raise SystemExit(f'lan_https.py: no certificate at {cert} (tls-setup.sh issue first)')
    backup = BACKUPS / f'lan-https-{time.strftime("%Y%m%d-%H%M%S")}'
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(site, backup / site.name)
    TLS_SNIPPET.write_text(TLS)
    REDIRECT_SITE.write_text(redirect(args.host))
    REDIRECT_LINK.unlink(missing_ok=True)
    REDIRECT_LINK.symlink_to(REDIRECT_SITE)
    site.write_text(after)
    if subprocess.run(['nginx', '-t']).returncode != 0:
        shutil.copy2(backup / site.name, site)
        REDIRECT_LINK.unlink(missing_ok=True)
        raise SystemExit('lan_https.py: nginx refused the change; the old site is back')
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    print(f'lan_https.py: https://{args.host} served on the LAN (backup {backup})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
