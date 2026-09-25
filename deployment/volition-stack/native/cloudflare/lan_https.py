#!/usr/bin/env python3
"""HTTPS for the home network: the LAN site of nginx answers https://helena-home.volition.one
directly (the certificate from tls-setup.sh), so a device at home reaches Helena at LAN speed
and with a secure context, while the internet keeps coming through the tunnel entry
(127.0.0.1:8090, untouched here). Dry run by default: it prints the diff. With --apply it
writes, runs nginx -t, reloads, and puts the old files back when nginx refuses the new ones.
Idempotent. No secret is read: the site file has none (the owner capability lives in
conf.d/volition-local-owner.conf, which this script never opens).

  sudo python3 lan_https.py [--apply] [--host helena-home.volition.one]
                            [--site /etc/nginx/sites-available/volition.conf]
  sudo python3 lan_https.py --apply --rollback

What changes on the LAN site:
  - listens on 443 (IPv4 and IPv6) with the certificate, HTTP/2, Mozilla "intermediate" TLS;
  - plain http on a LAN-facing address answers 301 to https://HOST (loopback and the kiosk's
    127.0.0.1:8088 stay as they are: local processes and the kiosk keep their http);
  - HSTS on every https answer that does not bring its own (the web app sends one);
  - HOST is an allowed origin of the embedded tools and their websockets (CSP);
  - the tunnel entry's proof header (X-Helena-Edge-Entry) is blanked, so nothing a LAN client
    sends under that name reaches the web app or the API.

The LAN owner sign-in on the new name comes from local-owner/configure.py --https-host HOST
(it holds the capability; this script never touches it).
docs/helena-decisions/security-hardening.md §5 and §6.10."""
import argparse
import difflib
import pathlib
import shutil
import subprocess
import sys
import time

TLS_SNIPPET = pathlib.Path('/etc/nginx/snippets/helena-tls.conf')
MAPS = pathlib.Path('/etc/nginx/conf.d/helena-lan-https.conf')
# The separate port-80 redirect site of the first version of this script (never live).
OLD_REDIRECT_SITE = pathlib.Path('/etc/nginx/sites-available/helena-https-redirect.conf')
OLD_REDIRECT_LINK = pathlib.Path('/etc/nginx/sites-enabled/helena-https-redirect.conf')
BACKUPS = pathlib.Path('/var/lib/helena/hardening/backup')
LETSENCRYPT = pathlib.Path('/etc/letsencrypt/live')
DEFAULT_HOST = 'helena-home.volition.one'

TLS = """# Helena: TLS for the LAN entry (Mozilla "intermediate"; cloudflare/lan_https.py).
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ecdh_curve X25519:prime256v1:secp384r1;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:helena_tls:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
"""

HSTS = 'max-age=63072000; includeSubDomains'

MAPS_TEXT = f"""# Helena: HTTPS for the home network (cloudflare/lan_https.py). No secret in this file.
#
# Plain http that reached nginx on a LAN-facing address goes to https. Loopback is left alone:
# local processes and the kiosk (127.0.0.1:8088) keep their http, and the tunnel entry has
# its own server block.
map "$server_port:$server_addr" $helena_lan_https_redirect {{
    default          0;
    "~^80:127\\."     0;
    "~^80:::1$"      0;
    "~^80:::ffff:127\\." 0;
    "~^80:"          1;
}}
# HSTS on every https answer that does not bring its own (the web app sends one on its pages;
# the api, the tools and nginx's own answers get it here).
map "$https:$upstream_http_strict_transport_security" $helena_lan_hsts {{
    default          "";
    "on:"            "{HSTS}";
}}
"""


def cert_dir(host: str) -> pathlib.Path:
    return LETSENCRYPT / host


def edit(text: str, host: str, certs: pathlib.Path | None = None) -> str:
    """The LAN site with HTTPS for host. Every anchor must appear exactly as expected."""
    certs = certs or cert_dir(host)

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
    once('    server_name kingston-server.local kingston-server;\n',
         f'    server_name kingston-server.local kingston-server {host};\n',
         f'server_name kingston-server.local kingston-server {host};')
    once('    listen [::]:80 default_server;\n',
         '    listen [::]:80 default_server;\n'
         '    listen 443 ssl default_server;\n'
         '    listen [::]:443 ssl default_server;\n'
         '    http2 on;\n'
         f'    ssl_certificate {certs}/fullchain.pem;\n'
         f'    ssl_certificate_key {certs}/privkey.pem;\n'
         f'    include {TLS_SNIPPET};\n'
         '    add_header Strict-Transport-Security $helena_lan_hsts always;\n'
         f'    if ($helena_lan_https_redirect) {{ return 301 https://{host}$request_uri; }}\n',
         'listen 443 ssl default_server;')
    # The embedded terminals' own policy names the websocket origins.
    csp_old = "connect-src 'self' ws://kingston-server.local ws://kingston-server\""
    csp_new = f"connect-src 'self' ws://kingston-server.local ws://kingston-server wss://{host}\""
    if csp_new not in text:
        text = text.replace(csp_old, csp_new)
    # Only the tunnel entry may send its proof; from the LAN the header is blanked. Checked
    # within each block, since local-owner/configure.py adds its own line at the same place.
    blank = '        proxy_set_header X-Helena-Edge-Entry "";\n'
    for location in ('    location /backend/ {\n', '    location / {\n'):
        if text.count(location) != 1:
            raise SystemExit(f'lan_https.py: expected exactly one {location.strip()!r} in the site')
        start = text.index(location) + len(location)
        end = text.find('\n    }', start)
        if blank not in text[start:end if end >= 0 else len(text)]:
            text = text[:start] + blank + text[start:]
    return text


def restore(backup: pathlib.Path, site: pathlib.Path) -> None:
    shutil.copy2(backup / site.name, site)
    for path in (MAPS, TLS_SNIPPET):
        saved = backup / path.name
        if saved.exists():
            shutil.copy2(saved, path)
        else:
            path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rollback', action='store_true')
    parser.add_argument('--host', default=DEFAULT_HOST)
    parser.add_argument('--site', default='/etc/nginx/sites-available/volition.conf')
    args = parser.parse_args()
    site = pathlib.Path(args.site)
    if not args.host or not all(c.isalnum() or c in '.-' for c in args.host) or '.' not in args.host:
        raise SystemExit('lan_https.py: invalid host')

    if args.rollback:
        kept = sorted(BACKUPS.glob('lan-https-*/' + site.name))
        if not kept:
            raise SystemExit('lan_https.py: no backup to roll back to')
        print(f'lan_https.py: restoring {site} from {kept[-1]} (HTTPS on the LAN off)')
        if args.apply:
            restore(kept[-1].parent, site)
            MAPS.unlink(missing_ok=True)
            OLD_REDIRECT_LINK.unlink(missing_ok=True)
            subprocess.run(['nginx', '-t'], check=True)
            subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        return 0

    before = site.read_text()
    certs = cert_dir(args.host)
    after = edit(before, args.host, certs)
    sys.stdout.writelines(difflib.unified_diff(
        before.splitlines(True), after.splitlines(True), str(site), str(site) + ' (new)'))
    for path, text in ((MAPS, MAPS_TEXT), (TLS_SNIPPET, TLS)):
        if not path.exists() or path.read_text() != text:
            print(f'lan_https.py: {"new" if not path.exists() else "changed"} {path}')
    if not args.apply:
        print('lan_https.py: dry run; add --apply to write')
        return 0
    if not (certs / 'fullchain.pem').exists():
        raise SystemExit(f'lan_https.py: no certificate in {certs} (tls-setup.sh issue first)')
    backup = BACKUPS / f'lan-https-{time.strftime("%Y%m%d-%H%M%S")}'
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(site, backup / site.name)
    for path in (MAPS, TLS_SNIPPET):
        if path.exists():
            shutil.copy2(path, backup / path.name)
    MAPS.write_text(MAPS_TEXT)
    MAPS.chmod(0o644)
    TLS_SNIPPET.write_text(TLS)
    TLS_SNIPPET.chmod(0o644)
    OLD_REDIRECT_LINK.unlink(missing_ok=True)
    site.write_text(after)
    if subprocess.run(['nginx', '-t']).returncode != 0:
        restore(backup, site)
        raise SystemExit('lan_https.py: nginx refused the change; the old files are back')
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    if OLD_REDIRECT_SITE.exists():
        OLD_REDIRECT_SITE.unlink()
    print(f'lan_https.py: https://{args.host} served on the LAN (backup {backup})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
