# Automatic mail task eligibility

The application-owned `project-mail-actions-v1` policy applies independently to each
mail's current project. Its question uses the database thread project ID, never a
project or policy supplied by the email. Native routine routes retain their existing
project, connected-account and permission checks. The fixed policy implements the
owner's saved exclusions for PRIV, FAM and VOL; it is durable application code and
does not require another configuration UI or changes to the native schedules.

The decision model answers `task_eligibility` alongside the existing five questions.
Email text, headers and attachment names remain bounded, untrusted evidence. A
newsletter, advertising, login/2FA/password instruction, pure security alert, recovery
confirmation or problem-free shipment cannot authorize an automatic task. A generic
call to sign in, verify or learn more does not establish an obligation. Notifications
can still contain real contractual deadlines, payment obligations or service problems.

An automatic task requires a decided actionable eligibility answer, a decided mail
category and a decided affirmative action answer. The independent newsletter/advertising
category guard rejects contradictory model answers. Missing, low-confidence, unknown or
explicitly uncertain eligibility produces `createTask: null` and `status: unsure`.
The inbox already displays that status. Native routine results include the number of
newly uncertain messages in `reviewRequired`; their IDs remain in `results`. The tool
description tells the agent to report them for review without creating replacement
tasks through another tool.

TK sender domains retain high priority. A decided `tk_mailbox_notice` for an actual
TK sender and a decided non-newsletter/non-advertising category is the explicit
task exception: new health/insurance correspondence in the secure mailbox matters
even when the generic action answer is negative. The domain alone cannot authorize
a task. TK login/recovery notices, newsletters, ambiguous classifications and provider
failures create none. Concrete actionable TK obligations use the ordinary gate.

Invoice originals are filed independently of task eligibility. This includes excluded
and uncertain tasks; failed filing is retried within the current project without
repeating task creation. The existing canonical-original, deduplication and receipt
export paths are retained. No database migration is required.

The four existing PRIV tickets from the 20:00 routine are unchanged. Existing
classifications are not replayed or bulk-canceled; the operator reviews those tickets
individually. Explicit human task creation remains available.

## Validation and live acceptance

Private tests use only synthetic mail and loopback decision servers on a dedicated
PostgreSQL instance. They verify exclusions even when `create_task` is affirmative,
policy separation from email instructions, confidence/ambiguity gates, a real
notification deadline, project isolation, the narrow TK exception, provider failure,
and independent invoice filing/retry. Receipt integration tests verify the existing
original-file and export behavior. The decision eval contains 46 labeled cases and
scores the eligibility question, including TK mailbox/login/recovery, an ambiguous
invoice, a contractual deadline and an injected newsletter.

These local tests establish the enforcement paths and eval schema; they do not claim
measured classification accuracy from a real model. After the operator deploys this
mail wave, inspect the next native run's `reviewRequired`, classification eligibility
answers and actions. Verify that excluded messages have no task action, uncertain
messages remain visible, real obligations and TK mailbox notices reach the correct
project, and invoice originals remain accessible in Belege. Run the labeled eval
against the configured decision model when its provider is available. Do not inspect
or publish real login links, codes or tokens for acceptance.
