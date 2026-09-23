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

## Mastra Studio

Studio is served below `/mastra/` to the instance owner only. `mastra-studio.conf` holds
the locations: `auth_request` asks Plan's `/auth/verify/owner`, which answers 204 for an
active session of the `god` user, and the request goes to the Mastra proxy on `:4111` with
`X-Volition-Gateway-Token` set to `$volition_mastra_gateway_token`. The proxy refuses every
Studio request without that token, so a local process that reaches `:4111` directly gets
403. The trust model is in `optional/mastra-studio/ORCHESTRATION_CONTRACT.md`.

`install-mastra-studio.sh`, run as root, is idempotent and does the following:

1. Creates `/etc/volition/mastra-control.token` and `/etc/volition/mastra-gateway.token`
   (`0600 root`, 32 random bytes as hex) when they are missing. `volition-mastra`,
   `volition-plan-api` and `volition-plan-worker` load them with `LoadCredential=`.
2. Writes `/etc/nginx/conf.d/volition-mastra-gateway.conf` (`0600 root`), the `map` that
   defines `$volition_mastra_gateway_token` from the gateway token. The token never
   appears in a command argument.
3. Installs `mastra-studio.conf` as `/etc/nginx/snippets/volition-mastra-studio.conf` and
   includes it in `/etc/nginx/sites-available/volition.conf` after the project terminal
   include.
4. Runs `nginx -t` and reloads Nginx, and restores the site file when either fails.

`deploy.sh` runs it before it installs units, whenever the script or the snippet changed.
Verify after the Mastra units run with the new tokens:

```sh
curl -o /dev/null -sS -w '%{http_code}\n' http://kingston-server.local/mastra/workflows  # 401
curl -o /dev/null -sS -w '%{http_code}\n' http://127.0.0.1:4111/mastra/workflows         # 403
curl -o /dev/null -sS -w '%{http_code}\n' -H 'X-Volition-Auth: verified' \
  http://127.0.0.1:4111/mastra/api/workflows                                              # 403
curl -o /dev/null -sS -w '%{http_code}\n' http://127.0.0.1:4112/mastra/api/workflows     # 401
```

In the browser, the owner opens `http://kingston-server.local/mastra/workflows`; another
member gets 403.

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
