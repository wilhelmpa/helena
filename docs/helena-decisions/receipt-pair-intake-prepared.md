# Fresh invoice/payment originals from one mail

Prepared after `0aeca358ac22d0e17efa97cdb25ae6a25d427455`. This adds no migration,
provider/model call, historical repair or new original store.

## Narrow admission

Only exactly two selected PDF attachments from the same validated mail message and thread
can qualify. Their bytes/SHA/size/project are validated by the existing intake. Both must
have complete native `pdftotext` output: successful exit, no timeout, no byte truncation and
no character truncation. OCR and unknown completeness do not qualify. This flag describes
native text extraction completeness, not visual verification of image-only page content.
No new extraction process is started; the existing result gains one optional boolean.

The pure evidence parser requires one standalone early Invoice/Rechnung title and one
Receipt/Quittung/Zahlungsbestätigung title, the same explicitly labelled invoice number,
a positive printed total on the invoice and the same printed completed Amount paid on
the receipt, including an explicit matching currency. Receipt totals and any remaining
balance must be consistent. Multiple references, conflicting roles/currencies/amounts,
drafts/credit notes/refunds/partial or pending/failed/future payments remain separate.
A naked dollar sign, zero payment, unsupported layout/language, or receipt/order/transaction
number standing in for an invoice number does not qualify. The fresh ordinary parser facts
must also agree; stored owner corrections, sender names and filenames cannot prove a pair.
Contradictory non-null freshly extracted issuer strings veto a pair. There is no company-name
normalization, similarity match, or positive grouping based on an issuer alone.
This is intentionally not a claim to recognize every invoice/payment layout or private pair.

Evidence is computed from the full native text before the 2,000-character stored excerpt.
It is ephemeral, not trusted back from mutable receipt JSON. The pair report contains the
two original SHAs and the common invoice reference/amount/currency, not full document text.

## One relation implementation, one transaction

The existing explicit relation service now has an internal executor entry point. Both the
public explicit endpoint and the mail intake use the same scope, nesting, active-match and
status checks. Intake passes its existing transaction and project advisory748220; there is
no nested global transaction. It inserts both independent receipt rows first, then links the
payment original to the invoice only if **both IDs were newly inserted in that transaction**.
Matching remains postcommit and skips the supplementary original through the existing rule.
`skipMatching` and index-repair/newIds behavior are unchanged. A SQL failure rolls back both
receipts and the relation together; original attachment bytes are not rewritten.

Existing IDs are never automatically linked, including a partially imported pair. Therefore
an explicit detach survives replay without requiring a new tombstone/schema. Existing groups
also remain unchanged. A different message, three selected originals or two invoices cannot
be collapsed, even if their amounts/references agree.

The existing backfill dry/apply contract carries `originalPair` and compares the same proof
again before writes. Old reviews remain usable when there is no pair; a newly recognizable
pair requires a fresh reviewed dry-run rather than silently applying an unreviewed relation.
The proof stays stable across replay; it describes document evidence, not a promise to link
already existing IDs. History application reaches this same intake, without changing the
history inspect/export manifest or its original-level receipt IDs/counts.

## Validation boundary

Synthetic pure tests cover role/reference/value ambiguity, different messages, unsupported
or contradictory currency, zero/partial/failed/future payments and review-SHA binding.
Child-process fixtures exercise native completeness flags and full text versus excerpt,
without invoking external programs or network. Existing intake/index-retry/matching and
body-evidence suites retain their original assertions. API/Vault types and scoped lint use
existing local cached dependencies only.

Five real-PG cases are authored in `mail-original-pair.test.ts`: reviewed dry/apply/repeat/
detach, concurrent native intake, one existing original, two independent invoices, and
altered/missing review evidence. They require real installed Poppler and a private test DB
and have not been executed on the Mac. Root still owns the exact Linux/PG checks, independent
review, full gate and eventual release. No current gate or live receipt was changed.
