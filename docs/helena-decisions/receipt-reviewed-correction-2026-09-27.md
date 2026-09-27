# Reviewed correction of nine existing receipt records

Prepared from `f1efcac021f39a5b78fdcbbfa497dee2e6ffbfff`. No live query, provider call,
receipt write or original-file change is part of preparation. Root must review and deploy
the exact full-gate-passed candidate before using this script.

## Existing service assessment

`helena_receipt` has creation provenance, but no update timestamp, revision column or
per-field owner-correction history. `extractAgain()` overwrites all extraction columns;
`updateReceipt()` accepts individual fields. Both can rematch an open receipt, which can
call the decisions model. Neither performs an original-hash/old-facts compare-and-swap.
Neither path is used by this one-time correction.

The script permits only receipt 6 in FAM (attachment 300, issuer only) and receipts 46–53
in PRIV (mail-body receipts, gross and VAT only). Currency must already be EUR and stays
unchanged. Receipt 54 and every other receipt are rejected. Exact before/after values,
project/team/message/thread IDs, original hashes and sizes belong in Root's private
manifest; no owner data is included in the source or synthetic tests.

## Dry-first contract

`apps/api/src/scripts/receipt-reviewed-correction.ts` defaults to a read-only transaction.
Its input is a strict JSON object with `version: 1`, the exact deployed 40-character Git
`release`, and nine `corrections`. Each correction supplies:

- `receiptId`, `projectId`, `projectKey`, `teamId`, `messageId`, `threadId`, `attachmentId`.
- `originalSha256` and `originalSize`, from Root's verified original evidence.
- `before`: exact `issuer`, `totalGrossCents`, `vatCents` and `currency` currently reviewed.
- `changes`: only the allowed fields for that receipt, with exact reviewed parser results.

Money is integer cents. New null values, fractional cents, unrelated fields, duplicate IDs,
additional/missing receipts and attempts to change the currency are refused. No issuer or
account ownership is guessed. Direction, invoice/due dates, IBAN, extraction metadata,
source links, status, creation provenance and every other stored column remain unchanged.

The script requires the canonical live checkout, matching deployed marker/HEAD, the base
parser commit as ancestor and clean API/package sources. Root must hold the existing three
heavy-job locks for each invocation and verify the full gate for that exact release. The
script does not itself take Linux flock descriptors, launch a deployment or claim to fence
all owner activity.

For each receipt it checks its project/team, open/text/mail state, explicit mail-source
IDs, account scope and any attachment metadata. Any existing receipt-match row causes a
stop. It validates a regular original beneath that project's Files tree, checks size/SHA,
and parses a private temporary copy using the existing extraction implementation. The new
four-field projection must agree with the approved changes; it rereads the original hash
after extraction. No matcher, provider, model or filing operation is called.

The dry report binds the whole stored receipt through a canonical SHA256 digest and PG
`xmin`, plus the current complete source-mail/thread/attachment projection digest, original
SHA/size and exact selected changes. Source contents and private paths are not emitted in
the report. The private input/report can contain issuer and amount fields; stdout contains
only fixed status and counts.

## Separate reviewed apply

Inputs must be regular 0600 files owned by Root or the executing service user. The output
must be a fresh file in an existing 0700 directory. Run through Root's existing native
API-user environment without printing credentials. The command shape is:

```text
bun src/scripts/receipt-reviewed-correction.ts --manifest=PRIVATE_MANIFEST --output=FRESH_DRY_REPORT
bun src/scripts/receipt-reviewed-correction.ts --manifest=PRIVATE_MANIFEST --reviewed=REVIEWED_DRY_REPORT --apply --output=FRESH_APPLY_REPORT
```

These are separate phases. Root inspects and pins the complete dry report before apply;
the command shapes are not authorization to execute them as a sequence. An output file is
exclusive-created before the operation. An interrupted attempt is retained; never delete
the output or blindly repeat apply.

Apply re-extracts and checks every receipt under ordered receipt row locks and shared
mail-source locks. Full row digest and `xmin` must still equal the reviewed dry report.
Thus an intervening owner edit, including a change later changed back, refuses the batch.
All nine validations complete before the first update; updates and affected-row checks
share one database transaction, so any failure rolls all nine changes back. Only issuer,
gross and VAT assignments can be reached in this fixed scope. Matching is never invoked.

There is no historical owner-edit log to consult. Root must establish the original `before`
values from the import evidence and current review; `xmin` protects the dry-to-apply interval.
A source/metadata change between phases requires a new explicit review, not a relaxed guard.
Filesystem writes are not a PostgreSQL transaction: Root must preserve the reviewed originals
while the bounded operation runs. A failure writing final evidence after DB commit is an
uncertain outcome that Root must reconcile from the dry binding and actual rows, not replay.

After an apply, Root verifies the exact allowed field diffs, all unchanged columns, original
hashes and absent matching side effects, then checks the visible receipt facts. The existing
browser-blocked PDF-opening acceptance remains open; this data correction is not a browser
workaround and does not prove that UI path.

## Preparation checks

Pure offline contract tests cover the exact nine-receipt scope, forbidden fields, reviewed
old facts, parser disagreement, row/source/original changes and an ABA revision change.
No database/provider/GPU test or apply was executed during preparation. Root's private DB
transaction/rollback checks and integrated full gate remain required before deployment/apply.

The authored PostgreSQL integration regression uses the exact production transaction runner
and UPDATE statements inside a real savepoint against a session-local synthetic temporary
table. A trigger on the ninth update verifies eight prior changes and then raises; after
rollback all nine receipts and the untouched tenth receipt must equal their starting rows.
Separate cases prove successful field-only updates and refusal of the final stale binding.
Only source preparation and release admission are stand-ins; this test does not prove live
filesystem extraction/admission. It is authored but not executed during offline preparation.
The three Git checks use a fixed process-local `-c safe.directory=/srv/volition/source/plan`
so the API service user can read the owner-owned checkout without global Git configuration.
