# Receipt HTML alternative behind a plain-text stub

Prepared separately on `284b4c1b`; not deployed or enabled through a historical import.

Some multipart messages carry only a link stub in text/plain and the issued receipt in
HTML. The mail parser correctly retains both variants and the complete RFC822 original,
but receipt extraction previously read only the primary text. An explicit body selection
could therefore archive the original while leaving its amount and invoice number empty.

Receipt extraction now has one narrow alternative selector, shared by stored-mail intake,
history inspection and EML re-extraction. It considers HTML only when primary text has no
financial amount, invoice/order/transaction identity or contradictory payment status. A
candidate must carry an explicit invoice/receipt number, issue date, an unambiguous labelled
total with currency, and a receipt or completed-payment statement. The bare `Invoice:`
label and a neutral purchase subject qualify only under those conditions. Repeated equal
fields are allowed; conflicting or malformed totals, numbers, dates and explicit paid
amounts are refused. Existing primary facts are never augmented or replaced from HTML.

The selected HTML is sanitized and converted without fetching resources. Hidden attributes
and common hiding styles are excluded from receipt text. The shared sanitizer now preserves
`hidden` and `aria-hidden`, including the empty boolean attribute, so their meaning survives
mail storage; the generic parser's text preference and snippet logic are unchanged. This is
not a browser/computed-CSS visibility engine. Previously stored HTML whose hidden attributes
were already discarded cannot recover that metadata without reading its original again.

`details.mailBody` records `primary-text` or `text/html-fallback` and the decision reason.
Primary text can itself originate from an HTML-only message; it is deliberately not labelled
as proven original text/plain. The existing backfill dry report includes this provenance.
Refusal reasons do not invent receipt facts; `amountFound`/`missingFacts` remain truthful.
Explicit `includeBody` retains its existing ability to archive an original with incomplete
facts. The complete EML bytes, SHA, project boundary, idempotent retry and matching behavior
are unchanged. Distinct invoice/payment EMLs remain distinct originals; no cross-mail field
enrichment, semantic merge, automatic historical selection or update of existing rows.

The grammar is intentionally limited. Unrecognised formats, oversized HTML (>1M characters),
oversized derived text (>200k characters), unsupported labels/currencies, and uncertainty stay
on primary text for review. VAT/issuer extraction otherwise retains the existing heuristics.
The independent labelled-currency follow-up changes the finance parser, not this selector.

Validation uses fictional mail only: primary-stub/HTML receipt, padded table cells, conflicting
MIME content and payment state, malformed/competing totals/dates/ids/currencies, ordinary
orders, hidden markup, original-byte/hash preservation and separate payment facts. Offline
native/history flows exercise production code behind isolated infrastructure boundaries;
EML extraction runs against a temporary original with external tools/network forbidden.
Restoring the old facts/extraction/history sources makes the new fallback regressions fail.
One real-DB integration test is authored for native import → dry/apply/retry → original and
re-extracted facts, but remains unexecuted locally. Root's exact full gate and independent
source review are required before integration. No installation, DB/provider/server/GPU job,
or change to a private historical manifest was performed.
