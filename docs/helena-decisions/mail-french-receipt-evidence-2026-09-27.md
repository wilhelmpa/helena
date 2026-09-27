# French receipt totals and shared mail evidence

Prepared on `codex/fix-mail-french-receipts` from `594f1376`, which contains the separately
reviewed issuer-recipient exclusion on live release `3a8b76c0`. No live state or original
mail is changed. Fixtures contain synthetic data only.

The shared text parser accepts complete French gross-total lines labelled `Prix TTC`,
`Montant TTC`, `Montant total TTC` or `Total TTC`, followed by a decimal or whole-euro amount
and an explicit euro currency. An optional `dont … euros de TVA` suffix supplies VAT.
It takes the gross amount immediately after the label. Labelled French totals take precedence
over generic amount extraction. Invalid, incomplete or conflicting TTC lines leave gross unknown;
generic extraction cannot reinterpret their VAT as gross. VAT above gross is also rejected.
The euro currency vocabulary includes both singular and plural. Unlabelled numbers,
file sizes, order references and future offers do not become gross totals through this rule.

Native body intake and historical selection use the same `hasMailReceiptEvidence` rule.
The rule accepts French purchase/payment receipt subjects with an extracted gross amount.
The historical search vocabulary includes French document terms. Amount plus order number
alone is insufficient: bare order/purchase confirmations are not automatically selected.
Export reports and upcoming-payment notices remain excluded. An invoice subject with an
extracted number and an explicit invoice-number label can refer to an upcoming service.
An order number alone cannot enable that exception. A renewal date or a future order
mentioned inside an actual invoice does not exclude that invoice.

A purchase-confirmed subject also qualifies when the body explicitly confirms a purchase
for a dollar amount with a card and that amount equals the extracted gross amount. This
keeps completed card purchases without an invoice number eligible. Bare purchase/order
confirmations and descriptions saying the card will only be charged later stay excluded.

The completed German phrase `Ihre Zahlung in Höhe von … wurde am … verrechnet` supplies
its explicit euro amount. Future `wird … verrechnet/belastet` and `nicht verrechnet` do not.
This rule does not depend on a vendor name.

Explicit reviewed `includeBody: true` still preserves the operator's intentional body
selection. No invoice number, French invoice date, receipt status or project is fabricated.
The original body EML remains the receipt original and existing project/SHA deduplication
is unchanged. Already stored receipt facts are not recalculated by this code change.
The separate empty-receipt retry limitation is documented in
[mail-empty-receipt-retry-2026-09-27.md](mail-empty-receipt-retry-2026-09-27.md).

## Validation

- 144 offline tests, 278 assertions, zero failures: shared receipt-text/money tests and
  50 cases through the production native intake or history inspect/apply/intake functions.
  The full existing mail-facts suite also runs, including the linked-original and untrusted-input cases.
- Each path checks positive French decimal/whole-euro and French-only receipts, existing
  payment receipts and real subscription invoices. Negative cases cover exports, future
  payments, order/purchase confirmations, promotions and unlabelled amounts.
- The child-process fixture replaces database, vault/storage, provider and MIME boundaries
  with synthetic in-memory adapters. It uses real facts/evidence/intake/history code, checks
  preserved original bytes and stored gross/VAT/currency, and repeats intake without duplicates.
  Fetch and provider connection calls are forbidden; matching is configured off and fails if called.
  This is not a live DB, provider, full MIME parser or authenticated UI acceptance test.
- The initial 103 tests against unchanged `594f1376` produced 19 failures. The completed-card
  and upcoming-service invoice regressions produced six failures against `4e1cd0c8` through
  the direct helper and both receipt paths. Two separate mutations
  restoring the historical amount/number bypass or allowing future receipt subjects failed
  their targeted history/native cases.
- The TTC precedence regressions fail ten tests against `f1efcac0`; the completed German
  payment fails both production-path cases without its extraction rule. Added negative cases
  cover conflicting TTC lines, VAT above gross, incomplete TTC, VAT rates and future payments.
- Strict standalone TypeScript checking passed for receipt-text and money. Scoped formatting
  and `git diff --check` passed. Full API typecheck, ESLint, Root's shared gate, deployment,
  bounded existing-receipt re-extraction and live acceptance remain outstanding.
