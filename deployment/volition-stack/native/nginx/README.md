# Native Nginx hardening

`install-hermes-guard.sh` updates an existing native Kingston Nginx site. It adds
the same Origin allowlist used by the browser, code, and terminal routes to
`/hermes/`. It also permits framing only from the same origin with CSP
`frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`.

The script expects the current unprotected Hermes proxy block exactly once. It
refuses a different target instead of rewriting an unknown configuration. After
staging the change it runs `nginx -t`, reloads Nginx only after validation, and
restores the original file if validation or reload fails. A protected target is
left unchanged.

Run it as root on the native host:

```sh
sudo deployment/volition-stack/native/nginx/install-hermes-guard.sh
```

The default target is `/etc/nginx/sites-available/volition.conf`. An alternate
path is accepted only for isolated tests. The script contains no credentials or
complete host configuration.

Verify the unauthenticated boundary after installation:

```sh
curl -o /dev/null -sS -w '%{http_code}\n' http://kingston-server.local/hermes/
curl -H 'Origin: http://evil.invalid' -o /dev/null -sS -w '%{http_code}\n' \
  http://kingston-server.local/hermes/
curl -H 'Origin: http://kingston-server.local' -o /dev/null -sS -w '%{http_code}\n' \
  http://kingston-server.local/hermes/
```

The expected responses are `401`, `403`, and `401`. The final request passes the
Origin allowlist and then reaches the session gate.

## Mastra Studio (removed)

The Helena engine in the API replaced Mastra, so there is no `/mastra/` route any more.
`deploy.sh` takes the Studio include out of `/etc/nginx/sites-available/volition.conf` on an
instance that still has it, checks and reloads Nginx, and then deletes
`/etc/nginx/snippets/volition-mastra-studio.conf` and
`/etc/nginx/conf.d/volition-mastra-gateway.conf`. It restores the site when Nginx refuses it.

## KasmVNC UDP verification

KasmVNC 1.5.0 accepts `network.udp.port` as `auto` or an integer. It has no
documented server-side `off` value. `encoding.full_frame_updates: none` and
`-udpFullFrameFrequency 0` disable periodic full frames for UDP clients; they do
not prevent the UDP listener. The bundled web client initializes
`enable_webrtc` to `false`, so UDP transit is disabled until a client enables it.

The native Kasm units restrict traffic to loopback with systemd address and
interface policies. Kasm may still display wildcard UDP sockets in `ss`.
Consequently, a unit-file review alone does not prove packet blocking. After a
planned browser restart, verify the effective unit properties, listener table,
and packets from a second LAN host. Do not treat a TCP connection refusal as
proof for the UDP boundary.
