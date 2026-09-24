# Decision: server hardening and Cloudflare One for helena.volition.one

Status: prepared, not executed · Branch: `hub/hardening` · 2026-09-24
Owner request (2026-09-24 ~23:15): "Als Letztes musst du den gesamten Server absichern, also
bulletproof machen, und dann schalten wir Cloudflare als Letztes davor, mit Cloudflare One und
helena.volition.one."

This document is the audit of Kingston as it runs today, the design of the hardening and of the
internet entry, and the runbook for the last phase of the program. Nothing here has been applied
to the live system: every script defaults to a dry run, and the live audit was read-only.

Contents: §1 method · §2 findings · §3 host hardening · §4 Cloudflare One · §5 local HTTPS ·
§6 runbook · §7 owner to-do · §8 owner decisions · §9 disk encryption, Secure Boot, firmware ·
§10 standards chosen · §11 what the branch contains · §12 open points

## 1. Method

- The audit ran read-only on Kingston on 2026-09-24 (native Debian 13, kernel 6.12.107, RAID 1
  root; LAN 192.168.2.58/24, IPv6 2003:c3:172e:f922::/64). It covered sockets, nftables, nginx,
  sshd (`sshd -T`), sudoers, systemd exposure, permissions, Postgres, Redis, Syncthing, sysctl,
  AppArmor, updates, time, the journal, and Helena's own database (counts and flags only).
- No secret was read or printed. Maps that hold the LAN owner capability were read with their
  values masked. Env files, tokens, keys, runner descriptors, vaults and the old cloudflared folder
  were not opened; for the old cloudflared folder only the file names were listed.
- The audit is repeatable: `deployment/volition-stack/native/hardening/audit.sh` prints the same
  list as pass/fail (38 checks), and the hourly timer puts it into Administrator → Sicherheit.
- The critical findings were reproduced without touching live services: a throw-away nginx with a
  fake capability (`tests/nginx-owner-guard-selftest.sh`) and the firewall in a private network
  namespace (`tests/nft-selftest.sh`).

Baseline on 2026-09-24 23:40 (`sudo audit.sh`): **14 fail, 13 warn, 7 pass, 4 skip.**

## 2. Findings

Severity: **critical** = a path to the owner account or root that needs no credential; **high** =
a real weakening that one more mistake turns critical, or that becomes critical once Helena faces
the internet; **medium** = defence in depth missing; **low** = hygiene. "Fix" names the script step
(`apply.sh <step>`, `cloudflare/…`) or the code on this branch.

Count: **4 critical, 10 high, 11 medium, 9 low, plus 6 notes.**

### Critical

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| C-01 | **Any local process becomes the Helena owner, and from there root.** nginx gives the LAN owner capability to a request whose source is in 192.168.2.0/24 or fe80::/10 and whose source ≠ destination. A process on Kingston can bind 192.168.2.58 and connect to 127.0.0.1:80 (or bind its fe80:: address and connect to its global IPv6 address) with `Host: kingston-server.local`: nginx sees a LAN client. The session it gets opens the owner terminal without a code (step-up is off on the LAN), and the terminal is `wilhelmpa` with `NOPASSWD: ALL`. Affected: every non-isolated local user (API, web, worker, runner, provisioning, code-server, the terminal router, Syncthing, www-data, redis, postgres). Isolated agents are not (own network namespace). | Kernel accepts both socket shapes (tested with bind+connect only). Reproduced with a test nginx and a fake capability: `old=FAKE` for both shapes; a real LAN client (the Mac) also `FAKE`. | Two independent layers: firewall rule `helena:self-guard` (a local connection to nginx must come from loopback; proven in a private netns) and the nginx guard map `helena-local-owner-guard.conf` (the capability only on a LAN-facing listener and never from link-local; proven `new=` for both shapes, `new=FAKE` for the real LAN client). `apply.sh local-owner`, `apply.sh firewall`; `local-owner/configure.py` writes the guard from now on and drops `fe80::/10` and the stale `192.168.122.1`. **Do this early, not only in the last phase.** |
| C-02 | **No firewall.** nftables runs, but every chain has policy accept. Everything bound to 0.0.0.0/:: is reachable from the LAN, and over IPv6 from wherever the router lets it: sshd (22, also on the global IPv6 address), nginx 80, KasmVNC UDP 16080–16084 (five project browsers, `-SecurityTypes None`), Syncthing 22000/21027. Whether the internet reaches it depends on the router alone. | `nft list ruleset`; `ss -ltnup`. | `apply.sh firewall`: input default drop; from the home network only 22, 80, 443 (TCP), Syncthing 22000 (TCP/UDP) + 21027 and mDNS 5353 (UDP); ICMPv6 and DHCP answers; nothing from the internet. IPv6 home prefixes follow the provider through `helena-lan6-sync` (NetworkManager dispatcher + 5-min timer). Automatic rollback after 5 minutes unless confirmed from a new session. |
| C-03 | **The owner has no second factor and the terminal asks for no code on the LAN.** `two_factor_enabled` false, 0 passkeys; `ownerTerminal.stepUpRequired=false`. Any device in the home network is the owner (auto sign-in) and gets a root shell in the browser. After go-live the tunnel path needs TOTP (loopback never counts as LAN), but the owner could not produce one. | DB flags (read-only). | Owner: enrol TOTP now (Konto → Sicherheit → Authenticator-App). Before go-live: "Code beim Öffnen verlangen" on; passkeys once HTTPS is up. Helena shows all three under Administrator → Sicherheit → Anmeldung des Owners. |
| C-04 | **Nothing verified that a request from the internet passed Cloudflare Access** (design gap for the go-live, not live yet). A tunnel route or Access policy changed by mistake, or a second hostname on the same tunnel, would expose Helena's own login only. | Design review. | Three gates (§4.3): Access at the edge, cloudflared's "Protect with Access", and Helena's API verifying `Cf-Access-Jwt-Assertion` on every tunnel request (new `modules/edge-access`, fail closed while not configured). |

### High

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| H-01 | **`/auth/verify` (nginx's gate for code-server, the project terminal and the browser router) accepted any signed-in user and any API key.** code-server runs `--auth none` as `volition-hermes`: whoever passes the gate has a shell that reads every Hermes profile and model login. An agent's key sent from anywhere nginx is reachable opened it. | `apps/api/src/app.ts`; nginx `auth_request` forwards all client headers, `x-api-key` included. | Code on this branch: owner (`god`) only, and 403 for any request carrying `x-api-key` or `Authorization` (the owner-terminal gate already did this). Tests in `edge-access.test.ts`. |
| H-02 | **Loopback services without a login of their own are open to every local user**: CDP of all five project browsers (9222, 19201–19204: full control, cookies of the owner's sites), the browser router (6082: live view + input), code-server (8443), the project terminal router (8444), KasmVNC websockets (16080+). They rely on nginx's `auth_request`, which a local process simply bypasses. | `ss`, unit files, router code. | `apply.sh firewall` adds loopback ACLs by uid (`meta skuid`): CDP only volition-browser, volition-hermes, the owner, root; router/VNC only volition-browser, www-data, the owner; code/terminal only www-data (nginx) and the owner; Syncthing GUI only volition-sync, volition-plan, the owner. |
| H-03 | **Database dumps readable by the whole `volition` group**: 23 dumps (`0644` in a `0750` folder) under `/var/lib/volition/plan/backups`. The group holds volition-browser (Chromium, renders untrusted pages), volition-hermes and volition-sync. A dump contains every session token, so reading one is signing in as the owner. | `stat`/`find`. | `apply.sh permissions` (0700/0600); code: `packages/db/src/backup.ts` now creates the folder 0700 and each dump 0600 (test `packages/db/src/__tests__/backup.test.ts`). |
| H-04 | **The owner-terminal signing key is readable by group `volition`** (`/etc/volition/owner-terminal.key` 0640 root:volition). With it a token for the terminal router can be minted; only the socket's `www-data` group stands between that and a root shell. | `stat`. | `apply.sh terminal-key`: own group `helena-terminal-key`, only the API and the terminal router get it (unit drop-ins), both restarted. |
| H-05 | **The clock is not synchronised**: no NTP client installed (`NTP=no`, `NTPSynchronized=no`). TOTP codes, Access JWT expiry, Let's Encrypt and certificate checks depend on it. | `timedatectl`. | Install `systemd-timesyncd` (Debian, owner's OK) and `timedatectl set-ntp true`. The JWT check tolerates 60 s. |
| H-06 | **KasmVNC's UDP listeners face every address** (0.0.0.0:16080–16084). The repo README says the units restrict them; the installed units have no `IPAddressDeny`/`RestrictNetworkInterfaces`. | `ss`, `systemctl show`. | Firewall drops them (C-02); `apply.sh kasm-loopback` adds `IPAddressAllow=localhost`/`IPAddressDeny=any` (works natively now; restarts the browsers). |
| H-07 | **The browser terminal is root without a password** (`wilhelmpa ALL=(ALL:ALL) NOPASSWD: ALL`), and Claude Code/Codex in the owner terminal run as that user. After go-live this is reachable from the internet behind Access + TOTP. | sudoers. | Owner decision §8.3: a separate automation account for SSH (`helena-ops`, NOPASSWD, key-only, LAN-only) and `wilhelmpa` with a password for sudo. The narrow policy drafted in `owner-terminal/90-wilhelmpa` is not a real boundary (`journalctl *`, `apt-get install *`, `git -c … *` and `cat /var/lib/volition/*` all lead to root); do not install it as is. |
| H-08 | **SSH listens on the global IPv6 address** without `AllowUsers`, with agent and TCP forwarding, 6 tries. Key-only and no root login already hold. An authorized key named `codex-home-server` belongs to the wiped Ubuntu host. | `sshd -T`, key comments. | `apply.sh sshd` (+ firewall = home network only); owner reviews the `codex-home-server` key and removes it if unused. |
| H-09 | **Tunnel traffic could be taken for the LAN** (design, go-live): the owner-terminal "no code on the LAN" rule reads `X-Real-IP`. | Code review. | Code: a request marked by the tunnel entry is never LAN (`lanBypass`), whatever address it names; the tunnel entry sets `X-Real-IP` from `CF-Connecting-IP`. Test in `edge-access.test.ts`. |
| H-10 | **The session cookie would be shared with all of volition.one** on the public name: `packages/auth` derives `COOKIE_DOMAIN` from the first origin, `helena.volition.one` → `.volition.one`, so every other site of the company domain would receive the owner's session. | `packages/auth/src/index.ts parentDomain`. | Code: `packages/auth/src/cookie-domain.ts` derives a parent domain only when the app and the api are on different hosts (tests). `cloudflare/switch_origin.py` also sets `COOKIE_DOMAIN=host-only` explicitly (and one origin: `APP_URL=https://helena.volition.one`, `API_URL=…/backend`). |

### Medium

| ID | Finding | Fix |
|---|---|---|
| M-01 | Kernel defaults: `ptrace_scope 0` (every process can read the memory of the same user's other processes: runner, code-server, provisioning are all volition-hermes), `kptr_restrict 0`, ICMP redirects accepted and sent, `rp_filter` off on `all`, no martian logging, `ldisc_autoload 1`. | `apply.sh sysctl` (`90-helena-hardening.conf`). Unprivileged user namespaces stay on: Chromium's sandbox, Codex's bubblewrap and systemd's sandboxing use them. |
| M-02 | API, web and worker have exposure 7.9 (`systemd-analyze security`); they already set NoNewPrivileges, ProtectSystem=strict, PrivateTmp, ProtectHome. | `apply.sh units`: empty capability bounding set, kernel/cgroup/clock/hostname protection, SUID/realtime/personality locks, native syscalls only and a deny list; restarted one by one with a health check and rolled back automatically. |
| M-03 | API runs `NODE_ENV=development`. F01 already made rate limits and Secure cookies independent of it (access-center), so what is left is error detail and library defaults. | Go-live switch §6.7 (unit `Environment=NODE_ENV=production`). |
| M-04 | 411 open owner sessions (7-day lifetime): every visit without a cookie on the LAN (headless checks, the kiosk, new browsers) mints one. Each is a bearer token in the DB and in every dump. | Go-live: delete all sessions once; afterwards the auto sign-in goes (§8.1). The audit warns above 50. |
| M-05 | Project browsers (Chromium as volition-browser) are not network-restricted: the gateway checks the targets agents navigate to, but a page's own scripts and redirects can reach the router (192.168.2.1), other LAN devices and loopback services. | Owner decision §8.6: an nft rule `meta skuid volition-browser` → reject RFC 1918/ULA/loopback except DNS. Not in the default ruleset, because the owner may want the project browser for devices at home. |
| M-06 | Syncthing asks the router to open port 22000 (NAT/UPnP on), with global discovery and relays. Device IDs are authenticated, but "nothing reachable from the internet" includes this. | Owner: Syncthing → Einstellungen → Verbindungen → "NAT-Traversal" off (relays keep phones syncing away from home). |
| M-07 | Journal size unlimited. | `apply.sh journald` (2 GB, 3 months, persistent). |
| M-08 | `redis-server` runs without a password and nothing uses it. | `apply.sh services` disables it. |
| M-09 | The DNS token for Let's Encrypt would, scoped to the zone `volition.one`, be able to rewrite the company's MX and web records. | §5: lego follows a CNAME on `_acme-challenge`; token for a separate, otherwise unused zone. |
| M-10 | The API's full test suite truncates databases on the live cluster with the live role (`itsaplan_test*` owned by `itsaplan`). One wrong `DATABASE_URL` empties production. | oss-packaging's F24 plan (tests on a private cluster); noted for the orchestrator. |
| M-11 | Unattended upgrades take all stable point updates, not only security (the handoff said "security only"). Fine for a server, but cloudflared from Cloudflare's repository is outside it. | Kept. cloudflared is held and updated through the update center. |

### Low

| ID | Finding | Fix |
|---|---|---|
| L-01 | nginx leftovers: the dev site `volition-dev.conf` (injects its own owner capability on `/srv/volition/dev-run/plan-dev.sock`, reachable by `wilhelmpa` only) and its map; ten world-readable backup copies of site files in `/etc/nginx`. | `apply.sh leftovers` moves them to `/var/lib/helena/hardening/backup/…` (0700). |
| L-02 | `nova` (novnc package) has `/bin/bash`; `plan-kiosk` too (kiosk is off). | `apply.sh services` sets nologin for system users (uid < 1000, not postgres). |
| L-03 | ModemManager runs (no modem). | `apply.sh services`. |
| L-04 | The old LAN IP `192.168.2.220` is hard-coded as the kiosk's `X-Real-IP` (`/etc/nginx/conf.d/helena-client-addr.conf`, repo `owner-terminal/nginx-client-addr.conf`) and in the unused `lan/*.service` units. Harmless (still inside the /24), but stale. | Follow-up: use a marker address (e.g. `192.168.2.0`) or the kiosk's own entry flag. |
| L-05 | The TOTP issuer was "Volition". | Code: "Helena" (new enrolments only). |
| L-06 | API reference pages public (`/backend/docs`, `/api/auth/reference`). | Behind Access after go-live; fine on the LAN. |
| L-07 | Isolation proof users `vpt-*` remain (nologin). | Keep for the next proof; remove at the end. |
| L-08 | Agent test Postgres clusters on loopback with `trust` auth (55504–55512). | Dev only; stop them at the end of the program. |
| L-09 | The old Ubuntu cloudflared folder (`/home/wilhelmpa/cloudflared-ubuntu`, 0700) holds `cert.pem` (the account's tunnel-management certificate), two tunnel credential files (`249a27af-….json`, `464889b6-….json`) and two configs (`hq.yml`, `verve-dev.yml`). `wilhelmpa`, and so Claude Code/Codex in the owner terminal, can read them. | Owner: delete the old tunnels in the dashboard, then `shred -u` the folder (§7). |

### Notes (fine as they are)

- Postgres listens on localhost only; `scram-sha-256` over TCP, peer on the socket; one app role
  without superuser; registration closed.
- Redis, Syncthing GUI (with a password), code-server, CDP, the routers, the API and the web app
  are bound to loopback only (`svc.tools_loopback` passes).
- The web app sends a strict CSP with nonces, `frame-ancestors 'none'`, nosniff, a referrer policy,
  a permissions policy and HSTS; nginx has `server_tokens off`.
- AppArmor is loaded but confines nothing relevant here; isolation is systemd's job (204/204 proof).
- Chromium runs with its sandbox (no `--no-sandbox`).
- The SSRF guard (F01) needs `SSRF_ALLOW_PRIVATE=1` to relax; the live API does not set it.

## 3. Host hardening (design)

**Firewall: nftables, one table `inet helena_hardening`** (`hardening/files/helena-hardening.nft.in`,
rendered with this machine's LAN prefix and numeric uids).

- `input`, policy drop: loopback, established/related, ICMPv6, rate-limited ICMP, DHCP answers;
  from the home network (`lan4` = the interface's IPv4 prefix; `lan6` = fe80::/10, fc00::/7 and this
  machine's own /64s) TCP 22/80/443/22000 and UDP 5353/21027/22000. The last rule logs 6 drops a
  minute (`helena-drop:`).
- `output`, policy accept, with the self guard (C-01) and the loopback ACLs by uid (H-02), plus the
  tunnel entry's port for the tunnel user only.
- Why nftables directly: it is what Debian ships and already runs (the kiosk rule lives there);
  ufw and firewalld are front ends that cannot express `meta skuid` loopback ACLs and would own the
  whole ruleset. The table is independent of the kiosk's table and of `/etc/nftables.conf`'s base.
- Safety: the step refuses to run from an SSH session outside the home network; after loading it
  arms a transient timer (`helena-hardening-rollback-firewall`) that deletes the table after 5
  minutes unless `apply.sh --apply confirm firewall` runs from a new session. Only confirm installs
  it into `/etc/nftables.d/` and enables the lan6 sync.
- Proof without root: `tests/nft-selftest.sh` loads the ruleset into a private network namespace
  and checks the self guard (refused from the LAN address, open from loopback) and inbound drops
  (home network → 22 open; outside address → 22 dropped; home network → 8384 dropped). All pass.

**SSH** (`files/50-helena-sshd.conf`): keys only (`AuthenticationMethods publickey`), no root,
`AllowUsers wilhelmpa`, 3 tries, 30 s grace, no agent forwarding, local TCP forwarding only
(`-L` keeps working for the orchestrator's tunnels), no X11, no tunnels, keepalive. Networks are the
firewall's job, so a new DHCP address does not lock anyone out. Same 5-minute rollback pattern;
the step checks that the invoking user is in `AllowUsers` and has keys. Fail2ban is not needed:
key-only and LAN-only leave nothing to guess.

**Kernel** (`files/90-helena-hardening.conf`): see M-01. `kexec_load_disabled` is left out (it
cannot be undone without a reboot and nothing here needs it).

**Services** (`files/60-helena-hardening.conf` for API, web, worker): additions only; nothing
changes what the services may read or write. KasmVNC gets a loopback-only IP policy.

**Files**: dumps (H-03), terminal key (H-04), nginx leftovers (L-01). `audit.sh` checks for
world-readable files under `/etc/volition` and `/etc/helena`.

**What stays open on purpose**: unprivileged user namespaces (see M-01), AppArmor profiles for
Helena's services (systemd sandboxing covers it), auditd (not installed; the journal plus Helena's
own audit trails are enough for one owner).

## 4. Cloudflare One for helena.volition.one

### 4.1 Shape

```text
 phone / laptop ──HTTPS──▶ Cloudflare edge (helena.volition.one)
                              │ Access: owner's identity (Google or email code), 24 h session
                              │ WAF, TLS 1.2+, 100 MB upload limit
                              ▼
                        Cloudflare Tunnel (outbound QUIC/HTTP2 from Kingston, no open port)
                              │
 Kingston  helena-cloudflared.service (user helena-tunnel, hardened, no self-update,
                              │        may reach loopback and the internet, never the LAN)
                              │ checks the Access JWT itself ("Protect with Access")
                              ▼
           nginx 127.0.0.1:8090  (tunnel entry, only helena-tunnel may connect: nft)
             · no LAN owner capability, ever (blanked in every location)
             · X-Helena-Entry: tunnel, X-Real-IP = CF-Connecting-IP
             · auth_request /_helena_edge on every location without its own gate
                              ▼
           Helena API: edge guard on every request marked tunnel → verifies
           Cf-Access-Jwt-Assertion (team domain + AUD, JWKS cached, RS256, 60 s skew,
           optional allowed e-mails); fail closed while not configured
                              ▼
           Helena's own sign-in (password / passkey; TOTP for the terminal)
```

### 4.2 Tunnel

- **Remote-managed tunnel** created by the owner in the Zero Trust dashboard (Networks → Tunnels),
  name `helena-kingston`. The connector gets only the token. Public hostname:
  `helena.volition.one` → `HTTP` `127.0.0.1:8090`; Additional settings → Access → **Protect with
  Access** (team + AUD), so cloudflared refuses requests without a valid Access token itself.
- **cloudflared** from Cloudflare's apt repository (`pkg.cloudflare.com`, signed-by keyring, key
  fingerprint compared with the value the owner reads off Cloudflare's docs), version held
  (`apt-mark hold`), updates through Helena's update center. Debian does not ship it.
- **Unit** `helena-cloudflared.service`: user `helena-tunnel`; token as a systemd credential
  (`LoadCredential`) from `/etc/helena/cloudflare/tunnel.token` (0600 root), read with
  `--token-file` (cloudflared ≥ 2025.4, otherwise the wrapper exports it to the process only);
  `--no-autoupdate`; metrics/readiness on 127.0.0.1:20241; `IPAddressDeny` for RFC 1918, CGNAT,
  link-local and ULA with `IPAddressAllow=localhost`, and public resolvers bound over
  `/etc/resolv.conf` inside the unit, so a hostname added in the dashboard can never route to the
  router or another device at home; ProtectSystem=strict, no capabilities, syscall filter,
  MemoryDenyWriteExecute, 512 MB.
- The old tunnels of the Ubuntu era (`m5.volition.one`) are deleted, not reused (L-09).

### 4.3 Access

- **Application**: Self-hosted, `helena.volition.one` (all paths). Session duration **24 h**.
  Cookie settings: HttpOnly, SameSite Lax, **binding cookie on**. No CORS settings (same origin).
- **Identity**: the owner's **Google** account through Cloudflare's Google login method
  (recommended: it already has 2-step verification), and **One-time PIN** to the owner's address as
  the fallback. Policy "Owner": Allow, Include = the owner's e-mail addresses. No bypass policy, no
  "Everyone".
- **Device posture (WARP)**: optional, owner decision §8.5. Not needed for the start.
- **Origin enforcement** (defence in depth, C-04):
  1. cloudflared checks the Access token (Protect with Access).
  2. The tunnel entry listens on loopback and only `helena-tunnel` may connect (nft `acl-tunnel`).
  3. The API verifies `Cf-Access-Jwt-Assertion` on every request the tunnel entry marked
     (`X-Helena-Entry`), including the internal auth subrequests of the tools and the terminal:
     issuer `https://<team>.cloudflareaccess.com`, audience = the AUD tag(s), RS256 from the team's
     JWKS (cached by `jose`, refetched on rotation), 60 s skew. Team domain and AUD are set in
     Administrator → Sicherheit → Zugang von außen (not secrets; stored in `app_setting.edgeAccess`).
     The team domain must end in `.cloudflareaccess.com`, so the key lookup can never be pointed
     elsewhere. Optional "allowed identities" repeat the Access policy at the origin.
  4. Helena's own session, and TOTP (later passkey) for the terminal; tunnel requests never count as
     LAN (H-09).
- A second hostname or a changed policy that skips Access still fails at 1 and 3.

### 4.4 WebSockets, streams, limits

| Path | Through the tunnel | Notes |
|---|---|---|
| Owner terminal, project terminal (wetty, WebSocket) | yes | wetty pings every 25 s; nginx read timeout 3600 s. Hosts allowed by `switch_origin.py` drop-ins. |
| Chat streams (SSE) | yes | the API pings every 15 s; `Cache-Control: no-transform` added so the edge does not compress/buffer; resumable with `Last-Event-ID`. |
| Browser live view (WebSocket, MSE/WebCodecs), Desktop view (KasmVNC over the router's WebSocket) | yes | continuous frames; KasmVNC's UDP/WebRTC path does not cross the tunnel and stays off. |
| code-server | yes | Origin = Host check passes (same public name). |
| Uploads | ≤ 100 MB | Cloudflare Free limit = nginx `client_max_body_size`. |
| Long requests | 100 s | Cloudflare's origin response timeout (not configurable on Free). Long operations in Helena run as jobs. |

Rate limits keep working: Better Auth counts per `X-Real-IP`, which the tunnel entry sets from
`CF-Connecting-IP`.

### 4.5 Phones

Same URL on Wi-Fi and mobile data; Access login once a day, then Helena's session; passkeys work
on the HTTPS origin (iOS/Android platform authenticators). A PWA keeps the Access cookie.

### 4.6 Secrets and where they live

| Secret | Created by | Stored | Used by |
|---|---|---|---|
| Tunnel token | owner (dashboard) | `/etc/helena/cloudflare/tunnel.token` 0600 root, pasted with `cloudflare/install.sh --apply token` (no echo) | cloudflared via `LoadCredential` |
| DNS API token (optional, §5) | owner (dashboard, scoped) | `/etc/helena/cloudflare/dns.token` 0600 root, `cloudflare/tls-setup.sh --apply token` | lego in a transient unit via `LoadCredential` |
| Access team domain, AUD | owner (dashboard) | Helena (not secret) | API edge guard |

None of them is in the repo, an env file, Helena's database or a log. The owner can run both
`token` commands in the owner terminal.

### 4.7 Rollback

Dashboard: remove the public hostname (or pause the tunnel). Server: `cloudflare/install.sh --apply
remove` (stops the connector, disables the entry), `switch_origin.py --apply --rollback`,
`local-owner/configure.py --lan-http`, `lan_https.py --apply --rollback`; restart API/web/terminals.
LAN access over `http://kingston-server.local` works throughout.

## 5. Local HTTPS and the LAN

- **One origin.** The web client calls one absolute `API_URL`, and cookies follow it; two origins
  (http on the LAN, https outside) do not work together. After go-live the origin is
  `https://helena.volition.one` everywhere (`switch_origin.py`).
- **How the LAN reaches it**, two options (owner decision §8.2):
  - **A. Through the tunnel also at home** (default, nothing else to run): simplest, Access login at
    home too, traffic goes out and back (the live view costs upload bandwidth).
  - **B. Split horizon**: at home the name resolves to 192.168.2.58 and nginx serves it directly on
    443 with a Let's Encrypt certificate (`tls-setup.sh` + `lan_https.py`). Faster, works without
    internet, keeps the LAN auto sign-in possible. Needs a local answer for the name:
    - the **router** is a Telekom **Speedport** (DNS search domain `speedport.ip`, 192.168.2.0/24),
      not a FRITZ!Box as assumed. Speedports offer no local DNS records; a FRITZ!Box would need a
      local DNS server entry (it has no arbitrary host records either) or, for a public record with
      a private address, the exception under Heimnetz → Netzwerk → Netzwerkeinstellungen →
      DNS-Rebind-Schutz;
    - so: a small resolver on Kingston (`unbound`, one `local-data` line, everything else forwarded)
      announced by the router's DHCP where the router allows it, or per device (the Mac's
      `/etc/hosts`; phones use the tunnel).
- **Certificate**: Let's Encrypt DNS-01 with **lego** (Debian package, MIT). lego follows a CNAME on
  `_acme-challenge.helena.volition.one`, so the Cloudflare token can be limited to a separate,
  otherwise unused zone (M-09); certbot's Cloudflare plugin cannot. Renewal: `helena-tls-renew.timer`
  (daily check, renews under 30 days, reloads nginx).
- **LAN auto sign-in**: keep it for now on the LAN entry only (never on the tunnel entry, enforced
  three times); turn it off once passkeys work on the owner's devices (§8.1). With HTTPS it moves to
  port 443 under the public name (`configure.py --https-host`); the guard map covers 443.
- **Dictation/voice** needs a secure context: given by either option.
- **After the switch `http://kingston-server.local` no longer signs anyone in** (cookies are Secure,
  the origin is the public name). Point it at the public name in the LAN block (a map on
  `$host:$server_port` for `kingston-server.local:80` → `return 301 https://helena.volition.one$request_uri`;
  the kiosk's 127.0.0.1:8088 stays untouched). Not scripted yet; a two-line edit in the window.

## 6. Runbook (the last phase; orchestrator)

Order as requested: audit → low-risk fixes → firewall with auto-rollback → SSH → units → HTTPS
locally → owner creates tunnel + Access → tunnel go-live → external test → security switches →
final audit. `H=/srv/volition/source/plan/deployment/volition-stack/native` (after the rename,
the new path). Every `apply.sh` step without `--apply` is a dry run; run it first.

**6.0 Before** (can be done any time, recommended soon):
- Merge `hub/hardening` and deploy (API edge guard, owner-only `/auth/verify`, private dumps).
  Check the web still opens code, terminal and browser for the owner.
- Owner enrols TOTP (C-03). Owner's OK for `systemd-timesyncd`; `sudo apt install systemd-timesyncd
  && sudo timedatectl set-ntp true`; check `timedatectl` shows synchronised.
- **C-01 now:** `sudo $H/hardening/apply.sh local-owner`, then `--apply local-owner`. Check from the
  Mac that the LAN auto sign-in still works (new private window on http://kingston-server.local).
- `sudo $H/hardening/audit.sh` → baseline.

**6.1 Low-risk fixes** (each: dry run, then `--apply`):
`leftovers`, `permissions`, `services`, `sysctl`, `journald`, `audit-timer`. Check after
`services`: nothing in Helena used Redis (`audit.sh` `net.redis` pass).

**6.2 Firewall** (from an SSH session in the home network):
1. `sudo $H/hardening/apply.sh firewall` (read the diff), then `--apply firewall`.
2. Within 5 minutes, from a NEW terminal: `ssh kingston-server.local true`; the Mac's browser opens
   Helena; a phone on Wi-Fi opens Helena; Syncthing shows the devices connected; IPv6: `curl -6
   http://[<kingston global v6>]/` from the Mac (answers).
3. `sudo $H/hardening/apply.sh --apply confirm firewall`. If anything failed: wait (it rolls back
   itself) or `--apply rollback firewall`.
4. `sudo nft list table inet helena_hardening | grep -c helena:` → 8 markers; `audit.sh` net.* pass.

**6.3 SSH**: same as 6.2 with `sshd` (`--apply sshd`, new session, `--apply confirm sshd`).
Owner first decides on the `codex-home-server` key.

**6.4 Units** (a quiet moment, no chat answer or run in flight):
`--apply units` (API, web, worker one by one with health checks), `--apply terminal-key`,
`--apply kasm-loopback` (restarts the five project browsers). `audit.sh` svc.exposure < 6.

**6.5 Local HTTPS** (only for option B, §5): owner's OK for `lego`; owner creates the DNS token
and CNAME (§7), runs `sudo $H/cloudflare/tls-setup.sh --apply token`, then
`sudo $H/cloudflare/tls-setup.sh --apply issue --email <owner> --accept-letsencrypt-terms`;
`sudo python3 $H/cloudflare/lan_https.py` (diff) → `--apply`; `tls-setup.sh --apply renew-timer`.
The origin does not switch yet.

**6.6 Tunnel** (owner + orchestrator together):
1. Owner's OK for cloudflared; owner reads the key fingerprint from Cloudflare's package docs.
   `sudo $H/cloudflare/install.sh --apply package --fingerprint <FPR>`.
2. Owner creates the tunnel (§7) and runs `sudo $H/cloudflare/install.sh --apply token`.
3. `sudo $H/cloudflare/install.sh --apply service` → "connector ready".
4. `sudo $H/cloudflare/install.sh --apply nginx` → the self-check must say 403 without Access.
   Re-run `apply.sh --apply firewall` + confirm, so `acl-tunnel` knows the new user.
5. Owner creates the Access application and policy and enters team domain + AUD in Administrator →
   Sicherheit → Zugang von außen ("Eingerichtet").
6. Owner adds the public hostname `helena.volition.one` → `http://127.0.0.1:8090` with
   Protect with Access.

**6.7 Go-live switch** (one window, ~10 min):
1. `sudo python3 $H/cloudflare/switch_origin.py` (read), then `--apply` (it also points the web
   server's own api calls at loopback: `SERVICE_URL_API`). Update OAuth redirect URIs at Google etc.
2. `sudo python3 $H/local-owner/configure.py --https-host helena.volition.one` (option B) — it
   restarts API and web itself; for option A it is not needed (no LAN sign-in on the tunnel).
3. API unit `NODE_ENV=production` (drop-in `Environment=NODE_ENV=production`), then restart
   `volition-plan-api volition-plan-web volition-terminal volition-owner-terminal`.
4. Delete all sessions once: `sudo -u postgres psql -d itsaplan -c 'delete from session'`
   (agents use keys, not sessions).
5. Owner turns "Code beim Öffnen verlangen" **on**, signs in on `https://helena.volition.one`,
   adds passkeys (Mac, iPhone).

**6.8 External test** (phone on mobile data, Wi-Fi off): Access login → Helena sign-in → a page,
a chat answer streaming, the owner terminal (TOTP asked, never "LAN"), the browser live view, a
file upload. From a laptop outside: `curl -sI https://helena.volition.one` → Access redirect;
`curl -s https://helena.volition.one/backend/me -H 'Cf-Access-Jwt-Assertion: x'` → blocked by
Access. Router: no port forwards (§7).

**6.9 Final**: `sudo $H/hardening/audit.sh` → no fail (warnings only for owner decisions);
Administrator → Sicherheit shows the same. Record the state in CLAUDE.md.

**Rollback per phase**: every step has `apply.sh --apply rollback <step>`; tunnel §4.7; the
automatic rollbacks cover firewall and SSH; backups of every replaced file are under
`/var/lib/helena/hardening/backup/<time>/`.

## 7. Owner to-do (credentials only the owner handles)

1. **Now:** Konto → Sicherheit → Authenticator-App (TOTP) einrichten. Make sure the Helena password
   is known (the tunnel has no LAN auto sign-in).
2. **Router (Speedport, http://192.168.2.1)**: no port forwarding ("Portfreischaltung") entries;
   UPnP off; IPv6 "Freigaben"/firewall: no inbound exceptions for Kingston; remote access / EasySupport
   off if not needed; admin password strong; guests only on the guest Wi-Fi. Then, from mobile
   data: `ssh -6 <kingston global v6>` and `http://[<v6>]/` must time out.
3. **OKs for installs**: `systemd-timesyncd`; `cloudflared` (Cloudflare's apt repo); `lego` and
   optionally `unbound` (option B).
4. **Cloudflare** (dash.cloudflare.com, volition.one): Zero Trust → choose the team name (becomes
   `<team>.cloudflareaccess.com`); Settings → Authentication → add Google (and One-time PIN);
   Networks → Tunnels → Create → Cloudflared → name `helena-kingston` → copy the token → on Kingston
   in the owner terminal: `sudo …/cloudflare/install.sh --apply token` and paste (hidden).
5. Access → Applications → Add → Self-hosted: `helena.volition.one`, session 24 h, binding cookie
   on, policy "Owner" (Allow, Include Emails: your addresses). Copy the **AUD** tag and the team
   domain into Helena → Administrator → Sicherheit → Zugang von außen → Speichern.
6. Tunnel → Public Hostname: `helena.volition.one`, Service `HTTP` `127.0.0.1:8090`; Additional
   application settings → Access → Protect with Access (team + AUD).
7. Option B only: DNS token (My Profile → API Tokens → Create → Zone.DNS Edit for the separate ACME
   zone, or for volition.one if you accept M-09) and the CNAME
   `_acme-challenge.helena` → `helena.<acme-zone>` in volition.one; paste the token with
   `sudo …/cloudflare/tls-setup.sh --apply token`.
8. After go-live: passkeys on Mac and iPhone; later turn off the LAN auto sign-in (§8.1).
9. Old tunnels: in Zero Trust delete the Ubuntu-era tunnels (IDs `249a27af…`, `464889b6…`,
   host m5.volition.one and the ones in `hq.yml`/`verve-dev.yml`), then
   `shred -u ~/cloudflared-ubuntu/* && rmdir ~/cloudflared-ubuntu`.
10. SSH key `codex-home-server` in `~/.ssh/authorized_keys`: keep or remove.
11. Firmware: set a BIOS supervisor password; boot from USB/network only with it (§9).

## 8. Owner decisions

1. **LAN auto sign-in**: recommendation — keep until passkeys work on HTTPS, then off (every device
   in the home network, including IoT and visitors on the main Wi-Fi, is the owner today). It never
   applies to the tunnel.
2. **At home: tunnel (A) or split horizon (B)?** Recommendation: start with A (nothing to run),
   add B if the live view is too slow at home.
3. **sudo model** (H-07): recommendation — a separate `helena-ops` account for the orchestrator's
   SSH automation (NOPASSWD, key-only, LAN-only) and a sudo password for `wilhelmpa`, so the browser
   terminal and the AI CLIs in it need the password for root.
4. **Access identity**: Google (recommended) and/or One-time PIN; session 24 h (or 7 d for
   convenience; the owner terminal still asks for TOTP).
5. **WARP device posture**: not now; possible later (only enrolled devices reach Helena).
6. **Project browsers and the home network** (M-05): block LAN/loopback for the project browsers
   (recommended) or keep them able to open devices at home.
7. **Syncthing NAT** (M-06): off (recommended); relays keep working.
8. **Disk encryption and Secure Boot** (§9).

## 9. Disk encryption, Secure Boot, firmware, physical

- **Disk encryption**: none today. The box is at home, so theft is less likely than the other case
  a RAID invites: a failed disk goes back for warranty or into the bin with the data readable.
  Recommendation: **LUKS2 on the md array with TPM2 unlock** (`systemd-cryptenroll --tpm2-device=auto
  --tpm2-pcrs=7`) plus a recovery key printed and kept offline, in a physical maintenance window
  after the restic backup exists. The TPM (2.0) is present. Conversion in place:
  `cryptsetup reencrypt --encrypt --reduce-device-size 32M` on the unmounted array from a rescue
  boot (shrink ext4 by 32 MiB first), roughly 30–60 min for 1.8 TB, then crypttab/initramfs on both
  ESPs. Without Secure Boot, PCR 7 binding proves little against someone at the console, so do it
  together with Secure Boot. Until then: before a disk leaves the house, secure-erase it
  (`nvme format -s1`) if it still answers.
- **Secure Boot**: off because the DKMS modules (fan/EC control from server-admin, possibly GPU)
  are unsigned. **MOK signing** works: `dkms` on Debian 13 signs with `/var/lib/dkms/mok.{key,pub}`;
  `mokutil --import /var/lib/dkms/mok.pub` and confirm in MokManager at the console on the next
  boot; shim is already in use on both ESPs. Recommendation: yes, with the encryption window.
- **Firmware**: supervisor password; USB/network boot only with it; keep the two Debian entries;
  TPM on; BIOS updates from Bosgame when they fix security issues.
- **Physical**: the console (tty1) asks for `wilhelmpa`'s password; the kiosk is off. Break-glass:
  console login, or boot "Debian (Reserve)".

## 10. Standards chosen

| Block | Chosen | Rejected |
|---|---|---|
| JWT/JWKS | `jose` 6.2 (MIT; already in the tree through better-auth; `createRemoteJWKSet`, `jwtVerify`) | Hand-written WebCrypto verification; Cloudflare's example Workers code |
| Firewall | nftables directly (`meta skuid` ACLs, atomic table replace) | ufw/firewalld (no uid ACLs, own the ruleset), iptables-nft |
| ACME | lego (Debian, MIT; follows CNAME on the challenge record, `*_FILE` secrets) | certbot + dns-cloudflare (no CNAME following → token for the whole zone), acme.sh (shell, no Debian package) |
| Tunnel | cloudflared from Cloudflare's apt repo, remote-managed tunnel with a token | Locally-managed tunnel with `cert.pem` (keeps an account-wide certificate on the server), the old Ubuntu credentials |
| Edge identity | Cloudflare Access (owner's request) behind an `EdgeProvider` interface | oauth2-proxy/Authelia/Pomerium as extra services (the interface keeps them possible) |

## 11. What this branch contains

- **API** (`apps/api/src/modules/edge-access`): the `EdgeProvider` shape with Cloudflare Access as
  its first provider (`providers.ts`), settings + guard (`service.ts`), the host audit report and
  security status (`status.ts`), routes `GET /god/security/status`, `GET|PUT /god/security/edge`
  (owner, writes only from the interactive session) and `GET /auth/verify/edge` (nginx). The guard
  runs in `app.ts`'s `onRequest` before everything else. `/auth/verify` is owner-only and refuses
  keys. The owner terminal never counts a tunnel request as LAN. SSE responses carry `no-transform`.
  TOTP issuer "Helena". `jose` is a direct dependency of `apps/api`.
- **DB**: `packages/db/src/backup.ts` writes dumps 0600 in a 0700 folder.
- **Auth**: `packages/auth/src/cookie-domain.ts`: the session cookie is host-only unless app and api
  hosts differ (H-10).
- **Web**: Administrator → Sicherheit shows three new sections above the terminal settings:
  Server-Härtung (the audit, findings first), Anmeldung des Owners (TOTP, passkey, step-up,
  sessions), Zugang von außen (team domain, AUD, allowed identities). `SecurityStatusSections` and
  `SecurityAuditPanel` are separate components so hub/server-admin can mount them as its
  "Sicherheit" tab. 10 locales (`messages/*/serverSecurity.json`).
- **Host scripts** (`deployment/volition-stack/native/hardening/`): `audit.sh`, `apply.sh`, `files/`
  (nft template, sysctl, sshd, journald, unit drop-ins, lan6 sync, audit timer, owner guard map),
  `tests/` (firewall in a netns, owner guard with a test nginx, `nginx -t` of the go-live config).
- **Cloudflare** (`deployment/volition-stack/native/cloudflare/`): `install.sh`, the hardened unit
  and wrapper, the tunnel entry template and header snippet, `tls-setup.sh` + renewal units,
  `lan_https.py`, `switch_origin.py`.
- **Local owner**: `configure.py` writes the guard, drops `fe80::/10` and `192.168.122.1`, and knows
  `--https-host` / `--lan-http`.

## 12. Open points

- hub/server-admin: register `securityHealth()` (status.ts, shaped like `HostHealthItem`) as a host
  capability in area `security`, mount `SecurityStatusSections` as the tab, and give helena-hostd a
  method `io.helena.hostd.SecurityAudit` that runs `/usr/local/libexec/helena-security-audit
  --json-file /var/lib/helena-security/audit.json` for a "Neu prüfen" button.
- The rename (package G) must carry `volition-*` names in the scripts' defaults
  (`HELENA_API_UNITS`, paths). The guard map is rename-safe: its output is
  `$helena_owner_capability`, and the kit's rule `volition_local_owner_token` →
  `helena_local_owner_token` rewrites its input consistently (checked against `rename-map.json`).
- The kiosk under the HTTPS origin needs its own TLS listener (it is off now).
- Browser egress restriction (M-05) as an nft rule once the owner decides.
- `code-server` could listen on a Unix socket instead of 127.0.0.1:8443 (removes H-02 for it
  without the ACL).
- **Inbound webhooks** (Git providers, a Telegram webhook, if one is ever used) cannot pass
  Cloudflare Access, and a bypass policy would not carry the assertion the API demands. When one is
  needed: a separate hostname (e.g. `hooks.helena.volition.one`) on the same tunnel to a second
  nginx entry that exposes only the webhook paths (they verify their own signatures), marked with a
  different entry value the API allows for those routes only. Not built now; nothing uses one yet.
- **OAuth redirect URIs** registered elsewhere (Google sign-in/connector, MCP OAuth clients) move
  with `API_URL` to `https://helena.volition.one/backend/…`; update them at the provider in the
  go-live window (Administrator shows the exact values).
