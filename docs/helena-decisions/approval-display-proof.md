# Approval display acceptance

`apps/api/src/scripts/approval-display-proof.ts` is a separately staged Root operator.
It imports policy, scope and DTO code from the exact reviewed deployment. It creates
two synthetic, already rejected display cards for an existing project, member agent
and issue. It never calls the approval action, decision route or a tool executor.
`delete_issue` appears only as card text and input to scope classification. The issue
is retained; both cards have no issue/run/command/follow-up/decider reference.

This proves current policy derivation and service DTOs. Actual authenticated Owner UI
inspection is a separate step. Operator success does not prove HTTP authentication,
an agent invocation, tool execution or successful deletion. The UI's generic
“Abgelehnt von jemandem” text is not evidence of a human decision: both synthetic
cards explicitly say the script closed them without a person's decision.

## Root preflight and staging

Only Root runs this procedure against live. Integrate the reviewed approval card
change, pass the shared gate, check in-flight work, deploy and verify services first.
Do not deploy the cumulative preparation queue. Finish both cleanup passes before
another deployment: the manifest is bound to the exact live HEAD throughout.

Record the full reviewed release SHA, source/dev/deployed marker agreement, and the
reviewed operator SHA-256. Check that tracked live source is clean. Select an existing
project, an agent attached to it and an existing issue in that same project. Record
only those numeric IDs, the project key, and the DB name/role; do not read credentials
or change levels, memberships, budgets, settings or the issue to make a proof pass.
The policy preflight must derive workspace/allow/level-allows and
external/needs-approval/hard-block, both at level 3.

Copy the reviewed operator to a staging file via the Mac. As Root, install that file
under `/opt/helena-proof/approval-display-proof.ts`, owned by root with mode 0644,
and verify its SHA-256 against the reviewed copy. Create only the proof directories
needed for this operator:

```bash
install -d -o root -m 0755 /opt/helena-proof
install -o root -m 0644 REVIEWED_STAGING_FILE /opt/helena-proof/approval-display-proof.ts
install -d -o volition-plan -m 0700 /var/lib/volition/plan/proofs/approval-display
sha256sum /opt/helena-proof/approval-display-proof.ts
```

All manifest ancestors must already be canonical directories owned by root or the
service user and not writable by group/others. If preflight refuses an ancestor,
review it; do not recursively change live permissions. Existing manifests and
archives are never overwritten by staging. Do not copy or print the service env file.

## Invocation

Use the existing `helena-ops` sudo path on Kingston. The following Bash function runs
there after Root supplies reviewed **non-secret** metadata as environment variables.
Use one new 32-character lowercase hexadecimal `PROOF_RUN_ID` for the entire sequence.
Keep the exact argument list and returned IDs with the acceptance record.

```bash
: "${PROOF_HEAD:?full reviewed 40-character live SHA}"
: "${PROOF_DB_NAME:?reviewed database name}"
: "${PROOF_DB_ROLE:?reviewed database role}"
: "${PROOF_PROJECT_ID:?existing project ID}"
: "${PROOF_AGENT_ID:?existing member agent ID}"
: "${PROOF_ISSUE_ID:?existing issue ID in that project}"
: "${PROOF_RUN_ID:?new 32-character lowercase hex ID}"

proof() {
  sudo systemd-run --quiet --wait --pipe --collect --uid=volition-plan \
    --property=EnvironmentFile=/etc/volition/plan.env \
    --property=WorkingDirectory=/srv/volition/source/plan/apps/api \
    --setenv=NODE_ENV=production --setenv=HELENA_DISPLAY_PROOF_FAILURE= \
    /usr/local/bin/bun /opt/helena-proof/approval-display-proof.ts "$1" \
    "--expected-head=$PROOF_HEAD" "--database-name=$PROOF_DB_NAME" \
    "--database-role=$PROOF_DB_ROLE" "--run-id=$PROOF_RUN_ID" \
    --manifest-dir=/var/lib/volition/plan/proofs/approval-display \
    "--project-id=$PROOF_PROJECT_ID" "--agent-id=$PROOF_AGENT_ID" \
    "--issue-id=$PROOF_ISSUE_ID"
}
```

Do not pass `--private-test-root` or a failure injection on live. No implicit apply
mode exists. Every connection defaults to read-only; only the explicit insert and
cleanup transactions switch to read/write. `globalThis.fetch` is blocked before
service imports. Output contains only phases, counts, synthetic IDs and scope metadata.

1. `proof dry-run`: require exit 0 and `success: true`. Expect scopes
   `workspace, external`, reasons `level-allows, hard-block`, and a decided-tab
   `uiPath`. No manifest, card, decision log or revision write is expected.
2. `proof apply`: require exit 0, exactly two returned IDs and a private manifest
   in state `retained`. The manifest is mode 0600 in its mode-0700 directory.
   If the result is uncertain, use cleanup for this same run ID; do not retry apply
   with a new ID and leave the first attempt unaccounted for.
3. Open the returned `uiPath` in the Owner's existing authenticated Helena browser
   at the canonical hostname. If login is required, record the owner-only step as
   open. Locate the two cards by their returned IDs, action text and full marker.
   Record real visible evidence, not just the operator output:

   | Card                                          | Expected German display                                                                             |
   | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
   | Internal `delete_issue {"issueId":...}`       | `Innerhalb von Helena / Projektordner`, level 3, `Stufe 3 (Autonom im Budget) erlaubt das.`         |
   | Fictional `example.invalid` external deletion | `Außerhalb von Helena / Projektordner`, level 3, `Das gibt immer ein Mensch frei, auch in Stufe 3.` |

   Both cards must show the explicit synthetic-only details and closure note, be
   already rejected, and expose no decision controls. Never click a real approval
   or invoke a tool to demonstrate this display change.

4. `proof verify`: require exit 0. This rereads both exact hashed rows, checks the
   actual service DTOs and all incoming DB foreign-key references. It does not
   establish a browser session or make an HTTP request.
5. `proof cleanup`: require exit 0, same IDs, manifest state `cleaned`, and the
   private archive. Before deletion, the operator locks both rows, checks every
   saved hash and incoming FK, durably archives the exact rows, and deletes only
   those two rows. A changed row, changed archive, lost row or dependent row blocks
   normal cleanup. Retain the evidence and report the failed phase; do not bypass it.
6. `proof cleanup` again: require exit 0 with the same IDs and unchanged archive.
   The second pass verifies durable archive integrity and absence without deleting
   any further card. Refresh the real UI and confirm both synthetic cards are gone.
   Check the retained issue and unrelated cards remain unchanged.

## Side effects and recovery

Successful apply inserts two rows and consumes two `approval_request` sequence IDs.
The database's `approval_request_rev` trigger also increments `approvals:<teamId>`
twice. Cleanup increments that revision twice again. These are real DB side effects;
neither revision increments nor sequence consumption are restored. PostgreSQL can
consume sequence values even when insertion rolls back. A repeated cleanup adds no
revision increment. Private files/archives also remain as evidence.

The operator does not create a policy decision log (`audit: false`), notification,
run, chat, session or account. Private regression checks preserve the existing issue
and an unrelated card and compare counts of runs/chats/notifications/decisions.
Live workloads may change concurrently: distinguish their changes from proof rows.

Recovery uses the same metadata and run ID. A `prepared` manifest with no rows can
be marked cleaned. An `inserted` manifest with no rows archives its attempted IDs as
`absentCards`; this is an absence observation, not a claim about who removed them.
Committed cards with an `inserted` manifest are fully checked and archived normally.
An archive written before the manifest update is adopted only if byte-identical and
owner-private. A crash before delete commit rolls the DB transaction back; a crash
after commit verifies absence against the existing archive. Partial rows, foreign
references, hash changes or recreated cards fail closed. Never delete a manifest or
archive to force a retry. An interrupted temporary `.next` file may remain private.

## Private regression

The opt-in Bun test is bound to
`/home/wilhelmpa/agent-work/approval-display-acceptance`, loopback PG port 65502,
database `approval_display_test`, `NODE_ENV=test`, `HELENA_TEST_DB_CLONE=0` and
`HELENA_APPROVAL_PROOF_TEST=1`. It uses synthetic fixtures through the existing test
helpers and no provider. It is skipped by the shared gate.

Run only inside the assigned `~/agent-work/heavy.sh --class test` slot. Start this
private PG after acquiring the slot and stop it with an EXIT trap. Reuse existing
dependencies with workspace links pointing into this private source tree. Set a
private TMPDIR/vault/storage/backup root and synthetic test env values. Apply the
existing migrations and run from `apps/api`:

```bash
bun test src/scripts/approval-display-proof.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/scripts/approval-display-proof.ts src/scripts/approval-display-proof.test.ts
```

From the private repository root, use the existing Prettier binary to check both
operator files and this document. No package install, `bunx`, shared DB or live DB
is needed. The private run uses an all-zero expected SHA sentinel; only Root can
supply the actual deployed SHA for live acceptance.
