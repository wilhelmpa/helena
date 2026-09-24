# Standards quick wins (`hub/standards-quickwins`)

Status: in progress, 2026-09-24. Scope: the backlog in `docs/helena-decisions/standards-audit.md` §5.1 (on `hub/standards-audit`). The research and the choice of library are the audit's; this file records only what was built per item, and every place where the implementation deviates from the audit's recommendation, with the reason.

| ID | State | Commit | Notes |
|---|---|---|---|
| F21 | done | see git log | `ipaddr.js` 2.5.0 (MIT) |
| F07 | done | see git log | no library; SDK 1.30 transport kept for POST |
| F15 | done | see git log | Bun `S3Client` (built in); `@aws-sdk/client-s3` removed |
| F17 | done | see git log | `papaparse` 5.7.0 (MIT) |
| F18 | done | see git log | `read-excel-file` 9.3.10 (MIT); `write-excel-file` 4.1.1 (MIT) for test fixtures |
| DB-2 | done | see git log | no library: `escapeLike`/`containsPattern` in `@repo/db` |
| BRW-01 | done | see git log | `ws` 8.21.3 (MIT) |
| BRW-03 | done | see git log | `mp4box` 2.4.1 (BSD-3), test only |
| F16 | done | see git log | `mime-types` 3.0.2 + `file-type` 22.1.1 (MIT) in `@repo/storage/mime` |

## F21: IP classification with `ipaddr.js`

- `packages/net` keeps its DNS pinning, redirect refusal and limits. Only the question "which addresses are refused" moved to `ipaddr.js` `range()` (IANA special-purpose registries).
- Two tiers remain, as the audit describes them:
  - **every fetch** (`isPrivateIp`): unspecified, loopback, RFC 1918, link-local (the whole `fe80::/10`, which the old prefix check covered only for `fe80:`), CGNAT, unique-local, and now also NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`), SIIT (`::ffff:0:0:0/96`), 6to4, Teredo, site-local `fec0::/10`, `192.0.0.0/24` and `198.18.0.0/15`.
  - **public-only** (link previews): every address `ipaddr.js` does not classify as plain `unicast`, and IPv6 outside `2000::/3`.
- Deviation, on purpose: the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) stay allowed outside public-only. They are unroutable, so there is no SSRF in them, and the API's mail tests use `203.0.113.10` as a stand-in public mail host.
- Side effect (a fix): public-only used to refuse all of `192.0.0.0/16`, which includes real public hosts such as `192.0.78.9` (WordPress). Now only the two special /24s are refused. The anycast ranges AS112 and AMT are now refused under public-only; they are not link-preview targets.

## F16: one MIME module, magic numbers on uploads

- **Module:** `@repo/storage/mime` (`packages/storage/src/mime.ts`). Files are the storage package's subject, and the API, the worker, the vault and mail already depend on it or now do; a new package for three functions was not worth it.
  - `mimeFromName()`: `mime-types` (mime-db), plus five overrides that keep the old answers where mime-db differs (`.canvas` JSON, `.yaml/.yml` `application/yaml` per RFC 9512, `.flac` `audio/flac`, `.m4v` `video/mp4`) and the source-code list that is always `text/plain` (mime-db calls `.ts` MPEG-TS video).
  - `extensionForMime()`: `mime-types` `extension()`, for mail attachments without a name.
  - `detectUploadType()`: `file-type` on the bytes against the declared type (or, without one, the name).
- **Replaced:** the maps in `project-files/serve.ts`, `vault/mime.ts`, `chat-attachments/index.ts` and `mail/parse.ts`. `Bun.file().type` was not used: it has no type→extension direction, which mail needs.
- **Uploads** (issue attachments incl. replace and import by URL/base64, initiative and chat attachments, mail draft attachments, avatars): the bytes decide.
  - A claim of a format with a known signature (PNG, PDF, ZIP-based Office …) must carry it, else 400 "The file's content is not image/png".
  - Recognised binary bytes are stored as what they are, so the instance allowlist judges the real format.
  - Heuristic text guesses (XML, iCalendar) never overrule a text claim (an SVG stays `image/svg+xml`); a specific format inside a generic container stays (a `.doc` is an OLE file, file-type says `application/x-cfb`).
- **Deviation from the audit:** not Elysia's `t.File({type})`. Only the avatar route has a fixed type list, and Elysia's `InvalidFileType` reaches our `onError` as an unhandled error (500) until F03 (hub/framework) maps it. The same `file-type` check runs in the handlers instead and answers 400 with a clear message. Project files and knowledge assets store no declared type (the extension decides when serving), so they are not sniffed.

## F07: MCP Streamable HTTP details

- `GET /mcp` and `DELETE /mcp` answer **405 with `Allow: POST`** and the JSON-RPC error body the SDK's transport sends for the same case. Routing them through the SDK transport was the alternative; in stateless mode it would hold a GET stream open that never carries a message, and accept a DELETE for a session that does not exist.
- `serverInfo` is `{name: 'helena', title: 'Helena', version}` with the version from the root `package.json` (the release-please version the OpenAPI document states too), in `apps/api/src/mcp/info.ts`.
- Every tool has a `title`: the route's OpenAPI `summary`, else the tool name spelled out ("create_issue" → "Create issue").
- Not changed: the grant/config key `itsaplan` agents use for this server (runner and Hermes configs, `mcpGrants`). It is an identifier in stored agent policies and belongs to the planned rename step.

## F15: one storage switch in `@repo/storage`, Bun's S3 client

- `@repo/storage` now holds the switch (`index.ts`): the local disk (`local.ts`, unchanged) when `STORAGE_ROOT` is set, else an S3-compatible bucket (`s3.ts`) when `S3_ENDPOINT` is set. Every caller goes through it, so mail (API drafts, accounts, threads; worker import and send), which imported `@repo/storage` directly, now follows the configured store without touching the mail files. The worker starts mail when either store is configured (`storageConfigured()`), not only with `STORAGE_ROOT`.
- `s3.ts` uses Bun's built-in `S3Client` (path-style by default, `S3_FORCE_PATH_STYLE=false` → virtual-hosted), with the same `S3_*` variables as before. A read is a HEAD for type and size plus a streamed GET. `deleteObjectFolder` lists the prefix and deletes page by page, so wiping a mail account works on S3 too.
- `@aws-sdk/client-s3` is gone from `apps/api` (and ~25 packages from the lockfile). The only other user is `deployment/volition-stack/backup/tests/garage-manifest.mjs`, which runs inside the old Docker image with its own dependencies (Docker-era code, OPS-02).
- `apps/api/src/shared/s3.ts` stays as a re-export so the ~10 API modules and the running branches that import `#shared/s3` need no change.
- Tests: the store against an in-memory path-style S3 served by `Bun.serve` (PUT/GET/HEAD/DELETE/ListObjectsV2), incl. missing objects and folder deletes. MinIO itself was not installed (a binary).
- Live runs with `STORAGE_ROOT`, so nothing changes there.

## F17: CSV attachments with PapaParse

- `chat-attachments/parse.ts` `parseCsv()` is `Papa.parse` with `delimitersToGuess` comma, semicolon, tab and pipe: PapaParse picks the delimiter the first rows agree on, not the one the header line counts most of.
- `decodeCsv()` decodes the bytes first: a UTF-16 byte-order mark names UTF-16, otherwise UTF-8 when the bytes are valid UTF-8 (a UTF-8 BOM is dropped), else Windows-1252 (German Excel's "CSV (Trennzeichen-getrennt)"). `TextDecoder` does it; no `iconv-lite` needed.
- Line ends are made uniform before parsing (the old parser ignored `\r`), so a file mixing CRLF and LF still splits into rows; PapaParse on its own would guess CRLF from the first line and keep a trailing LF inside the last field.

## F18: `read-excel-file` instead of `exceljs`

- Both read-only uses moved: the chat-attachment import (`chat-attachments/parse.ts`, first sheet via `readSheet`) and the vault's text extraction (`vault/src/extract.ts`, every sheet via the default export). `exceljs` and the root override `exceljs>uuid` are gone; the lockfile lost about 50 packages.
- read-excel-file returns the grid from A1 with blank rows kept, so the import's `rowNumbers` are now the real sheet rows (what the comment on `ParsedSheet` always promised; with ExcelJS they counted only non-empty rows). A legacy `.xls` or a non-workbook answers the same 400 as before.
- The vault extraction writes each row without trailing empty cells and skips blank rows, as it did with ExcelJS.
- Tests build workbooks with `write-excel-file` (same author, MIT, a devDependency) instead of ExcelJS.

## DB-2: LIKE wildcards escaped everywhere

- One helper pair in `@repo/db` (`packages/db/src/like.ts`): `escapeLike()` and `containsPattern()`. Postgres' default LIKE escape character is the backslash, so no `ESCAPE` clause is needed.
- Now escaped: roles, initiatives (list and options), teams (projects), note boards, members, and the five Administrator searches (users, projects, teams, team projects, team members). The four places that escaped by hand (issues, mail contacts, chat history, the vault's folder prefix) use the helper; `likePattern()` in chat history stays as a name for its callers (one of them, the Mastra memory, is being removed on hub/native-engine-runtime).
- Full-text search across sources stays with hub/second-brain (package K).

## BRW-01: `ws` instead of our RFC 6455 server

- `deployment/volition-stack/browser/websocket.mjs` keeps its one export, `acceptWebSocket`, now over `ws`'s `WebSocketServer({noServer: true, maxPayload: 256 KiB, perMessageDeflate: false})`. The connection object is `ws`'s WebSocket, which already had the same surface the live view uses (`message` with `(Buffer, isBinary)`, `close`, `send`, `close(code, reason)`, `bufferedAmount`). Ours is only the 30 s heartbeat (`ws` answers pings but sends none) and an `error` listener (`ws` reports protocol errors as events after closing).
- `acceptWebSocket` now passes the connection to a callback instead of returning it (`handleUpgrade` promises no synchronous callback); one line in `project-router.mjs`.
- `ws` (not Bun's server): the router runs under Node, and the browser gateway (hub/agent-browser-mcp) puts patchright into the same process, so switching the runtime was not a quick win.
- Dependency: `deployment/volition-stack/browser/package.json` (`@helena/browser-router`) is a workspace member (first entry of the root `workspaces`, so hub/framework's added entry does not collide), and the deploy's `bun install --frozen-lockfile` links `ws` next to the router. The gateway could import `@repo/browser-gateway` by name the same way later.
- Gains: UTF-8 validation (bad text → 1007, test added), permessage-deflate negotiation handled (declined), 64-bit lengths, the close handshake. The old protocol tests stay and pass (61 with `node --test`); the unmasked-frame test now checks the close code, not `ws`'s reason text.

## BRW-03: our fMP4 checked by mp4box.js

- The muxer (`project-browser-mp4.mjs`) stays, as the audit says (latency). The router tests now also parse an init segment plus four fragments with `mp4box` 2.4.1 (a devDependency of `@helena/browser-router`) and check what a player sees: fragmented, one track, `avc1.42c01f`, timescale 90000, 1920x1080, and each sample's decode time, duration, sync flag, size and bytes.
