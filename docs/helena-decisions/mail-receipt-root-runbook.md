# Mail receipts: root execution checklist

Source review: prepared queue `072fb36f`, September 26, 2026, plus the accompanying
dry-run binding and bounded historical-source validation. Updated September 27 with the
read-only live checkpoint below; no apply or HTTP/UI acceptance has been performed by this
update. Only the root orchestrator
runs the live commands after the ordered integration, full gate and deployment. It must not
deploy the entire prepared queue to obtain these scripts.

## Read-only checkpoint: September 27, 00:53–00:55 CEST

Live HEAD: `e032c65da04487f21a3f98b316f7ff8e56654c41`. Database snapshot at
00:53:14 CEST, bounded filesystem check at 00:54:15 CEST. These counts describe imported
mail and cached folder metadata, **not** a fresh or complete historical provider inventory.
No subjects, mail bodies or credential values were read for this checkpoint. Selected
attachment bytes were hashed locally without displaying or interpreting their content.

| Account / project | Threads | Messages | Attachments | Receipts | Files/Belege index / disk |
| --- | ---: | ---: | ---: | ---: | --- |
| 4 / PRIV | 716 | 810 | 29 | 1, open, source mail | 0 / absent |
| 5 / FAM | 9 | 10 | 1 | 0 | 0 / absent |
| 6 / VOL | 133 | 177 | 19 | 0 | 0 / absent |

All three accounts are enabled, synced, `fetchDays=30`, `triageEnabled=false`, with no
pending reset/provider action, deleted message or thread in another project. Their latest
syncs are 00:52:19–00:52:23 CEST. Preserve these settings; do not enable account triage to
manufacture an acceptance run. Cached archive folders remain 19/33/42 respectively, with
UIDVALIDITY 595100798/12/12 and total/synced counts 810/10/177. Provider UIDVALIDITY must
still be checked afresh by the historical operator when that phase starts.

The committed 42-message selection still resolves completely in the expected scope:
33 PRIV, 1 FAM, 8 VOL; 21 selected attachments and 26 body fallbacks. All selected attachment
rows belong to the exact selected messages. All 21 files are regular, present, and match
their stored size/SHA; their 19 distinct project/SHA pairs include two repeated contents.
All 26 raw EML files are regular, present and match their declared sizes. **Their bytes and
hashes were not read**; a fresh deployed dry-run must bind those originals before apply.
The maximum expected new count from this metadata is 44 (26 body selections plus 18
unfiled distinct attachment contents), not a newly verified dry-run count.

Existing receipt 1 is attachment 335 → message 7235 → thread 6951 in PRIV. Its physical
file matches size/SHA and remains under `Files/Mail`; its legacy `details.mailSource` is
absent. Resolve provenance through `mail_attachment_id → mail_attachment.message_id →
mail_message.thread_id`, rather than treating missing JSON provenance as a missing source.
It has no linked ticket. Reuse must preserve its ID and existing fields.

Storage semantics matter: selected attachments stay at their verified `Files/Mail` paths.
Only a body fallback creates `Files/Belege/<invoice-month>/mail-<first-24-SHA-characters>.eml`.
The three Belege roots are absent, so no existing body target collides at this snapshot;
the exact month and source SHA remain for dry-run review. At apply, the operator verifies
an existing canonical target or rejects changed bytes; it must not repair a conflict by
moving/deleting another original. Deduplication is within the project.
An absent physical Belege folder does not settle product acceptance: the owner must find
registered receipts in Helena's **Belege** page and open the same canonical original from
there. The UI/source-link acceptance below is mandatory; a receipt row/count is insufficient.

Sources 7206 and 7207 remain separate VOL messages, threads 6931 and 6932, without
attachments or linked tickets. The prior reviewed linked-invoice warning for 7206 remains
an acceptance requirement; this metadata check did not reread or reassess that content.

Reproduce database metadata from the reviewed checkout on the Mac with the existing read-only helper, using a new
private output filename each time. The SQL is a fixed 42-message selection, counts only
for accounts 4/5/6, and a `REPEATABLE READ READ ONLY` transaction. Its private result contains
storage paths/hashes needed for local source checks; do not print or commit the raw JSON.

```bash
umask 077
mail_metadata=$(mktemp /tmp/helena-mail-point4-metadata.XXXXXXXX)
/Users/wilhelmpa/volition/tools/ksql.sh \
  docs/helena-decisions/evidence/mail-point4-metadata.sql > "$mail_metadata"
```

Current private evidence on the Mac is `/tmp/helena-mail-point4-metadata-20260927.json`
and `/tmp/helena-mail-point4-file-evidence-20260927.json`; the latter contains only file
IDs, sizes, presence/hash-match booleans and root occupancy. Temporary evidence may expire.
No provider read, mailbox/receipt/task write, vault mutation, matching/model call, login or
deployment was made by this checkpoint. Root still owns the full point-4 live acceptance.

## 1. Record prerequisites

- Record deployed HEAD and verify that the reviewed backfill, history integrity fix, private
  review exporter and mail-ID fix are present. Do not run preparation source against live data.
- Check in-flight work using the existing root checks and the current owner deployment
  mandate. Reconcile concurrent imports/classifications/receipt writes for the affected
  accounts before the receipt batch; do not cancel owner chats or disable routines to get
  a quiet check. Keep native schedules, the 30-day mailbox window and classifier cutoff
  `2026-09-25T22:00:00Z` unchanged.
- Record receipt counts per project and current account/project mappings. The fixed scope
  is account **4 → PRIV**, **5 → FAM**, **6 → VOL**. A changed mapping requires review.
- Verify service metadata without displaying environment values or credential contents:

```sh
systemctl show volition-plan-api.service \
  -p User -p Group -p SupplementaryGroups -p WorkingDirectory \
  -p EnvironmentFiles -p ReadWritePaths
```

The command wrapper below uses the installed API user/group, database environment and
vault/storage paths checked at 00:55 CEST. The API also loads owner/tunnel environment files
and has a terminal-key supplementary group; this direct DB/storage operator needs neither
HTTP owner credentials nor terminal access, so it intentionally does not inherit them.
Reconcile any installed path/user override first. The service manager loads the existing environment file; do not
print or source its contents, enable shell tracing or pass credentials on the command line.

Run in one root Bash session on Kingston:

```bash
set -euo pipefail
umask 077
receipt_review=/var/lib/volition/plan/receipt-review/20260927-point4
test ! -e "$receipt_review"
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

The two operator apply paths explicitly set `skipMatching: true` on each mail receipt
intake. New originals are filed locally and remain open; neither deterministic nor
model-based matching is started by these calls. Existing receipt matches, match rows and
receipt states are preserved when an original is reused. Matching is a separate operation
after review of its configured decision provider and data permissions. The default intake,
upload behavior, native routine and existing schedules retain their normal matching behavior.

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

This local comparison checks the exact report schema and emits counts only. It does not
replace the source/file checks performed by the deployed rerun:

```bash
python3 - "$receipt_review" <<'PY'
import json, sys
from collections import Counter
from pathlib import Path
root = Path(sys.argv[1])
review, apply, repeat = [json.loads((root / name).read_text()) for name in
    ("imported-dry-run.json", "imported-apply.json", "imported-rerun.json")]
def inventory(report):
    return Counter((r["accountId"], r["projectKey"], r["messageId"], r["threadId"],
                    f["attachmentId"], f["size"], f["sha256"])
                   for r in report["reports"] for f in r["files"])
assert review["mode"] == repeat["mode"] == "dry-run" and apply["mode"] == "apply"
assert all(r["messages"] == len(r["reports"]) == 42 and r["originals"] == 47
           for r in (review, apply, repeat))
assert inventory(review) == inventory(apply) == inventory(repeat)
assert Counter((r["accountId"], r["projectKey"]) for r in repeat["reports"]) == \
       Counter({(4, "PRIV"): 33, (5, "FAM"): 1, (6, "VOL"): 8})
assert repeat["new"] == repeat["duplicates"] == 0 and repeat["existing"] == 47
applied = {r["messageId"]: r for r in apply["reports"]}
assert len(applied) == 42
by_hash, by_id = {}, {}
for row in repeat["reports"]:
    ids = set()
    for f in row["files"]:
        assert f["status"] == "existing" and isinstance(f["receiptId"], int) and f["receiptId"] > 0
        key, rid = (row["projectKey"], f["sha256"]), f["receiptId"]
        assert by_hash.setdefault(key, rid) == rid and by_id.setdefault(rid, key) == key
        ids.add(rid)
    assert set(applied[row["messageId"]]["receiptIds"]) == ids
print(json.dumps({"messages": 42, "originals": 47, "new": 0,
                  "distinctReceiptIds": len(by_id), "sourceAndApplyMappingsMatch": True}))
PY
```

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
Apply rejects duplicate UIDs. The reread verifies provider SHA and UIDVALIDITY, actual stored
source SHA after Message-ID deduplication, all selected attachment rows, and actual project scope. Any conflict remains
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


### Historical execution matrix

Apply this matrix serially to every reviewed page. Verify current account/project bindings
and the exact existing folder name before starting; the table records the prepared scope,
not a new provider inventory. Use a new private evidence prefix per account, year and page.

| Account | Required project | Existing archive folder | First evidence prefix |
| --- | --- | --- | --- |
| 4 | PRIV | `[Google Mail]/Alle Nachrichten` | `priv-2026-001` |
| 5 | FAM | `[Gmail]/Alle Nachrichten` | `fam-2026-001` |
| 6 | VOL | `[Gmail]/Alle Nachrichten` | `vol-2026-001` |

All three start with `--since=2026-01-01 --before=2026-08-28 --limit=20` using section 3.
Each original is bounded to 25 MiB and each page to 100 MiB/at most 50 candidates. The
20-candidate initial page can be reduced when its body companions exceed the review cap.
For each account, finish its pages and earlier windows before proceeding to the next.

| Stage | Exact operation and evidence | Required result before continuing |
| --- | --- | --- |
| Bounded inventory | Run history inspection with the table's account/project/folder and write `<prefix>.inspect.json` plus summary. | Scope unchanged; every UID listed once; record remaining, earlierCandidates and oversizedUids. No silent omissions. |
| Private review | Export all candidates with history-review, verify its SHA256SUMS, read required originals locally, preserve inspection and create `<prefix>.reviewed.json`. | Every UID selected or explained in a private exclusion/open ledger. Selected attachment SHA values come from that UID; body fallback is explicit. Pin the reviewed manifest SHA. |
| Bound apply | Check that pin, then history `--apply=<prefix>.reviewed.json` with the table's account/project. | Exit 0; UID/message/receipt mapping for every selected UID. No new match calls, Inbox locations or classification replay. Partial failure is incomplete evidence. |
| Repeat and read-only zero check | Repeat the same history apply and compare mappings. Build the exact imported ID manifest described below; run the existing backfill **without** `--apply`. | Same receipt IDs; `new=0`, `duplicates=0`, every file existing. All hashes and source mappings agree with the privately reviewed provider originals. |
| Download and source proof | In that project's Belege, download selected original files and the monthly export; compare SHA256. Check source/thread/ticket metadata as in section 5. | Correct project, canonical file, exact original bytes, visible warning and preserved source/ticket association. Historical import creates no new task. If no ticket exists, record that explicitly. |
| Checkpoint and continue | Record manifest/report hashes, UID boundary, counts and open exceptions. Advance the UID cursor or year only after the page is reconciled. | No unreviewed candidate or skipped UID is counted complete; native cutoff, retention and schedules unchanged. |

For the read-only zero check after a historical apply, derive `<prefix>.imported-ids.json`
from the successful apply report and its pinned reviewed manifest, using only current mail
metadata. This file is an evidence manifest for the existing backfill script, not another
receipt store:

1. Require one apply-report row for every selected reviewed UID, without additions or
   omissions. Read `mail_message` for each exact returned `messageId`, its joined thread and
   project, and its `mail_attachment` rows. Require the matrix account/project and retain
   the actual `threadId` for comparison; never treat provider UID as an internal message ID.
2. For each row, write `{messageId, accountId, projectKey, attachmentIds, includeBody}`.
   Resolve `attachmentIds` only from attachments of that message whose SHA occurs in the
   corresponding candidate's reviewed `attachmentSha256`. Require every selected SHA to
   resolve. Preserve that candidate's `includeBody` selection. With selected attachments,
   it remains fallback-only; do not add a second body receipt.
3. Keep each `messageId` at most once in a verification manifest. If distinct provider UIDs
   reused one internal message, verify them in separate bounded manifests. Identical selections
   can be coalesced only while retaining every UID-to-message/receipt mapping in the ledger;
   never merge a body-only selection with an attachment selection, which would suppress the
   body fallback. A page with zero selected UIDs records zero expected receipts and needs no
   imported-ID manifest; it still needs complete review and exclusion/open reasons.
4. Save each nonempty manifest privately with mode 0600, refuse overwrite, pin its SHA, then run:

```bash
run_receipts src/scripts/mail-receipt-backfill.ts \
  --manifest="$receipt_review/priv-2026-001.imported-ids.json" \
  > "$receipt_review/priv-2026-001.zero.json" 2> "$receipt_review/priv-2026-001.zero.stderr"
```

Use the matching `fam` or `vol` prefix for the other accounts. Compare every zero-report
`accountId/projectKey/messageId/threadId/attachmentId` with the exact apply/source mapping.
For a body receipt, its SHA must equal the reviewed candidate's original EML SHA; for an
attachment, it must equal that candidate's selected attachment SHA. Require each resulting
receipt ID to be present in that UID's apply report. This command reads the actual stored
originals and canonical existing receipt files; it makes no new receipt or matching writes.
Keep the zero report immutable and hash it. To repeat the same check, pass
`--reviewed=<prefix>.zero.json` and write a fresh output filename. Any mismatch or nonzero
`new` stops acceptance; do not apply an unreviewed repair manifest.

Treat a linked-invoice warning as retained email evidence, not as a retrieved invoice.
The reviewed Cloudflare source 7206 keeps its warning/EML; source 7207 is its separate
payment document. Do not merge those records on issuer or amount. An unresolved linked PDF
remains open even when every selected original in a page passes the zero check.

After interruption, keep failed reports and private partial exports. Retry the exact same
pinned selection with fresh report filenames; successful originals keep their IDs. If the
source hash, folder, UIDVALIDITY or project changed, inspect and privately review again before
any retry. A batch-limit skip can use a smaller page; permanently unavailable originals stay
open. For `remaining > 0`, use the saved `nextBeforeUid` in the same date window. For
`earlierCandidates > 0`, move to the preceding year with no cursor from the newer window.
An empty year does not finish the account while earlier matches remain. Keyword exhaustion
is not proof that documents with unusual subjects were found; record that coverage limit.

## 5. Root live acceptance

### Owner-visible filing and source navigation

For each of PRIV, FAM and VOL open **Belege** in the project sidebar,
`/project/KEY/receipts`. Select **Offen**, **Alle Monate** and clear the search. Newly filed
receipts remain open because these operators skip matching. Preserve existing matched
receipts; locate them in **Zugeordnet** when relevant. Locate the reviewed attachment and
EML examples, then open their receipt detail. Require visible source **Aus einer Mail**,
the expected receipt metadata and the retained linked-invoice warning where applicable.

Use **Datei öffnen** and **In Dateien zeigen** from that detail. The latter must open the
project's integrated Files viewer at the exact `receipt.vaultPath`: selected attachments
under `Files/Mail`, new body originals under `Files/Belege/<month>`. Both paths must return
the same bytes as the reviewed report and work in the owner's actual browser. A blob opened
by `Datei öffnen` alone does not prove the Files viewer/deep link works. For EML, verify the
available viewer/download behavior and preserve the full original; record an unsupported
preview accurately. Do not make a duplicate copy merely to put every attachment in a
folder named Belege.

The owner must also be able to navigate the source, attachment and any existing ticket
through the product/agent paths with consistent numeric Helena IDs and project scope.
The `read_mail` tool's existing API returns the source message IDs and attachment vault
paths; compare those attachment paths with the receipt's canonical original. Existing
triage tickets must carry the correct numeric thread ID and inbox link. Where no ticket
exists (including 7235, 7206 and 7207 at the checkpoint), record that instead of creating one.
Exercise only existing project-authorized paths; this preparation makes no model call and
does not send private mail to a new provider for the acceptance.

**Known product gap to keep open:** source inspection of `ReceiptSheet.tsx` in this worktree
and prepared HEAD `659449b4` shows `Aus einer Mail`, `Datei öffnen` and `In Dateien zeigen`,
but no rendered mail-thread or ticket link from the receipt detail. A relational SQL join
or a hand-built URL is supporting evidence, not proof of that missing owner-visible source
navigation. Root must verify the final deployed UI/agent path and resolve or explicitly
retain this gap; do not mark point 4 complete from receipt counts or successful file hashes.
No UI/source implementation change was made by this read-only assignment.

### Apply, HTTP and byte evidence

Record deployed commit, manifest hashes, actual reviewed/imported/excluded/open UID counts,
new and reused receipt IDs per project, and successful repeat results. In PRIV/FAM/VOL,
verify an original attachment download, an original `.eml`, the linked-invoice warning and
the relevant monthly export. Match exported/downloaded SHA against reviewed originals.
Confirm historical sources have no added Inbox locations/events/tasks and unchanged provider
flags. At the separately authorized native-routine acceptance, run only the existing project
triage once, then check no duplicate receipts or tasks, no project crossing, unchanged
classifier cutoff/retention and native schedule IDs. Preserve the checkpoint's disabled
account-level triage setting; an unavailable native run is an open check, not permission to
enable another scheduler or replay classifications.

Use the existing authenticated owner session for these concrete read-only HTTP paths;
`/backend` is the browser API prefix. Do not create credentials or extract session secrets:

| Check | Existing route and evidence |
| --- | --- |
| Original | `GET /backend/projects/KEY/receipts/RECEIPT_ID/file?download=1`; use IDs from the final zero report and verify the downloaded bytes below. |
| Monthly export | `GET /backend/projects/KEY/receipts/export?month=YYYY-MM`; choose the actual invoice/receipt month, download privately and compare the included original bytes with the same report. A successful ZIP response alone is insufficient. |
| Source | `GET /backend/projects/KEY/mail/threads/THREAD_REFERENCE`; test the exact numeric ID and its unambiguous provider reference and record only status/thread equality. |
| Ticket | `GET /backend/issues/ISSUE_ID`; check existing source ID/link and human assignee, and retain only IDs/booleans in broad evidence. The metadata SQL gives selected messages' `linkedIssueIds`; an empty list is an explicit no-ticket result. |

For each selected download (and the corresponding original extracted privately from the
monthly ZIP), use its verified receipt ID and local file path:

```bash
python3 - "$receipt_review/imported-rerun.json" VERIFIED_RECEIPT_ID /private/path/original <<'PY'
import hashlib, json, sys
from pathlib import Path
report = json.loads(Path(sys.argv[1]).read_text())
rid, path = int(sys.argv[2]), Path(sys.argv[3])
expected = {(f["size"], f["sha256"]) for row in report["reports"]
            for f in row["files"] if f["receiptId"] == rid}
assert len(expected) == 1
size, sha = expected.pop()
assert path.is_file() and path.stat().st_size == size
h = hashlib.sha256()
with path.open("rb") as source:
    for chunk in iter(lambda: source.read(131072), b""):
        h.update(chunk)
assert h.hexdigest() == sha
print(json.dumps({"receiptId": rid, "downloadSizeAndShaMatch": True}))
PY
```

The final report binds every selected message/attachment to the canonical receipt by
project, SHA and ID. Identical originals may share a receipt whose stored source is the
first intake; preserve every reviewed source mapping in the evidence ledger instead of
rewriting that canonical source. For legacy attachment receipt 1 use the relational source
join described in the checkpoint. Body receipts use `details.mailSource` when present.
Re-read current metadata after apply and compare source/thread/ticket mappings with the
reviewed snapshot; neither backfill operator should create a ticket.

Complete the numeric/provider-ID and ticket-link checks from
[the point-4 read acceptance](approval-mail-read-acceptance-2026-09-26.md#punkt-4-numerische-helena-id-und-provider-id)
against the deployed fix. The existing read-only operator there covers large numeric
references and project scope. Do not open an unread inbox message just to prove its link:
that UI action marks it read. `draft-reply` is a write and remains covered by the private
regressions unless Root explicitly schedules a live draft fixture. Historical Run 118's
cause remains unproven unless its preserved error evidence establishes it; the regression
alone cannot establish that incident's cause.

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

At 00:53:14 CEST on September 27 the mappings were:

| Message | Thread | Classification | Issue / key | Current column/state |
| ---: | ---: | ---: | --- | --- |
| 7258 | 6968 | 34 | 66 / PRIV-15 | 11 / backlog |
| 7260 | 6970 | 35 | 72 / PRIV-16 | 11 / backlog |
| 7261 | 6971 | 36 | 78 / PRIV-17 | 11 / backlog |
| 7262 | 6972 | 37 | 79 / PRIV-18 | 11 / backlog |

All four have a human assignee, are unarchived, have `createTask=true`, `needsReply=false`
and no recorded classification correction. Classification issue IDs equal the linked issue
IDs. Their issue update timestamps remain September 26, 20:02:19–20:02:27 CEST. This metadata
does not prove the absence of substantive feed activity: Root must still check each feed
before the correction. Existing PRIV canceled column **15** has no auto-assignee. Recheck
that setting and preserve the current human owner. None of these four corrections was applied
by this checkpoint.

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
The private database is stopped and port 65501 is free. That preparation performed no live
inventory, provider read, backfill, task correction, deployment or shared full gate. The
separate September 27 read-only live checkpoint is recorded above and does not establish
apply, historical-provider coverage or UI acceptance. This documentation update required no
new database tests or shared full gate.

Private root-readable test logs on Kingston:
`~/agent-work/mail-receipts-acceptance-tests-final.log` (33/0; then a test-fixture type
annotation was corrected) and `~/agent-work/mail-receipts-acceptance-checks.log` (final
API typecheck, lint and formatting, exit 0). The annotation has no runtime effect; the
7 offline source/review tests also passed again afterward (48 assertions).


Matching follow-up validation is separate from the 33-test database run above. Six offline
mock cases execute the actual intake, imported backfill and historical apply in isolated
processes: omitted/false keeps matching, true skips it, and an existing matched receipt is
unchanged. No database or provider is used. Removing the intake guard makes three cases fail;
removing either operator's skip option makes its corresponding case fail. Scoped lint and
repository formatting also passed. The source change still requires the root's next
combined typecheck and database/full-test gate before deployment.
