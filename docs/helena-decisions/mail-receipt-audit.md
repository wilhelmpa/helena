# Mail receipts: September 26, 2026

The three connected mailboxes use a 30-day import window. At the audit, they contained
992 non-deleted messages and 49 attachments; only one receipt had been registered.
The Mail decision class starts at September 25, 22:00 UTC. Its cutoff and the four native
schedules must remain unchanged: replaying all old classifications would create old tasks.
This audit covers the imported window, not the entire provider history.

## Reviewed sources

`apps/api/src/scripts/mail-receipts-20260926.json` contains 42 reviewed message sources,
scoped to mailbox 4/PRIV, 5/FAM and 6/VOL. It selects 21 attachments and 26 body documents.
There are 19 distinct attachment contents, one already registered; two attachment rows are
copies of another selected original. Expected additions before concurrent new filing:
44 unique receipts: 18 attachments and 26 original RFC822 messages.

The body documents include invoices, payment receipts, refunds, a payment advice and an
order confirmation with a total. An invoice and its payment receipt are separate original
documents. They are not automatically equated solely because their amount is the same.
Copies and cancellations stay in their source mailbox's project. No project is inferred
from a sender or payment recipient.

Excluded: contracts, offers, enrolments, screenshots, marketing, daily order exports,
upcoming renewals and quoted invoice discussions. Message 6578 duplicates the invoice
already represented by attachment 291. Message 6517 only announces an online statement.
Message 7206 announces an invoice available by link: the original email is retained, with
`The original invoice is linked in this email but was not attached.`; the linked invoice PDF has not been retrieved. Message 7207
is the separate payment confirmation. These limitations must remain visible in acceptance.

## Behavior

- Mail receipt intake verifies the thread's actual project, every attachment's ownership,
  normalized path, lack of symlinks, size and imported SHA. Arbitrary invoice-related mail
  cannot file an unrelated contract merely because both are PDFs.
- Attachment receipts reference the existing original file. Body receipts archive the
  exact `.eml` under `Files/Belege/<month>/mail-<sha>.eml`; no reconstructed invoice PDF is
  created. SHA uniqueness is per project. Concurrent and repeated calls reuse the receipt.
- RFC822 text is extracted locally for the vault index. MIME parsing fetches no remote
  images or links. Original messages are served as downloads and included in receipt exports.
- A receipt extraction failure stays retryable. The native project triage retries only
  receipt filing, preserving classification corrections and task actions. A failed task
  creation does not prevent the independent receipt attempt. A mail without sufficient
  document evidence records that no original was found.
- Mail pruning/reset preserves vault files referenced by receipts after the source message
  is removed. The archived body original is independent of the raw-mail retention window.
- Mail content remains untrusted evidence. It never chooses a path, account, execution
  command or a project outside the server-provided project scope.

## Root integration and acceptance

Integrate with mail-ID fix `3048e20b` and the other reviewed changes. Run the serial full gate
and deploy through the normal root workflow. No migration or mailbox settings change is
needed. This branch has made no live writes, backfills or provider connections.

In the existing API service environment, with the service's normal DB, storage and vault
access, run from `apps/api`:

```sh
bun src/scripts/mail-receipt-backfill.ts --manifest=src/scripts/mail-receipts-20260926.json
```

Dry-run reads originals and facts but writes no database rows, files, classification, tasks
or model decisions. Its output contains counts, message/attachment IDs, hashes, receipt IDs
and extraction warnings, not mail text or credentials. All manifest scopes and originals
are checked before apply starts. Missing/changed originals or a changed project fail the
preflight. Review `missingFacts` and the linked-original warning; unknown values must not
be presented as verified accounting facts.

With in-flight mail activity checked, run the same command with `--apply`. An interrupted
apply can be repeated. Immediately repeat dry-run: `new` must be zero, and all selected
originals must map to existing receipt IDs. Record actual counts instead of assuming the
audit's expected count if a schedule filed mail in the meantime.

Open Belege in PRIV, FAM and VOL. Verify one original attachment, one `.eml` body receipt,
the Cloudflare warning and the relevant monthly export. The originals' SHA must match the
stored source. Trigger the existing project triage once and verify no duplicate receipts
or tasks and no project crossing. Retention survival is covered with a private DB regression;
do not shorten live retention or reset an account for acceptance.

Historical provider retrieval must use a bounded, receipt-specific search/import without
adding Inbox locations or emitting `newInboxMail` events. Keep the existing 30-day account
setting and classifier cutoff; changing those globally would import and triage unrelated
history. A provider search/import is separate from this reviewed 30-day manifest.
