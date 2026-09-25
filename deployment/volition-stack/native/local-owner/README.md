# Kingston local single-user mode

Plan automatically creates a normal Better Auth session for the existing configured
owner when opening `http://kingston-server.local`. No password is stored for this.
Anyone with access to this LAN entry can use the owner's account, terminal, and tools.

This mode is disabled by default. The Kingston installer is explicitly enabled with:

```sh
sudo python3 deployment/volition-stack/native/local-owner/configure.py owner@example.com
```

To replace the capability (for example after it showed up in a log or a transcript), run
`sudo python3 deployment/volition-stack/native/local-owner/configure.py --rotate`; without an
address it keeps the configured owner.

On a native boot the machine's own LAN address is inside the home network too, so nginx never
treats a connection from the machine itself as the owner. The kiosk on its own screens reaches
nginx on `127.0.0.1:8088` instead, which nftables opens to the kiosk user alone
(`kiosk/helena-kiosk.nft`, installed by `kiosk/install.sh`).

The home network over IPv6 counts too: the geo includes `/etc/nginx/helena-owner-networks.conf`,
which `helena-lan6-sync` (hardening; NetworkManager dispatcher + 5-minute timer) keeps current:
the /64s this machine has on its LAN interface (never link-local or loopback; a ULA only when the
LAN interface has one) and every address of this machine itself as never the owner. A re-run of
this script keeps the include; it restarts the API and web only when their environment changed.
`hardening/apply.sh owner-lan6` installs the sync and adds the include once.

The desktop Caddy route must continue limiting this hostname to the home LAN.
Debian Nginx injects a random capability only for the exact hostname and the home LAN
(192.168.2.0/24 and the home IPv6 /64s), only on a LAN-facing listener and never from a link-local source
(`/etc/nginx/conf.d/helena-local-owner-guard.conf`); never from loopback, where the
Cloudflare tunnel arrives. With `--https-host helena.volition.one` the sign-in moves to
https on port 443 under that name (see `cloudflare/lan_https.py`). Incoming capability headers are overwritten;
external backend requests have the header stripped. The Next server and auth API
both verify it. Neither the capability nor a password is sent to the browser.
The API still validates normal sessions, including account deactivation.

The four `LOCAL_SINGLE_USER_*` variables are server-only. Nginx and systemd read
root-only configuration under `/etc`, excluded from Git. The public hostname does
not automatically sign in. Before adding any public tunnel that overrides the Host
header to `kingston-server.local`, disable this mode or use a separate authenticated
virtual host. A trusted local proxy must never carry untrusted traffic to this host.

To disable, remove both `50-local-owner.conf` systemd drop-ins, run `systemctl
daemon-reload`, and restart `volition-plan-api` and `volition-plan-web`.
Remove the Nginx capability directives/map and root-only environment file afterward.
Existing sessions remain ordinary valid sessions until signed out or revoked.
