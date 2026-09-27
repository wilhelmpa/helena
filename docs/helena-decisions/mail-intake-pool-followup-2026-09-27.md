# Open follow-up: existing nested mail intake transactions and pool capacity

Source-only finding, separate from the bounded empty-receipt retry repair.

`packages/db/src/client.ts` constructs one postgres-js pool with no explicit `max` override
(default ten connections). `receipts/receipts.ts:intakeMailReceipts` reserves a connection
for a transaction and its project advisory lock, but `storeMailReceipts` and helpers execute
queries through the global `db`, requiring additional pool connections. Ten direct concurrent
intakes can therefore occupy all ten connections while their global queries need another.
Same-project callers waiting on the advisory lock make this especially direct.

`mail-triage/classify.ts:runProjectTriage` similarly holds an outer transaction for a
project advisory lock while calling global-query classification and intake functions.
Concurrent runs across enough independent projects can reserve the pool before the nested
work obtains another connection. The empty-receipt retry did not introduce these two paths.

The receipt-only retry now admits at most one batch per process and skips locked
classification rows. That prevents retry batches from independently saturating their pool,
but does not claim to repair concurrent direct intake, concurrent full-project triage, or
all mixtures of existing callers. No deployment, runtime reproduction, global pool limit
change or transaction plumbing change was performed for this follow-up.

A later, separately scoped repair should prove behavior against a bounded real pool,
including independent projects and mixed callers. Possible designs need to avoid reserving
all pool connections while waiting for work scheduled on the same pool, and must retain
cross-replica deduplication and original/project verification. Merely increasing pool size
or adding `SKIP LOCKED` only to the retry row does not resolve the underlying pattern.
