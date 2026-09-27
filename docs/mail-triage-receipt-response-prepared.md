# Mail triage receipt response

Prepared as a separate follow-up to 55de30c6b200bba76db7f0a192b233662d6c3c63.
No migration, dependency, receipt intake, recorder, project claim, cancellation,
or permission change is included.

`run_mail_triage` returns `receiptIds` and `receiptCount` at batch level and for
each newly classified message. These identify distinct receipts confirmed by
successful filing in this invocation, including existing receipts returned by
idempotent intake. They do not report how many database records were newly created.
The batch union includes completed receipt retries as well as message results.
`receiptRetries` retains its count of successfully retried messages, independently
of how many receipts each message returns.

IDs are accumulated after the retry transaction has resolved. Empty intake,
failed intake, and failed final classification reads contribute no unconfirmed
IDs. An empty reported set does not prove that no receipt exists: extraction or
indexing can fail after a receipt is persisted. Existing error and retry behavior
is retained. Task failure does not hide an independently successful receipt action.
No receipt deep-link is synthesized; `threadHref` keeps its existing meaning.

## Local verification

- Four offline suites: batch-result, receipt-response, receipt-retry-flow,
  receipt-retry. 18 tests passed, 43 expectations; nine isolated retry scenarios.
- The same four batch-result tests against the original 55de helper failed all
  four assertions groups; their new implementation passed.
- Real local Elysia serialization uses `TriageBatchResponse`; generated MCP output
  schema and the production structured-result envelope retain the receipt fields.
  This offline check does not simulate a claim of full-route authorization.
- Existing strict retry assertions were updated with exact expected receipt IDs
  in the retry fixture and decisions/receipts integration suites.
- Full API typecheck, scoped ESLint, Prettier and diff whitespace checks passed.

## Private PostgreSQL verification pending

The authored decisions integration case invokes the actual HTTP triage route and
MCP dispatcher with a test owner's API key. It checks the union across a retry and
a first classification, duplicate IDs, the same existing IDs on a subsequent
retry, and an empty repeat. It uses the existing synthetic receipt-intake callback
and local decision-server fixtures, with no external provider or actual model.
The existing real native-intake index-failure test now also requires empty IDs on
failure and the original receipt ID after successful repair. Other existing retry
and concurrency assertions remain exact.

No PostgreSQL, server, deployment, or live acceptance was performed during local
preparation. Root schedules the exact Linux targeted verification and full gate.
