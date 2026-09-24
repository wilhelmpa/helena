# Standards quick wins (`hub/standards-quickwins`)

Status: in progress, 2026-09-24. Scope: the backlog in `docs/helena-decisions/standards-audit.md` §5.1 (on `hub/standards-audit`). The research and the choice of library are the audit's; this file records only what was built per item, and every place where the implementation deviates from the audit's recommendation, with the reason.

| ID | State | Commit | Notes |
|---|---|---|---|
| F21 | done | see git log | `ipaddr.js` 2.5.0 (MIT) |
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
