# Mail receipt intake: one transaction and recoverable postcommit indexing

Prepared independently from `df86ee23`; no live or database operation was performed by the
implementing subagent. This is repair A only. The separate project-triage batch-lock pool
problem remains open; see `mail-intake-pool-followup-2026-09-27.md`.

## Connection and commit boundary

Previously `intakeMailReceipts` reserved a connection for its project advisory lock but
`storeMailReceipts` and its helpers used the global pool. Ten concurrent intakes could fill
the pool while the lock holder requested another connection. Indexing and matching also
performed independent database work while that connection was reserved.

The existing transaction and advisory key remain. Its executor now reaches all receipt
reads and inserts through `storeMailReceipts`, `prepareMailReceipts`, `ownIbans`,
`verifiedExistingMailReceipt` and `existingBySha`. Independent preparation and upload paths
retain the global DB default. Original validation, source/project verification, file writing,
SHA uniqueness and the advisory lock stay within the intake boundary.

The transaction returns receipt IDs, newly inserted IDs and body-original index paths.
Indexing and best-effort matching run only after commit and release of the intake connection.
Only newly inserted rows are matched. `skipMatching: true` skips every matcher call.
No matching, indexing or success result occurs after an intake SQL rollback.

Receipt inserts now commit atomically. Files are not transactional: a canonical EML already
written before SQL failure remains available. Retry compares its SHA and size to the exact
original and reuses it; different bytes are rejected. No original is deleted automatically.

## Postcommit failures

Body-original index paths include verified existing receipts, rather than short-circuiting
on an existing receipt ID. A new optional `indexVaultPaths(..., { throwOnError: true })`
argument propagates direct source stat and indexing errors for the known file paths used by
mail intake. Other callers retain the existing best-effort behavior. The option does not
change the recursive watcher's ignored-directory policy.

If indexing fails after commit, intake rejects even though the receipt row exists. Native
receipt retry consequently records a failed attempt, with zero completed receipts. The next
attempt verifies the existing original and repeats indexing before returning success. It
neither creates a duplicate receipt nor rematches that existing ID.

New IDs still receive their one best-effort matching attempt if indexing throws; the valid
original is already committed. Matcher errors remain logged and caught by `matchQuietly`,
so they cannot replace the original index failure. A regression covers simultaneous index
and matcher failures. This is not a durable postcommit job queue or an exactly-once claim
across process crashes: an interruption after commit can leave a receipt open, as other
best-effort matching failures already do.

## Validation

Offline checks: 62 tests / 186 assertions for the real native/history receipt evidence paths,
matching options and dedupe, transaction-bound queries, SQL rollback with canonical-file
recovery, postcommit index repair, matcher-error preservation, filesystem failure and the
actual strict indexer with a synthetic failing store. Existing mail-facts and source-review
checks add 16 tests / 38 assertions. All pass: 78 tests / 224 assertions total.

The offline transaction adapter rejects any global DB read or write in the intake context,
rolls back its receipt rows on error and forbids indexing/matching before commit. It is not
a substitute for PostgreSQL. Restoring the two production files from `df86ee23` makes all
six new focused regression checks fail. The private red log is
`/tmp/helena-mail-intake-transaction-old-red.log`.

Prepared, not executed, integration checks use the existing private test DB/API harness:

- Ten simultaneous exact EML intakes, with a five-second pool deadline and one original.
- Ten independent project/account scopes in parallel, each with its own receipt.
- Ten identical XML intakes: one committed receipt, one matching decision, no rematch on retry.
- Invalid extraction yields no receipt rows.
- A test trigger fails a later original's insert: prior inserts roll back too.
- A SQL failure after EML writing preserves the canonical bytes; altered leftovers are rejected
  and restored exact bytes are reused without another file.
- A postcommit vault-index failure gives native retry `completed: 0, failed: 1`; removing the
  synthetic failure lets retry repair the existing row and report one completion.

Failure triggers are private-test-DB guarded and removed in `finally`. They were not installed
or executed locally. Root must run type/lint checks and the full integration gate. No provider,
private source, GPU, live DB, deployment, installation or download was used. Existing cached
Zod is linked only in ignored local `node_modules`; package dependencies are unchanged.
