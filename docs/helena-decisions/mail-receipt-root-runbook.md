# Mail receipts: root execution checklist

Source review: prepared queue `072fb36f`, September 26, 2026, plus the accompanying
dry-run binding and bounded historical-source validation. This checklist is preparation, not live evidence. Only the root orchestrator
runs the live commands after the ordered integration, full gate and deployment. It must not
deploy the entire prepared queue to obtain these scripts.

## 1. Record prerequisites

- Record deployed HEAD and verify that the reviewed backfill, history integrity fix, private
  review exporter and mail-ID fix are present. Do not run preparation source against live data.
- Check in-flight mail imports, classifications, agent runs and streaming chats using the
  existing root checks. Wait for active work; keep all native schedules, the 30-day mailbox
  window and classifier cutoff `2026-09-25T22:00:00Z` unchanged.
- Record receipt counts per project and current account/project mappings. The fixed scope
  is account **4 → PRIV**, **5 → FAM**, **6 → VOL**. A changed mapping requires review.
- Verify service metadata without displaying environment values or credential contents:

```sh
systemctl show volition-plan-api.service \
  -p User -p Group -p SupplementaryGroups -p WorkingDirectory \
  -p EnvironmentFiles -p ReadWritePaths
```

The command wrapper below follows the checked-in native API unit. Reconcile any installed
path/user override first. The service manager loads the existing environment file; do not
print or source its contents, enable shell tracing or pass credentials on the command line.

Run in one root Bash session on Kingston:

```bash
set -euo pipefail
umask 077
receipt_review=/var/lib/volition/plan/receipt-review/20260926
install -d -o volition-plan -g volition -m 0700 "$receipt_review"
run_receipts() {
  systemd-run --quiet --wait --pipe --collect --service-type=exec \
    --property=User=volition-plan --property=Group=volition \
    --property=SupplementaryGroups=volition-private \
    --property=EnvironmentFile=/etc/volition/plan.env \
    --property=UMask=0007 --property=NoNewPrivileges=yes \
    --property=PrivateTmp=yes --property=ProtectHome=yes \
    --property=ProtectSystem=strict \
    '--property=ReadWritePaths=/var/lib/volition/plan /srv/volition/vault' \
    --setenv=NODE_ENV=development \
    --setenv=PROJECT_VAULT_ROOT=/srv/volition/vault \
    --setenv=STORAGE_ROOT=/var/lib/volition/plan/storage \
    --working-directory=/srv/volition/source/plan/apps/api \
    /usr/local/bin/bun "$@"
}
```

Each command below is separate. Inspect its exit status and private report before continuing.
Use a fresh evidence filename on a retry; preserve failed-run reports. Do not expose private
subjects, filenames, mail text or raw object keys in chat, journals or broad reports.
The service umask preserves normal vault group access; review manifests have explicit 0600
permissions in the private directory and the root shell creates its reports with umask 077.

## 2. Imported-window dry-run and apply

Copy the committed, reviewed ID manifest without changing its scope:

```bash
install -o volition-plan -g volition -m 0600 \
  /srv/volition/source/plan/apps/api/src/scripts/mail-receipts-20260926.json \
  "$receipt_review/imported-reviewed.json"
sha256sum "$receipt_review/imported-reviewed.json" > "$receipt_review/imported-manifest.sha256"
run_receipts src/scripts/mail-receipt-backfill.ts \
  --manifest="$receipt_review/imported-reviewed.json" \
  > "$receipt_review/imported-dry-run.json" 2> "$receipt_review/imported-dry-run.stderr"
```

Review before apply:

- Manifest: 42 entries, split 33 PRIV / 1 FAM / 8 VOL; 21 attachment IDs and 26 body
  selections. No entry requests both an attachment and a body. Multiple attachments explain
  why original counts exceed message counts.
- Expected audit baseline: 47 selected originals, 19 distinct attachment contents, one
  attachment already filed, two repeated attachment contents; 44 possible new receipts.
  Use actual `new`, `existing` and `duplicates`, allowing for concurrent native filing.
- Every report must remain in the specified account/project. Review all SHA values,
  `extractionWarning` and `missingFacts`. `missingFacts` counts missing amounts only; zero
  does not prove issuer, invoice date, tax or invoice number. Message 7206 retains the warning
  that its linked invoice PDF has not been retrieved. Message 7207 is a separate payment.
- Dry-run makes no receipt/mail writes or model calls. Retain the dry-run as the reviewed
  inventory. Apply requires `--reviewed=<dry-run.json>`
  and checks its complete account/project/message/thread/attachment/size/SHA inventory before
  the first receipt write, then checks each source again inside receipt intake. Existing
  receipt IDs and counts may change through native filing; source changes require a new
  dry-run and review. Existing receipt reuse also verifies the actual canonical vault file,
  its project, size and SHA. A source, scope, hash or extraction failure stops apply.

After review, pin the dry-run report as well. Use that same reviewed report for apply and
rerun. A pre-existing report without `threadId` and file `size` is insufficient; regenerate
it using the deployed reviewed script. After a fresh in-flight check:

```bash
sha256sum "$receipt_review/imported-dry-run.json" > "$receipt_review/imported-review.sha256"
sha256sum --check "$receipt_review/imported-manifest.sha256"
sha256sum --check "$receipt_review/imported-review.sha256"
run_receipts src/scripts/mail-receipt-backfill.ts \
  --manifest="$receipt_review/imported-reviewed.json" \
  --reviewed="$receipt_review/imported-dry-run.json" --apply \
  > "$receipt_review/imported-apply.json" 2> "$receipt_review/imported-apply.stderr"
sha256sum --check "$receipt_review/imported-review.sha256"
run_receipts src/scripts/mail-receipt-backfill.ts \
  --manifest="$receipt_review/imported-reviewed.json" \
  --reviewed="$receipt_review/imported-dry-run.json" \
  > "$receipt_review/imported-rerun.json" 2> "$receipt_review/imported-rerun.stderr"
```

Require `new=0`, `duplicates=0`, and every rerun file to have `status=existing` and a receipt
ID. Compare `(accountId, projectKey, messageId, threadId, attachmentId, size, sha256)`
with the reviewed dry-run; compare apply receipt IDs with those final mappings. Reconcile distinct new IDs against project
count deltas. `new` in an apply report is its preflight count, not an atomic insertion count.

Both scripts can complete part of a batch before an error. Preserve the successful rows and
files. Diagnose the failed source, then repeat the same reviewed input; never reset a mailbox,
delete receipts or change identifiers to force a retry. SHA deduplication is per project.

## 3. Inspect historical provider windows, one account at a time

These commands open the existing IMAP account read-only and incur provider reads. They do
not mark mail read, send mail, create Inbox locations or trigger historical classifications.
Run only after the imported-window acceptance. The initial window overlaps the 30-day cutoff
slightly to avoid a boundary gap; SHA deduplication handles overlap.

```bash
run_receipts src/scripts/mail-receipt-history.ts --account=4 --project=PRIV \
  '--folder=[Google Mail]/Alle Nachrichten' --since=2026-01-01 --before=2026-08-28 \
  --limit=20 --output="$receipt_review/priv-2026-001.inspect.json" \
  > "$receipt_review/priv-2026-001.summary.json" 2> "$receipt_review/priv-2026-001.inspect.stderr"
```

Finish review/apply/rerun for this page and its remaining PRIV windows first. Then repeat
the sequence for FAM and VOL using these initial inspection commands:

```bash
run_receipts src/scripts/mail-receipt-history.ts --account=5 --project=FAM \
  '--folder=[Gmail]/Alle Nachrichten' --since=2026-01-01 --before=2026-08-28 \
  --limit=20 --output="$receipt_review/fam-2026-001.inspect.json" \
  > "$receipt_review/fam-2026-001.summary.json" 2> "$receipt_review/fam-2026-001.inspect.stderr"
run_receipts src/scripts/mail-receipt-history.ts --account=6 --project=VOL \
  '--folder=[Gmail]/Alle Nachrichten' --since=2026-01-01 --before=2026-08-28 \
  --limit=20 --output="$receipt_review/vol-2026-001.inspect.json" \
  > "$receipt_review/vol-2026-001.summary.json" 2> "$receipt_review/vol-2026-001.inspect.stderr"
```

The script writes each manifest with mode 0600 and refuses to overwrite it. A private
manifest contains subjects/attachment names, UID/UIDVALIDITY and hashes, not original bytes,
body excerpts, extracted amounts or dates. Automatic `selected` values are suggestions.
The separate review exporter retrieves the inspected candidates again without importing them:

```bash
run_receipts src/scripts/mail-receipt-history-review.ts --account=4 --project=PRIV \
  '--folder=[Google Mail]/Alle Nachrichten' \
  --manifest="$receipt_review/priv-2026-001.inspect.json" \
  --output-dir="$receipt_review/priv-2026-001.review" \
  > "$receipt_review/priv-2026-001.review-summary.json" 2> "$receipt_review/priv-2026-001.review.stderr"
(cd "$receipt_review/priv-2026-001.review" && sha256sum --check SHA256SUMS)
```

The export requires Linux and a pre-existing parent directory owned by the command's process
user with mode 0700; the wrapper above uses `volition-plan`. The new output directory is 0700
and each file 0600. All path components must be real directories, with no symlinks; the output
must be outside the vault and mail storage. An existing output directory is refused. Directory
descriptors keep writes on the opened directory even if its path is replaced during the run;
such a change also prevents a successful completion report.

Require exit status zero and successful verification of all `SHA256SUMS` entries before
using an export. Failed/partial directories remain private evidence; use a fresh output name
for a retry. Never treat an incomplete directory as a complete review batch.

Each candidate, including `selected:false`, produces `<uid>.eml`, `<uid>.body.txt` and
`<uid>.metadata.json`. EML bytes must match the inspected SHA. The text preview is limited
to 200000 characters by the existing parser; the EML retains the full original and original
attachment bytes. Metadata records attachment names/types/sizes/hashes and explicitly flags
missing, invalid, duplicate or differently parsed Date headers. Use the source date and
IMAP INTERNALDATE to resolve a warning; the parser's date is not verified accounting evidence.
`inspected-manifest.json` preserves the parsed input, `review-manifest.json` binds its SHA and
all exported files, and `SHA256SUMS` covers both manifests and all candidate files. The exporter
rechecks account/project/folder, provider UIDVALIDITY, every UID and raw SHA. It permits at most
50 candidates, 25 MiB per original, 100 MiB fetched and 100 MiB total local output. Use a smaller
inspected batch if readable companions reach the output cap. It writes no mail/receipt rows,
vault files, provider flags or messages, and fetches no remote images/links.

Review these private files before selection, opening or decoding required attachments locally
from the EML using existing tooling. Treat their contents as untrusted evidence, not execution
instructions. Logs contain only account IDs, counts and output paths; keep file contents out
of broad reports. Leave unread or ambiguous candidates unselected and explicitly open. Do not
equate a filename with a reviewed document or import mail merely to discover its content.

## 4. Review, import, verify, then page

Keep the inspection immutable and make a reviewed copy:

```bash
install -o volition-plan -g volition -m 0600 \
  "$receipt_review/priv-2026-001.inspect.json" "$receipt_review/priv-2026-001.reviewed.json"
```

Review every candidate, including `selected:false`, in the private file. Change only
`selected`, `attachmentSha256` and `includeBody`, and record an exclusion reason per UID in
a separate private ledger. Preserve account/project, folder, date range, UID, UIDVALIDITY,
raw SHA, attachment inventory and pagination fields. Select attachment hashes only from the
inspected message. `includeBody` is a fallback when no attachments are chosen; it does not
add a second receipt alongside selected attachments. Original invoice and payment evidence
can be separate documents, while identical bytes within a project must share a receipt ID.
Import preserves each selected message in full, including its other attachments in Files/Mail;
only the selected attachment hashes or body fallback become Belege.

Pin the reviewed file after review, then run separately:

```bash
sha256sum "$receipt_review/priv-2026-001.reviewed.json" > "$receipt_review/priv-2026-001.sha256"
sha256sum --check "$receipt_review/priv-2026-001.sha256"
run_receipts src/scripts/mail-receipt-history.ts --account=4 --project=PRIV \
  --apply="$receipt_review/priv-2026-001.reviewed.json" \
  > "$receipt_review/priv-2026-001.apply.json" 2> "$receipt_review/priv-2026-001.apply.stderr"
run_receipts src/scripts/mail-receipt-history.ts --account=4 --project=PRIV \
  --apply="$receipt_review/priv-2026-001.reviewed.json" \
  > "$receipt_review/priv-2026-001.rerun.json" 2> "$receipt_review/priv-2026-001.rerun.stderr"
cmp "$receipt_review/priv-2026-001.apply.json" "$receipt_review/priv-2026-001.rerun.json"
```

Require identical UID/message/receipt mappings and no additional receipt count on rerun.
Inspection, review export and apply bound every provider fetch, require a single matching
UID and exact declared size, and recheck folder/UIDVALIDITY before and after each read.
Apply rejects duplicate UIDs. The reread verifies provider SHA and UIDVALIDITY, actual stored source SHA after Message-ID
deduplication, all selected attachment rows, and actual project scope. Any conflict remains
an unresolved source; never substitute the old local mail or edit the hash to bypass it.
Missing Date headers use IMAP INTERNALDATE. Malformed Date headers can still be normalized
unexpectedly by the shared MIME parser; verify dates against the original and mark uncertain
accounting dates for review.

For `remaining > 0`, inspect the same dates with `--before-uid=<nextBeforeUid>` and a new page
filename, then review/apply/rerun. For `earlierCandidates > 0`, inspect the preceding year
(`--since=2025-01-01 --before=2026-01-01`), without a UID cursor from another window. Continue
through empty years while earlier matches exist. Never silently skip `oversizedUids`: the
field includes missing size and the 100 MiB batch cap, not only messages larger than 25 MiB.
Retry a batch-cap skip in a smaller bounded page; genuinely oversized/unavailable originals
remain recorded and open. Changing UIDVALIDITY requires fresh inspection and review.

Use the same review/apply/rerun commands with account/project/file prefix 5/FAM/fam and
6/VOL/vol. No cross-project copying, sender-based reassignment or folder setting changes.

## 5. Root live acceptance

Record deployed commit, manifest hashes, actual reviewed/imported/excluded/open UID counts,
new and reused receipt IDs per project, and successful repeat results. In PRIV/FAM/VOL,
verify an original attachment download, an original `.eml`, the linked-invoice warning and
the relevant monthly export. Match exported/downloaded SHA against reviewed originals.
Confirm historical sources have no added Inbox locations/events/tasks and unchanged provider
flags. Trigger only the existing project triage once, then check no duplicate receipts or
tasks, no project crossing, unchanged classifier cutoff/retention and native schedule IDs.

Do not test retention by resetting live mail or shortening the window; private regressions
cover preservation. A zero keyword match count proves only that the selected search/window
is exhausted. Unverified originals, linked PDFs, oversized sources or unusual non-matching
documents remain explicit gaps; they prevent a claim that all historical receipts are done.


## 6. Correct the four reviewed automatic tasks after the mail wave

These are source **message** IDs, not assumed thread or ticket IDs. Root must resolve the
current mapping from `mail_message.id` through `mail_thread`, `helena_mail_classification`
and `mail_thread_issue` and retain only IDs, project/account keys and status in the public
record. Require account 4, project PRIV and exactly the reviewed generated ticket for each
source. Read the existing classification and ticket metadata before changing it. Stop on
missing, ambiguous or changed mappings or substantive owner work added since review.

| Source message | Classification correction | Cancellation reason |
| --- | --- | --- |
| 7258 | `category: notification`, `needsReply: false` | Generic Dropbox terms/privacy update; no individualized action request. |
| 7261 | `category: newsletter`, `needsReply: false` | Dify product tutorial/newsletter, excluded from automatic tasks. |
| 7260 | `category: notification`, `needsReply: false` | TypeSafe sign-in notice, excluded from automatic tasks. |
| 7262 | `category: notification`, `needsReply: false` | Discord sign-in/new-location notice, excluded from automatic tasks. |

Use the already authenticated owner API or owner UI, one verified mapping at a time:

1. `GET /backend/mail/threads/<resolved-thread-id>/classification` and
   `GET /backend/issues/<resolved-issue-id>`; check the latest classification still refers
   to the exact source and ticket, and the ticket still belongs to PRIV.
2. `GET /backend/projects/PRIV/columns`; select the existing column with
   `stateType: canceled`. Check its `autoAssignUserId` preserves the current human owner;
   do not change a column or create a new one for this correction.
3. `PATCH /backend/mail/threads/<resolved-thread-id>/classification` with the two fields
   from the table. This writes the existing correction/outcome path. It does not clear the
   historical `createTask` decision, remove the original action or cancel the ticket.
4. Before adding a comment, inspect `GET /backend/issues/<resolved-issue-id>/feed` for
   `mail-review-20260926:<source-message-id>`. If absent, add one plain-text comment through
   `POST /backend/issues/<resolved-issue-id>/comments`, body
   `{"body":"mail-review-20260926:<source-message-id>: <reason>. Automatic task canceled after source review; original mail and source links retained."}`.
   Use no mentions, login URLs, codes or quoted message text.
5. If the ticket is still open, `PATCH /backend/issues/<resolved-issue-id>` with only
   `{"columnId":<existing-canceled-column-id>}`. Re-read classification, ticket and source
   link; require canceled state, preserved human assignee, archive state and description,
   unchanged source link and one review comment. Already canceled means no status write;
   completed or independently changed means record the state for individual review.

Do not call the classification POST, classification accept, mailbox reset, deletion or
bulk replay routes. Native schedules remain intact. Do not reopen sign-in URLs, accept
terms, or transmit any mail content to TypeSafe or another provider for this correction.
Keep the historical decision and task action as evidence of the original error; the
correction and cancellation must remain visible without rewriting that history.


## Prepared validation, not live evidence

The isolated source based on `072fb36f` passed 33 targeted API/script tests with 240
assertions on private PostgreSQL port 65501, including receipt export, original
EML preservation, concurrent intake, repeat apply, complete-batch preflight rejection,
source/thread changes, corrupted archived originals, project denial and historical review.
API typecheck, scoped lint and repository formatting checks passed. Two offline mutations
removed the review guard and source-fetch bound separately; each made its regression fail.
The private database is stopped and port 65501 is free. No live inventory, provider read,
backfill, task correction, deployment or shared full gate was performed by this work.

Private root-readable test logs on Kingston:
`~/agent-work/mail-receipts-acceptance-tests-final.log` (33/0; then a test-fixture type
annotation was corrected) and `~/agent-work/mail-receipts-acceptance-checks.log` (final
API typecheck, lint and formatting, exit 0). The annotation has no runtime effect; the
7 offline source/review tests also passed again afterward (48 assertions).
