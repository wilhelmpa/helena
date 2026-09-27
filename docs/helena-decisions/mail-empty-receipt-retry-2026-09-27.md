# Existing empty receipt action and retry limitation

Source-only finding on `3a8b76c0`, also present on `594f1376`.

`apps/api/src/modules/mail-triage/classify.ts:fileReceipts` calls the configured intake for
invoice classifications with automatic receipts enabled. When intake returns an empty array,
it still returns an action with `kind: receipt`, `receiptIds: []` and the note
`No supported receipt original found.` The caller persists that action.

`retryReceiptFiling` selects only classifications without any action whose kind is `receipt`.
An earlier empty receipt action therefore prevents a later retry, even after extraction is
improved. This differs from an intake exception: exceptions record a skipped action and can
be retried. A parser correction alone does not repair previously empty actions.

No live classification or action inventory was inspected for this finding. No actions are
removed, account triage enabled, provider reads triggered or global retry behavior changed.
Any recovery of affected historical classifications needs a separately reviewed bounded
operation that preserves prior actions and proves duplicate-free receipt intake.
