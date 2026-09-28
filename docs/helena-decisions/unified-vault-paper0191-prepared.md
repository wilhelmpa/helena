# Unified Vault after Paper0191

Prepared from `94a0f02ce8f6040e832b6a70722828c421607d0a`.
No deployment, existing-object migration or live acceptance is implied by this preparation.

The Files workspace is the single navigation entry for files, documents, Markdown and
boards. Existing Docs and board URLs resolve to the workspace. Helena opens the
same canonical originals in its native editor. Project members
retain the native editor and existing project permissions. Ticket and own-chat references
remain separately authorized. Existing same-project agent tools read and write these
originals without a second store or additional project membership.

## Source composition

The changes reuse prepared Vault `868d28be`, reference moves `b8737a3e`, attachment
selection ACL `b9b963be`, chat path moves `8b52481a`, and the complete reviewed Markdown
chain `314ff5a5` → `264823b8` → `6a948a6f`. Acceptance fixtures come from `80109351`
and its documentation result `145206f5`. The existing SGID handling from `750830ab`
is retained. Optional cross-project knowledge sharing, JEV, goals, catalog and messenger
are outside this release.

Mail receipt storage still uses its existing intake transaction and advisory lock.
`writeUniqueFile(..., undefined, { deferIndex: true })` writes the original inside that
transaction. The existing postcommit `indexVaultPaths(..., { throwOnError: true })`
records receipt provenance and permits index repair without matching existing receipts
again. Ordinary Files writes still record provenance and index immediately.

## Migration

`0192_helena_unified_vault.sql` follows actual Claim0190 and Paper0191. Its SHA-256 is
`69949c592f023223ec3f15f735ab236e80c76e6522b1619852172acddc20af46`, identical to the
normalized Vault SQL in `a6e61a2a`. Drizzle generated the snapshot from the current schema
and actual Paper snapshot. Only chat_attachment, initiative_attachment and issue_attachment
change. The previous journal entries and other snapshot tables remain unchanged;
0192 has idx192/when1790436986200 and the actual 0191 snapshot as predecessor.

## Local checks and remaining acceptance

- Six offline receipt/writer checks cover real filesystem bytes, ordinary indexing,
  deferred transaction indexing, concurrent intake, SQL rollback, failed indexing/retry,
  combined index/matching errors and failed original writes. Removing the writer guard
  fails the real-writer test; removing the intake option fails the five intake cases.
  The DB fixture is synthetic and does not prove PostgreSQL transaction behavior.
- Seventy Web checks across twelve files use the existing isolated Web test setup.
  They cover actual editor saves, source fallback, exact newline bytes, stale ETags,
  permissions, navigation/legacy URLs, media forwarding and canonical ticket/chat links.
- Four existing private fixture-helper tests pass. Offline migration comparison confirms
  the SQL hash, snapshot predecessor, exactly three table changes and unchanged prior journal.
- API, Web, DB and Vault TypeScript checks use existing local dependencies. No installation
  or database connection is needed for these checks.

Root still needs the exact combined private PostgreSQL checks (including receipt pool /
postcommit, attachment migration, ACL and rename), full gate and ordered deployment.
Use `unified-vault-acceptance.md` for the actual UI → task/chat → agent → device edit →
agent original-byte cycle, cross-project denial, watcher provenance and restart checks. Existing-object migration remains separate: reviewed dry run,
apply, repeated dry run, while retaining legacy objects and keys. The acceptance checks must establish editing and byte preservation.
