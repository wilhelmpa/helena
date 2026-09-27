# Decision: the notes (SilverBullet as "Notizen")

> Owner correction, 2026-09-27: no Notes domain. The ordinary file/note frontend is now
> Helena's shared Files view on the same canonical vault. The domain/iframe deployment and
> acceptance instructions below are historical, not prerequisites for this release. Existing
> service/data are retained; do not apply these historical remote instructions. See
> [current scope](vault-within-helena-2026-09-27.md). Full SilverBullet frontend parity is open.

Status: decided by the owner 2026-09-26 ~00:20 ("SilverBullet als Notizen-UI in Helena"), ~00:25 ("dann Obsidian ganz weg"). Built on `hub/notes-silverbullet`. Everything below was checked on 2026-09-25/26 against SilverBullet's source (tag `2.11.1`, commit 1340f73), its documentation, the release assets, and by running the release binary on a scratch vault on Kingston (plain, sandboxed with systemd, and behind the rendered nginx entry).

**In one paragraph:** SilverBullet 2.11.1 (MIT, one static Rust binary) serves Helena's vault as the tool "Notizen". It runs on **an origin of its own**, never under Helena's: every page of a space may carry script that runs in the viewer's browser, and agents write into the vault. The owner reaches it at home on `https://helena-home.volition.one:8446` (his Helena session is the key) and from outside on `https://helena-notes.volition.one` (Cloudflare Access; owner step). The service has no network, sees neither `Private/` nor the vault's git history, has no shell, and listens on a Unix socket only nginx can reach. Obsidian is gone as a product concept; Syncthing stays as plain file sync ("Geräte").

## 1. SilverBullet today (research)

| Question | Finding |
|---|---|
| Release, licence | 2.11.1 of 2026-09-22 (2.11.0: 09-17, 2.10.0: 07-28; about monthly). MIT. ~6k GitHub stars, active daily. |
| Runtime | Since 2.x a **Rust** server (`bin/silverbullet`, axum) with the TypeScript client embedded: `silverbullet-server-linux-x86_64.zip` 15.7 MB → one statically linked 50 MB binary. No Deno, no Node, no Docker needed. A separate `sb` CLI exists (not used). |
| Modes | **Multi-space** (default for new installs since 2.10: `spaces.json`, `users.json` with an admin, dashboard at `/.dashboard`, TCP only) and **single-space** ("legacy", `--single` or any `SB_*` legacy variable: one folder, configured by environment, no accounts, supports `SB_UNIX_SOCKET`). Single-space is now a thin synthesis on the multi-space engine (one code path, `bin/silverbullet/src/single.rs`). |
| Auth options | Own accounts (argon2), OIDC SSO, bearer tokens, or an **authentication proxy** in front ("pair a proxy with public spaces so the proxy owns identity"; exempt `/service_worker.js` and `/.client/*`). |
| What it writes into the space | On start nothing, when the space has a Markdown file (`seed_index` only fills an empty space). Each save: a hidden sibling `.<name>.sb-write-<pid>-<n>` renamed over the file (atomic; new inode, owner = the service). Once per start: `.sb-case-probe-<pid>-<n>` in the root (created and removed). Optional: `CONFIG.md` (settings page), `Library/` (libraries), `.silverbullet.auth.json` / `.silverbullet.browser-sessions.json` only with its own auth (not used). The standard library is served from the binary, not written. |
| Git | `SB_REVISIONS=managed|unmanaged|disabled` (single-space default: unmanaged = read history, never commit). |
| Obsidian conventions | `[[wikilinks]]` resolve **by name** since 2.11 (Obsidian's shortest-name links work unchanged), `[[x|alias]]`, `#heading`, `![[embed.png]]`, YAML frontmatter (tags as list or words). Templates are SilverBullet's own (Space Lua); Helena's `{{date}}` templates are ordinary pages there. |
| Outside changes | A native watcher (inotify via `notify`) or `SB_FS_WATCH=poll` (`SB_FS_POLL_INTERVAL`); open editors get the change in place, three-way merge, conflict markers when both sides touched the same words, `name.conflicted-<hash>.ext` for binaries. **The native watcher gives up entirely at the first unreadable folder** (verified: `Private/` or an inaccessible `.git` → "Not starting fs watcher: Permission denied"). |
| Size | Live vault 16 MB, 156 files, 14 Markdown notes (2026-09-25). The server is light (a few hundred MB RAM at most); indexing runs in the browser (IndexedDB). Poll mode stats every file each pass. |
| PWA, phone | Offline-first PWA over HTTPS (service worker, IndexedDB copy of the space). Over plain LAN http: online only. Works on phones; installable. |
| Plugs/libraries | The standard library is built in. Community libraries (Silversearch full-text search, Excalidraw, Mermaid, PDF) install via the server's `/.proxy` fetch, which Helena closes (§3). **Full-text search is not built in** since 2.x (a library); page names are searchable with Cmd-K, Helena's own search covers content. |
| JSON Canvas | Not supported (no plug in the standard repository); a `.canvas` file would open as raw JSON. Helena's boards stay in Helena's board view; the notes hide `*.canvas`. |
| UI language | English only. |

**Alternatives (short):** Obsidian cannot be embedded (desktop/mobile app, no web server). Logseq's file graphs have no server; AFFiNE, Docmost, SiYuan, Trilium, AppFlowy, Outline were rejected in `second-brain.md` §1 (licence, second truth, not files). Helena's own editor (TipTap) stays for Docs and tasks; SilverBullet adds the full note-taking UI on the same files. SilverBullet with its own accounts (multi-space) would mean a second login and a TCP listener; see §2.

## 2. Mode: single-space behind nginx

- **Single-space mode (`--single`)** on `/srv/volition/vault`, no own auth, on a **Unix socket** `/run/helena-notes/notes.sock` in a `2750 helena-notes:www-data` folder: only nginx can connect, no loopback port exists for another local user (the owner-terminal pattern).
- Multi-space would need a `users.json` admin (an unused credential), a TCP port (a loopback ACL in the firewall), and nginx must hide the dashboard; its "public space behind a proxy" is the same trust model. It stays the migration path if a later release drops single-space (the installer pins the version; an update is re-checked against this document).
- Settings, all in the unit: `SB_SHELL_BACKEND=off` (single-space **enables** the shell by default), `SB_RUNTIME_API=0` (the headless-Chrome runtime; `/usr/bin/chromium` exists on Kingston and would be picked up), `SB_REVISIONS=disabled` (Helena versions the vault; the service cannot see `.git`), `SB_FS_WATCH=poll` every 5 s (the native watcher stops at `Private/`), `SB_SPACE_IGNORE=/Private/ *.canvas *.sync-conflict-*` (listing only, see §3), `RUST_LOG=…notify=error` (the poll warns about the unreadable folders on every pass), `SB_INDEX_PAGE=ordner:Home`.
- The notes' settings page `CONFIG.md` (vault root, written once by the installer, the owner may change it): journal in `Home/Docs/Journal/` (the same file as Helena's daily note, `packages/knowledge` `DAILY_NOTES_FOLDER`), links written with the shortest name, the file tree docked left, a virtual page `ordner:<folder>` (a folder's notes, newest first; Helena opens a project's notes on `ordner:Projects/<KEY>`), and `[[KEY-12]]` pages that link to the task in Helena. Helena's index ignores `CONFIG.md` and `Library/` at the root and SilverBullet's temporary files (`packages/vault` `isIgnoredPath`).

## 3. Security

What was found by running it (scratch vault, `tests/install-selftest.sh` repeats it):

1. **Every page's script runs.** A ```` ```space-lua ```` block in *any* page is evaluated on every load of the notes (not only when that page is opened), and `${…}` expressions run while rendering. Both reach the browser through `js.window` (fetch, DOM, other windows). Verified: a block in `Projects/VOL/Docs/` ran on opening another page. `?disableSpaceLua=1` skips only the blocks, not the expressions. Agents write into the vault (their project folders, Home), and a prompt-injected agent can write such a block.
   → **Consequence: never under Helena's origin.** At `https://helena…/notes/` the script would act with the owner's session: read everything, create API keys, approve its own actions, open the owner terminal. A CSP path restriction does not help (same-origin windows script each other).
2. **`SB_SPACE_IGNORE` hides from the listing only.** `GET /.fs/Private/…`, `/.fs/.git/config`, `/.fs/.obsidian/…` answered 200, and `PUT /.fs/.git/hooks/x` wrote into the vault's git folder (a `.git/config` with `core.fsmonitor` would run as the API user on the next commit).
3. **`/.proxy/<url>`** fetches any URL from the server (SSRF, a way out past the browser's CSP).
4. SilverBullet's own cross-origin check applies only to requests carrying *its* session cookie; behind a proxy there is none.

The design against them, layer by layer:

| Layer | What it does |
|---|---|
| **Own origin** | Home: `https://helena-home.volition.one:8446` (the home name's certificate, a second port = another origin). Tunnel: `https://helena-notes.volition.one` (a name of its own; tunnels publish on 443 only). |
| **Owner check** | nginx `auth_request` → API `GET /auth/verify/notes` (`apps/api/src/modules/notes/verify.ts`): at home the owner's Helena session (a host-only cookie reaches every port of the name); through the tunnel a valid Cloudflare Access assertion whose e-mail is the owner's (`god`, active) Helena account. Never an API key. 401 shows a small sign-in hint. |
| **nginx allow list** (`helena-notes-common.conf`) | Only the client code (`/.client/`, `/service_worker.js`, without a session as SilverBullet asks), the pages, `/.fs` (never a path with a dot segment, never `Private/`, any method), `/.config`, `/.events`, `/.ping`, `/.accounts`. Everything else of SilverBullet's (`/.shell`, `/.proxy`, `/.runtime`, `/.revisions`, `/.dashboard`, `/.auth`, `/metrics`) is 404. No cookie, `Authorization`, API key or Access assertion reaches SilverBullet; `Set-Cookie` from it is dropped (a cookie on the home name would reach Helena's port). |
| **CSP on every answer** | `connect-src 'self'` (a note's script may not fetch Helena's origin or anywhere else; verified: the exfiltration fetch is blocked, editing works), `img-src 'self' data: blob:`, `form-action 'self'`, `frame-ancestors` = Helena's two origins, `object-src 'none'`. |
| **API cross-site guard** | `apps/api/src/shared/cross-site.ts`: a state-changing request (`POST/PUT/PATCH/DELETE`) that carries a cookie, is marked `Sec-Fetch-Site: same-site` or `cross-site`, and whose `Origin` is not one of Helena's own (`APP_URL`) is refused (403 `cross_site_refused`). Helena's own origins stay allowed because a development setup or a split deployment runs the web app and the API on two origins of one site (found in the dev check: the sign-in from `localhost:25591` to `localhost:25590`). This is the Fetch Metadata defence from OWASP's CSRF cheat sheet. The notes' port and every other `*.volition.one` name are *same-site* with Helena, and SameSite=Lax cookies ride along on same-site requests. Helena's own pages call their own origin; servers, agents and webhooks send no such header. This also closes the same gap for the domain's other sites. |
| **systemd sandbox** (`helena-notes.service`) | Own user `helena-notes` (+ group `volition` for the vault's modes and ACLs, **not** `volition-private`). `PrivateNetwork=yes`, `RestrictAddressFamilies=AF_UNIX` (the proxy cannot reach anything; verified), `TemporaryFileSystem=/srv:ro` + `BindPaths=` the vault, `InaccessiblePaths=` the vault's `.git`, `Private`, `.trash`, `.stversions` and `/etc/volition /etc/helena /var/lib/volition /var/lib/helena /var/backups`, `ReadOnlyPaths=` `.gitignore .stignore .stfolder`, no capabilities, `NoNewPrivileges`, `MemoryDenyWriteExecute`, `SystemCallFilter=@system-service`, `ProtectSystem=strict`, `ProtectHome`, `MemoryMax=512M`. Verified with a transient unit: Private/ and `.git` 404, writes to `.git`/`.gitignore` fail, proxy fails, normal writes land as `0660` with the vault's group. |
| **Audit** | `hardening/audit.sh` check `svc.notes` (sandbox properties, socket folder, no TCP listener, the owner check and path rules in every entry); `net.listeners` allows nginx on 8446. Worded in 10 locales. |

What remains (known, accepted): a note's script still runs in the notes' own origin. It can read and change every note the notes show (all of the vault except `Private/`), which crosses the projects' agent isolation while the owner has the notes open, and it can leave by top-level navigation (CSP cannot stop that). It can set cookies on the home name (document.cookie; the session cookie is HttpOnly and host-only, so the worst is disturbing the owner's session). Treat notes written by agents like mail from outside: the notes are the owner's editor, not a sandbox.

## 4. Provenance

The notes write as their own account and replace each note with a new file. The worker's watcher therefore knows a change the notes made: the file belongs to `helena-notes` **and** was born with its last change (birth time within 2 s of mtime; an agent's later in-place edit keeps the owner but not the birth, verified on Kingston: 7 ms vs 7.7 s). Such changes are indexed with `last_author = 'notes'` and committed as author "Notizen" with the trailer `Helena-Actor: notes`; everything else from outside stays `extern` (`packages/vault/src/writers.ts`).

## 5. In Helena

- The panel tool `notes` (`extensions/panelTools.tsx`, icon NotebookPen, between Code and Browser, in the header, per project) is a frame of the notes' origin opened on `ordner:Projects/<KEY>` (Home: `ordner:Home`). It is offered only where this origin has an address for the notes (`HELENA_NOTES_URLS`, `utils/runtimeEnv.ts` `notesUrl`; `PanelTool.available`, asked after hydration so the server's render and the browser's agree). Helena's CSP `frame-src` includes the notes' origin (`workspaceFrameOrigins`).
- "In Notizen öffnen" (new tab) in Docs' note menu, the Files viewer and menu, and a task attachment's viewer (`utils/vaultLinks.ts` `notesFileUrl`: never `Private/`, hidden paths, boards or names SilverBullet refuses).
- **Naming:** the project sidebar called the sticky-note boards "Notizen" too. They are now "Boards" in the sidebar and the feature switches (their own pages already said "Board"; 10 locales), so "Notizen" means one thing: the Markdown notes (as Docs already used the word).
- Checked in a dev stack (web 25591, API 25590, SilverBullet 25592; headless Chrome): the header button, the frame on the project's folder page with the file tree, the Docs menu link, the phone overflow menu (no horizontal scroll at 390 px), the Devices page wording; Helena's own console clean. SilverBullet's frame logs a 404 and "Not found" each time it opens a virtual page (`ordner:…`): it asks for a file of that name first. That is SilverBullet's own behaviour, inside its frame.

## 6. Obsidian removed (owner 2026-09-26: "dann Obsidian ganz weg")

- UI (10 locales): "Geräte & Obsidian" → "Geräte"; "In Obsidian öffnen" → "In Notizen öffnen" (Files, Docs, attachments; only where this origin has the notes and the file is not in `Private/`, not a board, not hidden); the Devices page describes plain file sync.
- Code: no `obsidian://` links, no `OBSIDIAN_VAULT_NAME`, the knowledge API's `obsidianUrl` field is gone; `packages/knowledge` no longer seeds or reads `.obsidian/daily-notes.json` / `templates.json` (the daily note is `Home/Docs/Journal/YYYY-MM-DD.md` from `Templates/Tagesnotiz`); `syncthing/vault-defaults.sh` writes no Obsidian settings and makes Syncthing ignore `/.obsidian` (an Obsidian left on a device cannot bring its folder back); `vault-setup.sh` ignores `/.obsidian/` in git. Hermes' bundled `obsidian` skill was already disabled by agent-tuning.
- Kept on purpose: the Markdown dialect (wikilinks, frontmatter, the JSON Canvas format) and code comments that name where a convention comes from; the index still skips a `.obsidian/` folder should one appear.
- The live vault's `.obsidian/` (4 small JSON files) moves to the delete folder: `notes/install.sh --apply obsidian-leftovers`. The empty `Home/Journal/` (Obsidian's old daily folder) can go with it by hand.
- History: `second-brain.md` §1/§7 and `volition-konzept-wissen-zugaenge-mail.md` D2 describe the Obsidian era.

**Syncthing ("Geräte")** existed for Obsidian (concept D2), but it is plain file sync and still useful: offline copies on Mac and phone, files for other apps, a second copy. The notes' PWA covers writing offline. Proposal: keep it as "Geräte"; whether to keep the service at all is the owner's call.

## 7. Runbook (orchestrator, root via `helena-ops`)

Preconditions: this branch merged and deployed (`deploy.sh`: API with `/auth/verify/notes` and the cross-site guard, web with the tool, worker with the ignore rules). The download needs the owner's OK (16 MB from GitHub, sha256 pinned in `release.env`).

```sh
N=/srv/volition/source/plan/deployment/volition-stack/native/notes
sudo $N/install.sh check                          # nothing installed yet
sudo $N/install.sh binary                         # dry run: URL, checksum, target
sudo $N/install.sh --apply binary                 # /opt/helena/notes/2.11.1, current → it
sudo $N/install.sh service                        # dry run: user, unit diff, CONFIG.md
sudo $N/install.sh --apply service                # starts helena-notes; prints socket + "Private/: not visible"
sudo $N/install.sh --apply nginx-home             # :8446 entry, nginx -t + reload (rollback on failure), opens 8446 in nftables
sudo $N/install.sh --apply web                    # HELENA_NOTES_URLS drop-in for volition-plan-web
sudo systemctl restart volition-plan-web          # the web app reads it (no agent run depends on the web process)
sudo $N/install.sh check                          # every line as expected
sudo /srv/volition/source/plan/deployment/volition-stack/native/hardening/audit.sh | grep -E 'svc.notes|net.listeners'
sudo $N/install.sh obsidian-leftovers             # dry run: lists .obsidian/
sudo $N/install.sh --apply obsidian-leftovers     # moves it to /var/backups/helena-zum-loeschen/<date>/
```

No in-flight check is needed for these steps: nothing touches the API, the worker or the runner (only nginx reloads and the web app restarts). Deploying the branch itself follows the usual rule (merge and `deploy.sh` back to back, `agent_run` pending = 0 and no streaming chat). After a deploy of this branch re-run `syncthing/setup.sh` (deploy.sh does when its folder changed) so `.stignore` gets `/.obsidian` and the notes' temporary files, and `vault-setup.sh` once for the new `.gitignore` line.

Checks in the owner's browser (headless driver on the Mac: `HL_BASE=https://helena-home.volition.one:8446`): Start → header "Notizen" opens `ordner:Home`; a project opens `ordner:Projects/<KEY>`; typing into a note shows up in Helena's Docs within seconds and in the vault's git history as author "Notizen"; Files → "In Notizen öffnen" opens a new tab; console free of errors.

Through the tunnel (owner first): in Cloudflare Zero Trust add `helena-notes.volition.one` as a public hostname of the tunnel `helena-kingston` (service `http://127.0.0.1:8090`, "Protect with Access" on), and add the same hostname as a destination of the existing Access application "helena" (**the same application**, so its audience is the one Helena checks). Then:

```sh
sudo $N/install.sh --apply nginx-tunnel           # server block on 127.0.0.1:8090 for helena-notes.volition.one; answers 403 without Access
sudo $N/install.sh --apply web && sudo systemctl restart volition-plan-web
```

Rollback: `sudo $N/install.sh --apply remove` (stops the service, removes the entries and the web setting; notes, binary and unit file stay), then restart the web app.

Upgrades: bump `release.env` (version + both sha256 from the release page) after re-checking §1–3 against the new release, run `tests/install-selftest.sh --e2e <new binary>`, then `install.sh --apply binary` and `systemctl restart helena-notes`. A later step: an `UpdateSource` for the update center.

## 8. Open

- Owner decisions: the tunnel name (and the Cloudflare steps); `Private/` stays outside the notes (recommended; a separate private notes space on a third origin would be possible); keep Syncthing.
- Not verified live: the systemd sandbox as a system unit (verified as transient user units: the SilverBullet binary under the unit's restrictions, and `TemporaryFileSystem` + `BindPaths` + the nested `InaccessiblePaths` with a shell; not verified: `User=`, `SupplementaryGroups=`, the `ExecStartPre=+` socket folder), the nginx entry with the real certificate and nftables, the Access-assertion path end to end, the iframe inside Helena's panel on both origins, SilverBullet's service worker behind Cloudflare Access.
- Later: a SilverBullet `UpdateSource`; the English UI of SilverBullet; full-text search inside the notes (a library needs `/.proxy`; it could be vendored into `Library/` after review).
