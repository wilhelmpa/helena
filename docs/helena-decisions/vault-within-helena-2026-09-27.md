# Vault within Helena: bounded release scope

Owner decision, 2026-09-27. Based on Vault `35dd420728563b64ba0d02224a015a6d382496a1`.
Prepared locally, not deployed or live-accepted.

All normal file/note work stays on Helena's existing Files/Knowledge routes. The existing
native editor operates on the same canonical `/srv/volition/vault` files that the installed
SilverBullet service uses. There is no second data store, title-copy synchronization or new
Notes hostname. Project/Home/Private access, uploads, agent tools, search, task/chat references,
provenance, ETags, rename resolution and the attachment migration remain unchanged.

## Why not mount the stock frontend at `/notes`

- SilverBullet 2.11.1 supports `SB_URL_PREFIX`, but a path is not an origin boundary.
  [Pinned configuration](https://github.com/silverbulletmd/silverbullet/blob/2.11.1/docs/Install/Configuration.md).
- `disableSpaceLua` skips script loading only; the Lua environment and registered syscalls
  still exist. `disablePlugs` excludes custom plugs only. These troubleshooting switches are
  not a server-enforced untrusted-content mode. The earlier local Notes acceptance already
  demonstrated inline expressions reaching `js.window` despite `disableSpaceLua`.
  [Pinned client system](https://github.com/silverbulletmd/silverbullet/blob/2.11.1/client/client_system.ts),
  [pinned troubleshooting](https://github.com/silverbulletmd/silverbullet/blob/2.11.1/docs/Troubleshooting.md).
- The existing iframe grants scripts and same-origin. On Helena's origin this grants the
  embedded page access to the parent/session context; the iframe attribute itself is removable.
  [HTML sandbox contract](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox).
- Removing `allow-same-origin` is not a working stock-client solution: its initialization
  unconditionally opens IndexedDB. `SB_DISABLE_SERVICE_WORKER` disables offline sync, not
  this database requirement. An opaque-origin embedding additionally needs an authenticated
  transport design; no global `Origin: null` exception is acceptable here.
  [Pinned client](https://github.com/silverbulletmd/silverbullet/blob/2.11.1/client/client.ts),
  [pinned IndexedDB adapter](https://github.com/silverbulletmd/silverbullet/blob/2.11.1/client/data/indexeddb_kv_primitives.ts).

No upstream build, new adapter, iframe bridge or security relaxation is included. Existing
`isolatedNotesUrl` rejection and the unused isolated-frame component remain intact. Native
SilverBullet unit, socket, vault data, CONFIG.md and installer are neither removed nor changed.
No DNS/Cloudflare operation is needed. Existing historical ingress is not reconfigured by this
web-only patch; there is no new exposure and no claim that old ingress has been retired.

## Exact user-facing change and compatibility

Markdown opens directly in `VaultTextEditor`, including its source mode for unsupported
formatting. `FileBrowser`/`FileToolbar` no longer offer a second Notes editor. The historical
DocumentOptions link still points at the same canonical file, now labelled Helena editor.
Legacy `HELENA_NOTES_URLS` values are ignored; the retained runtime `notesUrl` field is empty.
Persisted `notes` panel IDs remain unavailable with an empty URL, even for a stale client
configuration. Notes origins are no longer added to the workspace frame-origin allowlist.
Update-center release-note URLs are unrelated and unchanged.

## Deliberate remaining gap

This is a common SilverBullet-compatible file vault with Helena's frontend, **not full
SilverBullet UI/function parity**. Space Lua, inline expression evaluation, custom plugs/styles,
virtual `ordner:` pages, queries/widgets, SilverBullet commands and offline/PWA sync are not
available in the normal Helena flow. Their Markdown/config bytes remain intact. No user script
is evaluated to emulate them. Any later execution-capable frontend integration needs its own
security design and explicit acceptance; no large frontend fork is part of this release.

## Verification and Root acceptance

Focused local checks cover legacy runtime mappings/panel URLs, native viewer entry, exact
source preservation (including inert Space Lua/inline expressions), wiki ACL responses,
project switching, task/chat links, dirty navigation and ETag conflicts. They do not replace
real backend ACL, agent, browser or migration acceptance.

Root should upload PDF/image/Markdown, open/edit/reopen the Markdown directly in Helena,
follow a permitted wiki link, verify denied project/Private access, link the original to a
ticket, and read the same current path/hash via an authorized agent and search. Verify actual
provenance and retained original bytes. There must be no Notes iframe/domain requirement.
Use the existing acceptance fixture; its legacy `silverbullet` stage name/content is merely a
byte checkpoint for a second native edit, not SilverBullet execution evidence. Full frontend
and external-editor watcher acceptance remain explicitly open. No live work occurred here.

Local verification completed on this prepared worktree: **58 tests passed**, Web TypeScript
`--noEmit --preserveSymlinks`, scoped Web ESLint and checked-file Prettier passed. Existing local
dependencies only. No backend, private PG, browser, provider, installation or server execution.

Reproduction (from `apps/web`, with the existing local dependency links):

```sh
API_URL=http://api.test bun test --preserve-symlinks --preload ./test/setup.ts --isolate src/utils/appOrigins.test.ts src/utils/workspaceTools.test.ts src/features/project-files/components/VaultMarkdownContent.test.tsx
API_URL=http://api.test bun test --preserve-symlinks --preload ./test/setup.ts --isolate src/utils/vaultLinks.test.ts src/features/project-files/components/VaultMarkdownBoundary.test.tsx src/features/project-files/hooks/useVaultMarkdownSession.test.tsx src/features/project-files/utils/editMarkdownSource.test.ts
bun ../../node_modules/typescript/bin/tsc --noEmit --preserveSymlinks -p tsconfig.json
```
