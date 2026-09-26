# Mail receipts: root execution checklist

Source review: prepared queue `5e667436`, September 26, 2026, plus the accompanying history
integrity fix. This checklist is preparation, not live evidence. Only the root orchestrator
runs the live commands after the ordered integration, full gate and deployment. It must not
deploy the entire prepared queue to obtain these scripts.

## 1. Record prerequisites

- Record deployed HEAD and verify that the reviewed backfill, history integrity fix and
  mail-ID fix are present. Do not run source from a preparation worktree against live data.
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
- Dry-run makes no receipt/mail writes or model calls. The ID manifest does not pin raw
  hashes; retain the report as the reviewed SHA inventory and compare a fresh dry-run if
  time or source activity intervenes. A source, scope, hash or extraction failure stops apply.

After review and a fresh in-flight check:

```bash
sha256sum --check "$receipt_review/imported-manifest.sha256"
run_receipts src/scripts/mail-receipt-backfill.ts \
  --manifest="$receipt_review/imported-reviewed.json" --apply \
  > "$receipt_review/imported-apply.json" 2> "$receipt_review/imported-apply.stderr"
run_receipts src/scripts/mail-receipt-backfill.ts \
  --manifest="$receipt_review/imported-reviewed.json" \
  > "$receipt_review/imported-rerun.json" 2> "$receipt_review/imported-rerun.stderr"
```

Require `new=0`, `duplicates=0`, and every rerun file to have `status=existing` and a receipt
ID. Compare `(projectKey, messageId, attachmentId, sha256)` with the reviewed dry-run; compare
apply receipt IDs with those final mappings. Reconcile distinct new IDs against project
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
An ambiguous candidate requires a separate bounded, read-only original retrieval and private
inspection before selection; this CLI does not provide that review viewer/export. Leave
unverified candidates unselected and explicitly open. Do not equate a filename with a
reviewed document or import it merely to discover its content.

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
The reread verifies provider SHA and UIDVALIDITY, actual stored source SHA after Message-ID
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
