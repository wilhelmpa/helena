# Empty receipt actions and bounded native retry

## Existing defect

Source-only finding on `3a8b76c0`, also present through `f1efcac0`:
`apps/api/src/modules/mail-triage/classify.ts:fileReceipts` persists `kind: receipt`,
`receiptIds: []` when intake finds no supported original. `retryReceiptFiling` excluded every
classification with any receipt action, so this empty result permanently blocked retries.
The retry counter also treated an empty result as completed. Failed attempts could retry,
but ID-only ordering let twenty persistent failures monopolize the batch.

## Prepared repair

Only explicit empty receipt-ID arrays become retryable; nonempty arrays and legacy receipt
actions with missing or malformed IDs remain excluded conservatively. A completed count
requires actual receipt IDs. An empty attempt counts as neither completed nor failed.

An optional `attemptedAt` ISO timestamp in the existing action JSON records unsuccessful
attempts. No table, column, migration, global cursor, scheduler or dependency is added.
Selection orders never-attempted rows first, then the oldest attempt, with classification ID
as the tie-breaker and the existing limit of twenty. Twenty persistent empty originals
therefore cannot indefinitely block a younger eligible classification. Initial empty and
failed intake attempts receive the same timestamp.

Repeated attempts update the timestamp of the matching empty or failed action rather than
append identical no-op records. Earlier actions, owner corrections and unrelated notes are
preserved. A later successful action is appended with its real IDs. Existing duplicate
history is not deleted or rewritten.

A synchronous process-local admission flag admits at most one receipt-only retry batch
per DB pool. Concurrent calls, including other project/team scopes, return zero completed
and zero failed without starting a DB query; their work stays pending for a later existing
run. `finally` releases admission after success or an exception. This is no queue or new
background service. It limits the new retry transaction's demand on the pool because native
intake still uses additional global DB connections.

Each selected classification uses `FOR UPDATE SKIP LOCKED`; an empty lock result is actually
checked and skips intake. Another replica or an owner-held lock therefore does not leave a
retry waiting on a row while occupying a pool connection. After acquiring the row lock,
eligibility is read again before intake. A
competing retry that has already filed a receipt or an owner category correction committed
before this check prevents another intake. Only actions are updated; category, priority,
responsibility, task and correction fields are untouched. Current thread project, enabled
account, credential presence, configured account/team/project scope and deletion state remain
required. A source without a project is excluded before the batch limit. The existing intake
continues to verify source/project ownership and deduplicate real originals.

This uses the existing receipt-only retry entry point. It does not call classification,
task creation, mail movement, provider mail operations or enable disabled triage. No global
historical backfill or live action rewrite is included. Receipt intake and its existing
matching behavior are unchanged. The classification lock does not claim to serialize all
possible concurrent thread moves; intake retains its own source/project validation.

## Validation and remaining gate

Local dependency-free tests run the real retry function with isolated mocked infrastructure,
plus the pure action-update helper: ten tests and twenty-five assertions pass. The flow cases
cover empty-to-success recovery, duplicate retry serialization, twenty-empty fairness, an
owner correction between selection and locked recheck, disabled/disconnected accounts,
deleted mail, team/project scope, completed and unknown legacy receipt actions. Provider,
classification, task and move calls fail the fixture immediately if reached. Additional cases
cover ten same-row calls, admission across ten different scopes with later sequential
completion, skipping a held row lock, and admission release after intake or DB exceptions.

Restoring only `classify.ts` from `f1efcac0` makes three of the four flow cases fail; the
unchanged scope case passes. This is the old red path, not a live-data experiment.

Four added database integration cases use the existing test harness and native APIs. They
exercise actual receipt intake with stored synthetic originals, concurrent retry deduplication,
owner corrections, action serialization, fair batching and zero classifier-provider calls.
Ten same-row calls and ten independent project/account scopes have explicit five-second
pool deadlines and real native intake; deferred scopes subsequently complete sequentially.
Another transaction holding the classification row proves the `SKIP LOCKED` branch without
relying on the local admission flag.
They are prepared for Root's shared full gate and have not been run by this subagent. The
local fixture does not establish PostgreSQL locking or SQL execution correctness.

Local command from this worktree (no installation):

```sh
bun --no-install test \
  apps/api/src/modules/mail-triage/__tests__/receipt-retry.test.ts \
  apps/api/src/modules/mail-triage/__tests__/receipt-retry-flow.test.ts
```

Formatting uses the already installed Prettier cache; `git diff --check` passes. No live DB,
private mail export, provider, GPU, deployment or full-gate operation was performed for this
repair. Root must review and run the combined candidate's shared gate before release.

This is not a global repair of existing nested intake/batch transactions. The independently
existing, broader pool-saturation pattern is recorded in
`mail-intake-pool-followup-2026-09-27.md`; it has not been runtime-proven or fixed here.
