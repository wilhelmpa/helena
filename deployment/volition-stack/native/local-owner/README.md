# Kingston local single-user mode

Plan automatically creates a normal Better Auth session for the existing configured
owner when opening `http://kingston-server.local`. No password is stored for this.
Anyone with access to this LAN entry can use the owner's account, terminal, and tools.

This mode is disabled by default. The Kingston installer is explicitly enabled with:

```sh
sudo python3 deployment/volition-stack/native/local-owner/configure.py owner@example.com
```

The desktop Caddy route must continue limiting this hostname to the home LAN.
Debian Nginx injects a random capability only for the exact hostname and the trusted
desktop gateway or loopback source. Incoming capability headers are overwritten;
external backend requests have the header stripped. The Next server and auth API
both verify it. Neither the capability nor a password is sent to the browser.
The API still validates normal sessions, including account deactivation.

The four `LOCAL_SINGLE_USER_*` variables are server-only. Nginx and systemd read
root-only configuration under `/etc`, excluded from Git. The public hostname does
not automatically sign in. Before adding any public tunnel that overrides the Host
header to `kingston-server.local`, disable this mode or use a separate authenticated
virtual host. A trusted local proxy must never carry untrusted traffic to this host.

To disable, remove both `50-local-owner.conf` systemd drop-ins, run `systemctl
daemon-reload`, and restart `volition-plan-api-dev` and `volition-plan-web-dev`.
Remove the Nginx capability directives/map and root-only environment file afterward.
Existing sessions remain ordinary valid sessions until signed out or revoked.
