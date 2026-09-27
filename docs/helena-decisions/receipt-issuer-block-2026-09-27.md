# Receipt issuer extraction

Prepared from `3a8b76c0` on `codex/fix-receipt-issuer-block`. No live receipt fields,
account settings, model decisions or provider state are changed.

The existing recipient-label and following-three-lines exclusion applies to every issuer
candidate: legal form, address and first-line fallback. Address lookup checks both the
postal-code line and the candidate name. An excluded recipient does not become the issuer
when the legal-form lookup finds nothing. The existing fallbacks still return null when
they have no eligible candidate.

The private stored excerpt for receipt 6 / attachment 300 reproduces the incorrect issuer
with the old parser. The corrected parser selects the issuer on the first document line;
all other extracted text facts are identical. Regression fixtures contain synthetic data.
This verifies the stored excerpt only; no original PDF or live receipt was changed.

Receipt direction is unchanged. The reviewed PRIV receipts 5, 7, 8, 9 and 10 use ZUGFeRD
extraction, and their project has no registered own bank accounts. Without an own-account
match the existing XML parser defaults to incoming. This does not establish whether those
documents are the owner's outgoing invoices. A company name alone is insufficient evidence
for changing the direction or assigning an account.

## Validation

- Receipt-text and money suites: 63 tests, 85 assertions, zero failures.
- Before the fix, three new issuer regressions failed; the existing five cases passed.
- The additional recipient-address-line case preserves the existing first-line fallback.
- Root's integrated full gate, deployment and live acceptance remain outstanding.
