# Subtask parent resume implementation plan

**Goal:** A delegated child entering a completed or canceled column queues one context-rich run for the open parent's agent delegate.

**Architecture:** Keep the decision in the issue status-change path. Use a distinct `subtask` run trigger and the existing agent run queue. Read child result context from its latest comment; frame the parent run as continuation work. Serialize the transition decision with the project's existing update lock.

**Tech Stack:** Bun, Elysia, Drizzle/PostgreSQL.

**Spec:** [[HELENA-17]] and [[HELENA-16]].

## Steps

- [ ] Add failing unit tests for status eligibility, prompt content, and run framing.
- [ ] Implement the decision and trigger framing, then verify the unit tests pass.
- [ ] Wire the decision to issue updates and add the database trigger constraint migration.
- [ ] Run targeted unit tests, typecheck and review the diff.
- [ ] Commit and report branch, tests, risk and handover in Helena.
