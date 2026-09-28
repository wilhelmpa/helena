# Item 9: one file workspace

Prepared 2026-09-26 in `codex/unified-vault`, continuing the preserved predecessor changes at
`43502412`. This document records implementation and the remaining integration/live gate;
it is not a claim of deployment.

## Behavior

- One **Dateien** navigation item at Home and in a project. Documents and notes open there. Boards are a tab of the same project workspace; the former Docs/Boards routes
  redirect with their selected document/board/canvas preserved. Private/Home/Templates and
  project roots retain their independent access rules.
- Upload, nested-folder browsing, full-text search, text editing, preview/download, task links,
  author/run provenance and the reader's own conversation links live in that workspace.
  PDF, image, audio/video and Office previews reuse the existing viewers; text extraction now
  reads the actual knowledge endpoint instead of the old `/vault/text` placeholder.
- Owner correction, 2026-09-27: all ordinary file/note use stays inside Helena. The existing
  native Markdown/source editor is the default for the same canonical vault.
  No separate Notes domain, iframe option or runtime URL mapping is required or offered.
  Existing service/data/configuration remain untouched; the unsafe same-origin guard remains.
- This is shared-vault integration. Helena's native editor, Files viewer and agent tools
  use the same original files. Syncthing mirrors them to devices.
- Chat uploads and initiative uploads store original bytes in the project vault. A PDF stays a
  PDF, including scans; extracted Markdown is a read result, not a replacement for the original.
  Existing `upload_chat_attachment`, `read_chat_attachment`, `write_note`, `read_document`,
  `search_knowledge`, attachment linking and import tools keep their paths/IDs and share bytes.
- Text saves carry an ETag; simultaneous API saves serialize and a stale save returns 409.
  Prior bytes go to the appropriate trash (Private has its own). The draft stays visible on
  error. API writes reindex immediately with user/agent/run provenance; external editors use
  the existing watcher. Move history keeps attachment links useful after a later edit.
- Raw attachment UUIDs now require project file access. Historical `/media/.../raw` embeds
  forward a session only for an exact validated UUID/raw route and disable shared caching.
  Explicit issue/view shares retain their embeds through a token-scoped route that checks the
  shared issue/view filter on every request; revocation stops subsequent reads.
- Binary bytes disguised as text no longer reach Postgres text columns or get included in
  index-error logs. Mail→Belege extraction/receipt work is coordinated separately with R1;
  existing `Projects/<KEY>/Files/Mail` originals are not relocated.

## Migration and rollback

Apply `0192_helena_unified_vault.sql` after Claim `0190` and Paper `0191` during the normal database gate.
It adds nullable vault path/hash columns to chat and initiative attachments, indexes and
storage checks; a retained legacy object key plus a canonical vault path is allowed.
The generated `0192` snapshot extends the actual Paper snapshot and retains Claim and Paper.
The previous journal entries remain unchanged.

Use the existing script in the deployed checkout with the service environment through the
normal ops wrapper (do not print/read that environment):

```
bun apps/api/src/scripts/attachments-to-vault.ts --dry-run
bun apps/api/src/scripts/attachments-to-vault.ts
bun apps/api/src/scripts/attachments-to-vault.ts --dry-run
```

The script now includes issue, chat and initiative attachments. It copies legacy objects,
checks hashes, numbers conflicting filenames, reuses complete files from an interrupted run,
and switches the database reference. It does not delete the old object or erase its key.
Review the restricted migration receipt and the final pending/failed counts; retry failures.
Take the normal database/vault backup first. Rollback restores rows from that backup/receipt;
keep vault files and old object bytes until the owner chooses archival cleanup. Do not run
legacy migration code that deletes objects. PDFs converted to Markdown by historical upload
code cannot regain an original PDF that was already discarded; report any such cases.

## Required root live acceptance

1. Integrate in owner priority order, merge current HEAD, run the shared full gate, check no
   runs/streaming chats, fast-forward/deploy normally. No subagent has deployed this change.
2. Verify exactly one file menu in Home and a project; no separate Docs, Boards or Notizen
   workspace-tool entry. Open saved `/docs?path=...` and `/notes/<id>` links.
3. On the actual Helena origin, open Markdown directly in the native editor, edit it and
   read the same changed bytes via Helena/agent tools. Verify ETag conflict handling,
   canonical wiki links and persistence after reopening. No Notes domain or sign-in is needed.
4. Confirm there is no separate Notes iframe or menu offer, including with saved legacy panels.
5. With a permitted agent, create a uniquely named Markdown report and an original PDF/image,
   attach the report to a ticket without copying, find it in Dateien, edit it,
   rename it, then read the same content through the attachment ID and knowledge search.
   Confirm author/run, task and own-chat references. Restart relevant services and repeat read.
6. With an unrelated account/agent, deny the same file, raw attachment URL and search. A role
   with only document read must not see task titles or another person's conversation titles
   in provenance. Home/Private/template-write restrictions must match the knowledge routes.
7. Check an existing explicit public issue/view share's embedded attachment, an attachment
   outside its scope, then revocation. Keep the legacy media URL authenticated elsewhere.
8. Record final migration counts and examples in root handoff/CLAUDE; do not claim Item 9
   complete until these live checks, including the Notes origin, are actually observed.

## Isolated validation

Test copy `~/agent-work/unified-vault`, private Postgres on port `55566`, database
`itsaplan_unified_test` plus per-run clones. Temporary file roots and synthetic fixtures only.
Dependencies are links to the already installed cache; no download/install/live mutation.
Logs are in `~/agent-work/unified-vault-tmp`. Root receives final counts with the commit.

Final checks: 172 API integration tests (12 files), 23 web regression tests (7 files), API and
web TypeScript checks, scoped API/web/database/vault ESLint, formatting and `git diff --check`
passed. A fresh synthetic database successfully applied the full migration chain including
0190. API validation was repeated after the final text-write serialization adjustment.
