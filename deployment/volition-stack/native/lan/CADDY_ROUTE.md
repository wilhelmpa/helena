# Kingston LAN HTTP route

While Debian runs under systemd-nspawn on the desktop, its address is
`192.168.122.58`. The desktop WLAN address is `192.168.2.220`.

The existing desktop Caddy proxy owns TCP port 80. The site in `kingston.Caddyfile`
routes only `kingston-server.local` from the home subnet to Debian's authenticated
Nginx entry point. Other hostnames keep the existing Plane routes. WebSocket upgrades
are handled by Caddy's reverse proxy. No application backend port is published.

## Installed configuration

- Existing proxy: `plane-app-proxy-1`.
- Reviewed complete Caddyfile:
  `/home/wilhelmpa/Dokumente/plane-selfhost/plane-app/Caddyfile.kingston`.
- Existing Compose configuration:
  `/home/wilhelmpa/Dokumente/plane-selfhost/plane-app/docker-compose.yaml`.
- The proxy's volumes include `./Caddyfile.kingston:/etc/caddy/Caddyfile:ro` for
  subsequent recreation. Keep using its existing `plane.env` when invoking Compose.
- The running proxy's Caddyfile was updated and validated, then hot-reloaded.
  The existing Plane services were not restarted.

The Plan, Hermes, Mastra, terminal, and browser services remain native on Debian.
This reuses an already running desktop HTTP proxy; it does not install another container.
When Debian boots directly, it can serve port 80 itself. The desktop forwarding and
mDNS publisher are needed only while Debian uses the desktop's private virtual network.

## Verified on 2026-09-23

Requests to desktop `192.168.2.220` with Host `kingston-server.local` returned Plan's
login redirect and the Volition login page. Requests to the desktop's bare IP continued
to return the existing Plane page. Caddy validation passed before reload.

Both addresses are current network configuration, not universally portable defaults.
Update the route, SSH relay, and mDNS publisher together if either address changes.
Local transport remains HTTP. A request from the actual Mac is the final independent
network reachability check.
