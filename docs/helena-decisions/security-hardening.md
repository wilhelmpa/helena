# Decision: server hardening and Cloudflare One for helena.volition.one

Status: live since 2026-09-25 (tunnel, Access, hardening steps) · Branch: `hub/hardening`, home
network access and the Cloudflare sign-in: `hub/home-access` (§4.8, §5, §6.10) · 2026-09-24/25
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

Count: **4 critical, 11 high, 11 medium, 9 low, plus 6 notes.** (H-11 found live on 2026-09-25.)

### Critical

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| C-01 | **Any local process becomes the Helena owner, and from there root.** nginx gives the LAN owner capability to a request whose source is in 192.168.2.0/24 or fe80::/10 and whose source ≠ destination. A process on Kingston can bind 192.168.2.58 and connect to 127.0.0.1:80 (or bind its fe80:: address and connect to its global IPv6 address) with `Host: kingston-server.local`: nginx sees a LAN client. The session it gets opens the owner terminal without a code (step-up is off on the LAN), and the terminal is `wilhelmpa` with `NOPASSWD: ALL`. Affected: every non-isolated local user (API, web, worker, runner, provisioning, code-server, the terminal router, Syncthing, www-data, redis, postgres). Isolated agents are not (own network namespace). | Kernel accepts both socket shapes (tested with bind+connect only). Reproduced with a test nginx and a fake capability: `old=FAKE` for both shapes; a real LAN client (the Mac) also `FAKE`. | Two independent layers: firewall rule `helena:self-guard` (a local connection to nginx must come from loopback; proven in a private netns) and the nginx guard map `helena-local-owner-guard.conf` (the capability only on a LAN-facing listener and never from link-local; proven `new=` for both shapes, `new=FAKE` for the real LAN client). `apply.sh local-owner`, `apply.sh firewall`; `local-owner/configure.py` writes the guard from now on and drops `fe80::/10` and the stale `192.168.122.1`. **Do this early, not only in the last phase.** **IPv6 (2026-09-25):** the owner geo also includes `/etc/nginx/helena-owner-networks.conf`, kept by `helena-lan6-sync`: the /64s this machine has on its LAN interface (never link-local or loopback, a ULA only when the LAN interface has one) and **every address of the machine itself as `0`** (an IPv6 host has several — stable, privacy, DHCPv6 — so "source ≠ destination" alone would let one own address talk to another; the most specific geo entry wins). The firewall's `helena:self-guard6` refuses local IPv6 connections to nginx from a non-`::1` source. Proven in `tests/owner-lan6-selftest.sh` (with a control showing the hole without the own-address lines) and `tests/nft-selftest.sh`; `apply.sh owner-lan6`. |
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
| H-07 | **The browser terminal is root without a password** (`wilhelmpa ALL=(ALL:ALL) NOPASSWD: ALL`), and Claude Code/Codex in the owner terminal run as that user. After go-live this is reachable from the internet behind Access + TOTP. | sudoers. | **Done 2026-09-25** (§8.3, `apply.sh sudo-model`): the automation account `helena-ops` has `NOPASSWD: ALL` (`/etc/sudoers.d/80-helena-ops`), its password is locked, SSH takes its key only (`/etc/ssh/sshd_config.d/60-helena-ops.conf`: `Match User helena-ops` → `AuthenticationMethods publickey`) and only from the home network (AllowUsers + firewall); the owner's blanket rule is moved aside, so `wilhelmpa` types his password for sudo. `audit.sh` `auth.sudo` passes only in that shape. The narrow policy drafted in `owner-terminal/90-wilhelmpa` is not a real boundary (`journalctl *`, `apt-get install *`, `git -c … *` and `cat /var/lib/volition/*` all lead to root); do not install it as is. |
| H-08 | **SSH listens on the global IPv6 address** without `AllowUsers`, with agent and TCP forwarding, 6 tries. Key-only and no root login already hold. An authorized key named `codex-home-server` belongs to the wiped Ubuntu host. | `sshd -T`, key comments. | `apply.sh sshd` (+ firewall = home network only); owner reviews the `codex-home-server` key and removes it if unused. |
| H-09 | **Tunnel traffic could be taken for the LAN** (design, go-live): the owner-terminal "no code on the LAN" rule reads `X-Real-IP`. | Code review. | Code: a request marked by the tunnel entry is never LAN (`lanBypass`), whatever address it names; the tunnel entry sets `X-Real-IP` from `CF-Connecting-IP`. Test in `edge-access.test.ts`. |
| H-10 | **The session cookie would be shared with all of volition.one** on the public name: `packages/auth` derives `COOKIE_DOMAIN` from the first origin, `helena.volition.one` → `.volition.one`, so every other site of the company domain would receive the owner's session. | `packages/auth/src/index.ts parentDomain`. | Code: `packages/auth/src/cookie-domain.ts` derives a parent domain only when the app and the api are on different hosts (tests). `cloudflare/switch_origin.py` also sets `COOKIE_DOMAIN=host-only` explicitly (and one origin: `APP_URL=https://helena.volition.one`, `API_URL=…/backend`). |
| H-11 | **The tunnel ACL named the tunnel user by uid before the user existed** (live, 2026-09-25): the firewall step ran before `cloudflare/install.sh service` created `helena-tunnel`, so `tunnel_uids` held root alone; cloudflared got "connection refused" on 127.0.0.1:8090 and the owner Cloudflare's 502. The installer's own check ran as root, which the ACL always admits, and passed. | Live: the orchestrator added uid 978 by hand and re-confirmed the firewall. | `apply.sh firewall-uids` (adds every missing account of the uid sets, live and installed, `nft -c` checked); `install.sh service` runs it and checks the entry as `helena-tunnel`; `audit.sh tunnel.acl` fails (`why=user`) when the uid is missing. `tests/firewall-uids-selftest.sh`. |

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
           Helena's own sign-in (password + authenticator code / passkey), or, when the
           owner turned it on, the Cloudflare sign-in: the Access login is the Helena
           sign-in (§4.8). TOTP for the terminal either way.
```

At home the same browser reaches Helena directly under a second name,
`https://helena-home.volition.one`, served by nginx on the LAN (§5).

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
The Cloudflare sign-in alone: its switch in Administrator → Sicherheit → Zugang von außen (off takes
effect at once; open Helena sessions it made end within a day); a leaked entry proof:
`install.sh --apply --rotate entry-token` and restart API and web.

### 4.8 The Cloudflare sign-in (single sign-on)

Owner (2026-09-25): "dann Single Sign-On sicher — kein extra Passwort mehr für Helena." The
Access login (with its second factor) becomes the Helena sign-in on the public name. Off by
default; the orchestrator switches it on after the checks in §6.10.

**Flow.** A page load without a Helena session on `helena.volition.one`:

1. Cloudflare's edge lets the request through only with a valid Access session (MFA required by
   the Access application since 2026-09-25) and adds `Cf-Access-Jwt-Assertion`.
2. cloudflared checks the assertion itself (Protect with Access) and connects to nginx's tunnel
   entry; only the tunnel user may (nft `acl-tunnel`).
3. nginx's tunnel entry marks the request (`X-Helena-Entry: tunnel`) and adds the **entry proof**
   `X-Helena-Edge-Entry`: a random 64-hex value from `conf.d/helena-edge-entry.conf` (0600 root),
   sent only on this server block and only to the web app's upstream (the map is keyed on
   `$server_addr:$server_port:$proxy_host`; every other location, the API included, gets an
   empty value, which drops a client-sent header of that name). The map is `volatile`: nginx
   shares variables between a request and its auth subrequests, and a value cached while the
   `/_helena_edge` subrequest ran (API upstream, empty) would otherwise stand for the main
   request (found by `cloudflare/tests/lan-https-selftest.sh`).
4. The web app's proxy (`apps/web/src/lib/edge-sign-in-session.ts`) sees no session, the proof
   (compared in constant time with `HELENA_EDGE_ENTRY_TOKEN`) and an assertion, on one of the
   instance's origins, for a same-origin GET navigation. It posts to the API's
   `/api/auth/sign-in/edge` on loopback with the proof, the tunnel marker, the assertion and
   the client's address and browser.
5. The API's edge guard verifies the assertion (as on every tunnel request); the sign-in endpoint
   (`packages/auth/src/edge-sign-in.ts`, a better-auth plugin) checks the proof again, then asks
   the edge-access module (`apps/api/src/modules/edge-access/sign-in.ts`, registered as its
   verifier): the switch is on, the assertion is valid (signature from the team's keys,
   audience, issuer, expiry), the identity is on Helena's **explicit** allow list (the switch
   cannot be turned on without one). Then the account: that address exists, has the owner role
   (`EDGE_SIGN_IN_ROLES`, extendable), is active.
6. It opens a session that lasts until the Access session ends, at most 24 hours, as a browser
   session cookie that better-auth does not extend on use (`dontRememberMe`); the next day
   Access decides again. It writes the sign-in to `helena_sign_in_event` (no session without its
   record) and hands the cookie back; the web app redirects to the page asked for.

Sign-out on the public name ends the Access session too (`SSO_LOGOUT_URL` =
`/cdn-cgi/access/logout`), or the Cloudflare sign-in would sign the owner straight back in.
The owner terminal keeps its own TOTP step-up; the tunnel is never "the LAN" (H-09).

**Threat model.**

| Threat | Stopped by |
|---|---|
| An Access assertion (or a copy of one) presented from the home network or by a local process | No entry proof: only nginx's tunnel server block sends it, and only to the web app; the LAN site blanks the header (lan_https.py); the API and the web app on loopback answer 404. The proof lives in root-only files and in the API/web process environment (root and `volition-plan` only). |
| A forged or foreign assertion through the tunnel | Signature, audience, issuer and expiry checked by cloudflared and twice by the API. |
| Access policy widened by mistake (another identity, "everyone") | Helena's own explicit allow list, and the owner role. |
| A stolen assertion replayed through the internet within its lifetime | Needs to pass Access at the edge first (binding cookie on); the session it yields ends with the assertion (≤ 24 h), and the terminal still asks for its code. Keep the Access session short (24 h). |
| Leaked entry proof | Still needs a valid assertion of an allowed identity; `install.sh --apply --rotate entry-token`. |
| Access without a second factor | The UI says it (Access is then the only sign-in); the Access application requires MFA since 2026-09-25. |
| Cross-site request, open redirect | Only same-origin GET navigations bootstrap; redirects stay on the origin (`session-bootstrap.ts`). |
| Silent use | Every Cloudflare sign-in (and refusal that got past the proof: `disabled`, `no_account`, `not_eligible`, `deactivated`) is written with identity, address and browser; Administrator → Sicherheit → Anmeldungen ohne Passwort. Assertions the edge guard refuses are not rows (no verified identity; nginx and the API log them). The LAN owner sign-in is written to the same trail. Rate limit 30/min per client address. |

**Rejected**: nginx passing a verified identity header from `auth_request` (a local process can
send the same header to 127.0.0.1:3000/3001 — the API must verify the assertion itself and needs
a secret only the tunnel entry has); the API trusting `X-Helena-Entry` alone (any LAN client can
set it); a session as long as a password one (7 days, extended on use); better-auth's generic
OAuth/OIDC plugin with Cloudflare Access as an OIDC provider (would need an Access "SaaS" OIDC
application, a client secret and a second login round trip, and it would not bind the session to
the tunnel entry).

## 5. Local HTTPS and the LAN

Owner (2026-09-25): "Wenn ich über die Domain im lokalen Netzwerk reingehe, trotzdem direkt alles
über das LAN wegen der Geschwindigkeit." Decided: **option B with a second name**
(hub/home-access). Option A (the tunnel at home too) stays the fallback: nothing breaks when the
home name is unreachable.

- **Why a second name.** Split horizon under `helena.volition.one` needs a local DNS answer, and
  the Telekom Speedport Smart 4 can neither hold local records nor hand out another DNS server.
  It does allow DNS-rebind exceptions. So the home network gets its own public name,
  **`helena-home.volition.one  A  192.168.2.58`** (Cloudflare DNS, *DNS only*, not proxied), with a
  rebind exception for it on the Speedport. From anywhere else the name leads to a private
  address and nowhere (or to another network's device without Helena's certificate). It reveals
  the LAN address, nothing more.
- **Certificate**: Let's Encrypt DNS-01 through Cloudflare's API with **certbot** and
  `python3-certbot-dns-cloudflare` (Debian 13 packages, Apache-2.0). Debian's lego 4.9 has no
  Cloudflare provider (tried live 2026-09-25), so certbot replaced it. `cloudflare/tls-setup.sh`:
  `token` (the owner pastes it; stored `/etc/helena/cloudflare/dns.token` 0600), `issue` (writes
  certbot's credentials file `/etc/helena/cloudflare/certbot-dns.ini` 0600 from it, lineage named
  after the host, ECDSA P-256, `--also NAME` for extra SANs), `renewal` (Debian's `certbot.timer`
  plus a deploy hook that reloads nginx after `nginx -t`), `check`. The token is never an argument,
  an environment listing or output (selftest). **M-09**: the owner's token is scoped to the zone
  `volition.one` with DNS:Edit, which could also rewrite the company's other records; accepted
  for now, noted (certbot's Cloudflare plugin cannot follow a CNAME to a separate ACME zone; a
  narrower token would need acme-dns or another client).
- **nginx** (`cloudflare/lan_https.py`, dry run by default, backup and `nginx -t` rollback): the
  LAN site listens on 443 (IPv4 and IPv6) with that certificate, HTTP/2 and Mozilla
  "intermediate" TLS (`snippets/helena-tls.conf`); plain http that reached a LAN-facing address
  answers 301 to `https://helena-home.volition.one` with path and query (map
  `$helena_lan_https_redirect` in `conf.d/helena-lan-https.conf`: loopback and the kiosk's
  127.0.0.1:8088 keep their http); HSTS on every https answer that does not bring its own
  (`$helena_lan_hsts` looks at the upstream's header, so the web app's is not doubled); the home
  origin is allowed for the tools and their websockets (`$volition_origin_ok`, CSP of the
  terminal locations); the tunnel entry's proof header is blanked on `/` and `/backend/`. The
  tunnel entry (127.0.0.1:8090) is untouched. The firewall already admits 443 from the home
  network (C-02).
- **LAN auto sign-in** on the home name: `local-owner/configure.py --https-host
  helena-home.volition.one` (existing flag): the capability only for that Host on port 443, from a
  LAN-facing listener, never from loopback, link-local or the machine itself (the guard, the
  IPv6 include and the self map are unchanged; `tests/lan-https-selftest.sh` proves it with a real
  nginx in private namespaces). The kiosk keeps its own http entry.
- **Two origins in the app.** `APP_URL=https://helena.volition.one,https://helena-home.volition.one`
  (the first is primary: links in mails, OAuth redirect URIs, MCP), `HELENA_HOME_URL` names the
  home one; `switch_origin.py --home-host` writes both. Everything a browser uses follows the
  origin the page was opened on: the web server hands out the API and tool addresses rebased onto
  it (`utils/appOrigins.ts`, `serverRuntimeEnv(origin)`; a provisioned tool address on the other
  origin too), the CSP names it, the API trusts both (CORS, better-auth, push), cookies are
  host-only per origin (separate sessions), the terminal routers allow both hosts. nginx's
  `$host` carries no port; a portless Host names the instance origin of that scheme and name.
- **Passkeys** stay bound to `helena.volition.one` (`PASSKEY_RP_ID`): the home name is another site
  for WebAuthn, and binding them to `volition.one` would let every site of the company domain ask
  for them. On the home origin the login page offers no passkey and Konto → Sicherheit says where
  they are added (`features/home-access/passkeys.ts`). (WebAuthn "related origins" would need
  `/.well-known/webauthn` on the public name without Access; not now.)
- **At home, automatically the fast way** (`features/home-access`): on any origin but the home
  one, the app asks `GET /edge/home` (public: the home origin and the instance setting "Zu Hause
  automatisch direkt verbinden", default on) and then probes
  `https://helena-home.volition.one/backend/edge/home/probe` without credentials (1.5 s). Only
  Helena's own answer for that host counts (`{home: true, host}`; through the tunnel the probe
  says `home: false`). Then it continues on the same page there (`location.replace`), where the
  LAN sign-in opens a session. Never a loop (the home origin never switches), a failure pauses
  the check for 10 minutes, `?remote=1` keeps a tab on the public name. Chrome asks once for
  "local network access" (a public page reaching a private address); Safari does not. An
  installed PWA of the public name opens the home name in its in-app browser view.
- **Health**: the audit's `web.https` makes a real TLS handshake with the home name against
  nginx on this machine (chain, name, dates; `curl --resolve`), `tls.certificate` reads certbot's
  lineage (fail under 14 days), `tls.renewal` wants `certbot.timer` and the deploy hook. The API
  reports the certificate as a host health line (`helena.edge.home-https`, plugin `helena.edge`:
  amber under 21 days, red under 7 or when it does not hold), so Start and Administrator → Server
  show it.
- **Dictation/voice** get their secure context at home too.
- `http://kingston-server.local` now answers 301 to the home name (LAN listeners); on loopback
  it stays http for local processes.

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

- **Owner sign-in over IPv6** (the owner's Safari reaches Helena over the home /64):
  `sudo $H/hardening/apply.sh owner-lan6` (dry run: the sync's files, the include it would write,
  whether the geo still lacks the include), then `--apply owner-lan6`. It installs the new
  `helena-lan6-sync` (also the firewall's sets) with its dispatcher and timer, writes
  `/etc/nginx/helena-owner-networks.conf` (`nginx -t`, reload; the old file stays on a failed test)
  and, once, re-runs `local-owner/configure.py` so the geo includes it (owner, capability and origin
  kept; API and web not restarted). Check: from the Mac `curl -6 -g -s -o /dev/null -w '%{http_code}
  %{redirect_url}\n' -H 'Host: kingston-server.local' 'http://[<Kingston's global IPv6>]/'` → a
  303 with a session cookie (`-D -` shows `set-cookie`); on Kingston `curl -6 -g -H 'Host:
  kingston-server.local' 'http://[<its own global IPv6>]/'` → refused (the firewall's self guard),
  `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: kingston-server.local'
  http://127.0.0.1/` → 307 to /login; `audit.sh` `net.local_owner` and `net.self_guard` pass.
  Rollback (IPv6 prefixes off, own addresses stay excluded): `--apply rollback owner-lan6`.

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
Owner first decides on the `codex-home-server` key. `AllowUsers` defaults to the owner plus
`helena-ops` once that account exists (`HELENA_SSH_USERS` overrides), so a later `sshd` run never
drops the automation account.

**6.3a sudo model** (H-07, §8.3; done live on 2026-09-25 by the orchestrator, the step detects it):
1. The owner has a usable password (`passwd`), is in group `sudo`, and `/etc/sudoers` has the
   `%sudo ALL=(ALL:ALL) ALL` rule; `helena-ops` exists with the orchestrator's key in
   `~helena-ops/.ssh/authorized_keys` (the step creates a missing account, never a key).
2. `sudo $H/hardening/apply.sh sudo-model` (dry run: what it would change), then `--apply
   sudo-model`: locks `helena-ops`' password (`passwd -l`), installs
   `sshd_config.d/60-helena-ops.conf` (`sshd -t`, reload), installs `sudoers.d/80-helena-ops`
   (`visudo -cf`, 0440; a live file with the same rule and other comments is left as it is), and
   moves every other `NOPASSWD: ALL` rule in `/etc/sudoers.d` aside into the run's backup (a file
   with other rules too keeps them; only the blanket line is commented out). It refuses before
   changing anything when the owner would lose sudo, and never edits `/etc/sudoers` itself.
3. Check: `ssh helena-ops@kingston-server.local sudo -n true` works with the key; `sudo -k; sudo
   true` asks the owner for his password; `audit.sh` `auth.sudo` pass.
4. Rollback (the owner's rule back; `helena-ops` stays): `sudo $H/hardening/apply.sh --apply
   rollback sudo-model`.

**6.4 Units** (a quiet moment, no chat answer or run in flight):
`--apply units` (API, web, worker one by one with health checks), `--apply terminal-key`,
`--apply kasm-loopback` (restarts the five project browsers). `audit.sh` svc.exposure < 6.

**6.5 Local HTTPS**: superseded by §6.10 (the home network's own name, certbot instead of lego).

**6.6 Tunnel** (owner + orchestrator together):
1. Owner's OK for cloudflared; owner reads the key fingerprint from Cloudflare's package docs.
   `sudo $H/cloudflare/install.sh --apply package --fingerprint <FPR>`.
2. Owner creates the tunnel (§7) and runs `sudo $H/cloudflare/install.sh --apply token`.
3. `sudo $H/cloudflare/install.sh --apply service` → "connector ready". It creates the user
   `helena-tunnel` and, since hub/home-access, adds it to the firewall's uid sets at once
   (`hardening/apply.sh --apply firewall-uids`, live table and installed ruleset). On
   2026-09-25 the firewall had been loaded before the user existed: `tunnel_uids` held root alone,
   cloudflared got "connection refused" and the owner Cloudflare's 502, while the installer's own
   check (as root) passed. The check now runs as `helena-tunnel`, and `audit.sh tunnel.acl` fails
   when the user's uid is missing (`why=user`).
4. `sudo $H/cloudflare/install.sh --apply nginx` → the self-check (as `helena-tunnel`) must say
   403 without Access; `install.sh check` shows the connector's edge connections and origin
   errors (cloudflared metrics).
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

**6.10 Home network access and the Cloudflare sign-in** (hub/home-access; §4.8, §5). Done by
the orchestrator before: certbot 4.0 + python3-certbot-dns-cloudflare installed, the owner's DNS
token in `/etc/helena/cloudflare/dns.token`, the record `helena-home.volition.one A 192.168.2.58`
(DNS only) and the Speedport's rebind exception, the Let's Encrypt terms accepted for
`wilhelmpa@gmail.com`, MFA required by the Access application. Every step without `--apply` is a
dry run; run it first.

1. Merge hub/home-access and run `deploy.sh` (migration **0185** `helena_sign_in_event`; API,
   web, worker restart). Nothing changes for anyone yet: the sign-in switch is off, no home
   origin is set. Then install the new audit: `sudo $H/hardening/audit.sh --install-timer`.
2. Certificate:
   ```sh
   sudo $H/cloudflare/tls-setup.sh check
   sudo $H/cloudflare/tls-setup.sh issue --email wilhelmpa@gmail.com --accept-letsencrypt-terms
   sudo $H/cloudflare/tls-setup.sh --apply issue --email wilhelmpa@gmail.com --accept-letsencrypt-terms
   sudo $H/cloudflare/tls-setup.sh --apply renewal
   sudo certbot renew --dry-run --cert-name helena-home.volition.one
   sudo $H/cloudflare/tls-setup.sh check     # until … (~89 days), certbot.timer active, hook present
   ```
3. HTTPS on the LAN:
   ```sh
   sudo python3 $H/cloudflare/lan_https.py            # the diff
   sudo python3 $H/cloudflare/lan_https.py --apply    # nginx -t, reload; old files back on refusal
   ```
   From the Mac: `dig +short helena-home.volition.one` → 192.168.2.58;
   `curl -sS -o /dev/null -w '%{http_code} %{http_version}\n' https://helena-home.volition.one/backend/edge/home/probe`
   → `200 2`; `curl -sI http://helena-home.volition.one/x` → 301 to `https://helena-home.volition.one/x`.
4. Origins and the tunnel entry's proof (no restart in this step):
   ```sh
   sudo python3 $H/cloudflare/switch_origin.py --home-host helena-home.volition.one
   sudo python3 $H/cloudflare/switch_origin.py --apply --home-host helena-home.volition.one
   sudo $H/cloudflare/install.sh entry-token
   sudo $H/cloudflare/install.sh --apply entry-token
   sudo $H/cloudflare/install.sh nginx                # diff: the headers snippet sends the proof
   sudo $H/cloudflare/install.sh --apply nginx        # self-check as helena-tunnel: 403
   ```
5. The LAN sign-in on the home name, at a quiet moment (no chat answer or run in flight): it
   restarts API and web itself, which then read the new origins and the proof.
   ```sh
   sudo python3 $H/local-owner/configure.py --https-host helena-home.volition.one
   sudo systemctl restart volition-terminal
   sudo systemctl restart volition-owner-terminal   # with the owner's OK if it ends his sessions
   ```
6. Checks:
   ```sh
   sudo $H/cloudflare/install.sh check    # entry proof present (0600); reachable as helena-tunnel (403); connector
   sudo $H/hardening/audit.sh | grep -E 'web.https|tls\.|tunnel\.|local_owner'   # all pass
   ```
   Headless from the Mac: `https://helena-home.volition.one` opens signed in without a password
   (a new private profile), no console errors; Administrator → Sicherheit shows the home name
   under "Zu Hause automatisch direkt verbinden", Administrator → Server → Übersicht "HTTPS zu
   Hause". In a normal browser at home: `https://helena.volition.one` → Access → the page
   continues on `https://helena-home.volition.one/…` (Chrome asks once for local network access).
   The password + authenticator code sign-in on either name (test user or the owner); then set
   the owner's `two_factor_enabled` back to true.
7. The Cloudflare sign-in: Administrator → Sicherheit → Zugang von außen → "Erlaubte
   Identitäten" `wilhelmpa@gmail.com`, switch "Mit der Cloudflare-Anmeldung direkt bei Helena
   anmelden" on → Speichern. From outside (phone on mobile data): `https://helena.volition.one` →
   Access with its second factor → Helena opens without its own password; Sicherheit →
   Anmeldungen ohne Passwort lists "Cloudflare · wilhelmpa@gmail.com"; Abmelden ends at Access's
   logout page. (Without a browser: `sudo -u postgres psql -d itsaplan -c "update app_setting set
   value = jsonb_set(value, '{signIn}', 'true') where key = 'edgeAccess'"`, read within 10 s.)

Rollback: the switch off (UI, or the same `jsonb_set` with `false`); `switch_origin.py --apply
--no-home`, `configure.py --lan-http` (or `--https-host helena.volition.one`), `lan_https.py
--apply --rollback`, restart API, web and both terminals. A leaked proof: `install.sh --apply
--rotate entry-token`, restart API and web. The certificate stays (certbot renews it harmlessly)
or `certbot delete --cert-name helena-home.volition.one`.

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
2. **At home: tunnel (A) or split horizon (B)?** Decided 2026-09-25 (owner): B, with its own name
   `helena-home.volition.one` (the Speedport has no local DNS; §5). A stays the fallback.
3. **sudo model** (H-07): **decided and live (2026-09-25)** — a separate `helena-ops` account for
   the orchestrator's SSH automation (NOPASSWD, key-only, LAN-only, password locked) and a sudo
   password for `wilhelmpa`, so the browser terminal and the AI CLIs in it need the password for
   root. In the repo as `apply.sh sudo-model` (§6.3a); `audit.sh` `auth.sudo` passes only in that
   shape and warns for any other account with `NOPASSWD: ALL` (`why=others`) or a `helena-ops` whose
   password is not locked or whose SSH is not key-only (`why=ops`, `problem=password|ssh|both`).
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
| ACME | certbot + python3-certbot-dns-cloudflare (Debian 13, Apache-2.0; renewal by Debian's certbot.timer, deploy hook) | lego (Debian's 4.9 has no Cloudflare provider; its CNAME following would allow a narrower token — revisit with a newer lego), acme.sh (shell, no Debian package) |
| Edge single sign-on | A better-auth plugin endpoint (`/sign-in/edge`) that turns the verified Access assertion into a session, gated by a tunnel-entry secret | better-auth genericOAuth with Access as an OIDC "SaaS" app (extra client secret and round trip, not bound to the tunnel entry); trusting an nginx identity header (forgeable locally) |
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

### Verification (2026-09-24/25, no live change)

- `tests/nft-selftest.sh` (private network namespace, no root): the ruleset loads; the self guard
  refuses LAN-address → 127.0.0.1:80 and → own address, loopback stays open; a home-network peer
  reaches :22, an outside peer does not, :8384 is dropped from the LAN; the network sync follows a
  new IPv4 network and the machine's /64. All pass.
- `tests/nginx-owner-guard-selftest.sh` (throw-away nginx, fake capability): the old map gives the
  capability to both local shapes (C-01 proven), the guard gives it to neither, and the Mac on the
  LAN still gets it. All pass.
- `tests/nginx-config-selftest.sh`: `nginx -t` of the live LAN site after `lan_https.py` + the guard,
  together with the tunnel entry. Passes.
- `tests/owner-lan6-selftest.sh` (private network namespaces, a throw-away nginx with the owner map
  exactly as `configure.py` writes it, the guard, and the include `helena-lan6-sync` renders from the
  namespace's addresses; no firewall, so nginx's layer alone): LAN clients over IPv4, over IPv6 in
  the home /64 and to the machine's second address get the capability; another Host, a client
  outside the home /64 and a ULA the LAN interface does not have do not; the machine itself never
  does — loopback, `::1`, own IPv4 to itself and to 127.0.0.1, own IPv6 to itself and to `::1`,
  one own IPv6 address to another, link-local to its GUA, own ULA; a ULA the LAN interface has
  counts; the control without the own-address lines gives the capability to one own address
  talking to another (the hole those lines close). `tests/nft-selftest.sh` adds the IPv6 self
  guard (own GUA → `::1` and → itself refused, `::1` open). `tests/test_lan6_sync.py`: the
  rendering, the write/test/restore path, the owner map, and the audit's IPv6 check. All pass
  (2026-09-25).
- `tests/sudo-model-selftest.sh` (private user + mount namespace, scratch sudoers/sshd folders, fake
  passwd/sshd/systemctl/useradd/id/getent, the real visudo): dry run changes nothing; `--apply`
  locks the account, installs both files, moves the owner's rule aside, `visudo -c` passes and
  `auth.sudo` passes; a second run is a no-op; a hand-made equal rule is kept; rollback restores the
  owner's rule; a mixed file keeps its other rules; refusals (owner without password, no key)
  change nothing; the audit's `why`/`problem` cases. All pass (2026-09-25).
- Tunnel entry end to end (throw-away API of this branch + nginx from the template): page, API,
  forged assertion, a client-sent LAN capability, code, browser, both terminals and the sign-in
  endpoint all answer 403 without Access; the API says `edge_not_configured`.
- API: `edge-access` unit and integration tests, `auth-verify`, agent socket, owner terminal, the
  dump modes, cookie domain; the full API suite against the known baseline.
- Web: tsc, eslint, prettier; `checks.test.ts` (keys, order, all 10 locales); click check on a
  throw-away dev instance with the live audit report: Administrator → Sicherheit on desktop and at
  390 px (no horizontal scroll), invalid team domain refused with the API's message, valid one saved
  ("Eingerichtet"), no console errors besides the deliberate 400.
- Every `apply.sh` step as a dry run on Kingston (writes nothing; renders go to a scratch folder).

### hub/home-access (2026-09-25)

- **Home network name**: `cloudflare/tls-setup.sh` on certbot (lego units removed),
  `lan_https.py` (443, HTTP/2, redirect map, HSTS map, proof blanked; `conf.d/helena-lan-https.conf`),
  `switch_origin.py --home-host/--no-home` (+ `SSO_LOGOUT_URL`), tests
  `cloudflare/tests/test_cloudflare_scripts.py`, `lan-https-selftest.sh` (private namespaces,
  real nginx, throw-away CA), `scripts-selftest.sh` (install.sh entry-token and tls-setup.sh with
  fakes), fixture `tests/fixtures/lan-site.conf` (the live LAN site, no secret in it).
- **Tunnel entry proof**: `install.sh entry-token [--rotate]` (env file, volatile nginx map to the
  web upstream only, drop-ins), `helena-tunnel-headers.conf`; `install.sh service` adds the tunnel
  user to the firewall and checks the entry as that user; `check` reports proof and connector.
- **Hardening**: `apply.sh firewall-uids`; `audit.sh` `web.https` (TLS handshake with the home
  name), `tls.*` on certbot, `tunnel.acl` with the uid check (`HELENA_AUDIT_ONLY=tunnel.acl`);
  `tests/firewall-uids-selftest.sh`; `nginx-config-selftest.sh` for the new site.
- **Auth**: `packages/auth` `edge-sign-in.ts` (endpoint, verifier seam, session ≤ 24 h, not
  extended), `sign-in-events.ts` (trail, pruned after half a year), the LAN sign-in written too;
  migration 0185 `helena_sign_in_event`.
- **API**: edge settings `signIn`, `homeAutoConnect`; `GET /edge/home`, `GET /edge/home/probe`,
  `GET /god/security/sign-ins`; the verifier (`edge-access/sign-in.ts`); host capability
  `helena.edge.home-https` (internal plugin `helena.edge`).
- **Web**: `utils/appOrigins.ts` (origins, request origin, rebasing), origin-aware runtime env and
  CSP, `lib/edge-sign-in-session.ts` and `session-bootstrap.ts` (shared with the LAN sign-in),
  `features/home-access` (auto switch, passkeys on the home origin), Administrator → Sicherheit
  (two switches, the trail), 10 locales; `AuthLoginForm.test.tsx` covers password + authenticator
  code (the owner lock-out of 2026-09-25).

## 12. Open points

- hub/server-admin: register `securityHealth()` (status.ts, shaped like `HostHealthItem`) as a host
  capability in area `security`, mount `SecurityStatusSections` as the tab, and give helena-hostd a
  method `io.helena.hostd.SecurityAudit` that runs `/usr/local/libexec/helena-security-audit
  --json-file /var/lib/helena-security/audit.json` for a "Neu prüfen" button.
- The rename (package G) must carry `volition-*` names in the scripts' defaults
  (`HELENA_API_UNITS`, paths). The guard map is rename-safe: its output is
  `$helena_owner_capability`, and the kit's rule `volition_local_owner_token` →
  `helena_local_owner_token` rewrites its input consistently (checked against `rename-map.json`).
- The kiosk under the HTTPS origin needs its own TLS listener (it is off now): with the home name
  its 127.0.0.1:8088 http entry keeps the capability, but the web app's LAN sign-in answers only
  on the configured origin (`https://helena-home.volition.one`).
- A narrower DNS token (M-09) needs a client that follows a CNAME on `_acme-challenge`.
- Passkeys on the home name: WebAuthn related origins (`/.well-known/webauthn` on the public name,
  outside Access) if the owner wants passkeys there too.
- The auto switch uses Chrome's local network access permission; a PWA installed from the public
  name leaves its scope for the home name (in-app browser bar on iOS).
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
