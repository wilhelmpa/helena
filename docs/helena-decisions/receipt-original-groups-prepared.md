# Explicit supplementary receipt originals

Prepared on `258427ea244f1113f4dfd4718b358187cf05fc77`, after JEV migration0194.
No existing receipts are grouped by this release. Original classification and an explicit
administrator action are required; equal amounts, dates, names or invoice numbers do not
silently merge documents.

## Behaviour

An administrator can open an unmatched original, select its existing primary receipt in the
same project, and attach it as a supplementary original. Both receipt rows, extracted or
owner-corrected facts, original files and mail provenance remain untouched. The link has its
own actor/timestamp. Detaching deletes only the exact current link and makes that original
an independent open receipt again. No bank transaction is created or moved.

The ordinary receipt list and counts show the economic primary once, with an original count.
The detail panel lists every original and opens its existing detail/file/source controls.
Supplementary originals retain their own visible facts with an explanatory label, but have
no independent matching controls. Grouped originals cannot be deleted or ignored until
they are detached. Existing primary bank matches remain intact. A supplementary candidate
with a confirmed match or open proposal is rejected; the application never silently removes
those references. Rejected proposal history is preserved.

The export includes all original files (and any embedded e-invoice XML) but takes gross/VAT
only from the primary. It preserves null VAT rather than borrowing tax from a supplement.
Different independent receipts with the same amounts keep their previous behaviour. Export
metadata is captured under one short read-only repeatable-read transaction, then all file
reads/native extraction/ZIP creation occur after releasing it. A concurrent attach/detach
therefore cannot mix two membership snapshots. Original filesystem race behaviour is
unchanged; this is not a filesystem transaction guarantee.

Raw receipt inventories and intake/history manifests still enumerate original rows. They
are intentionally not economic-entry counts. A repeated import returns the existing
original IDs without changing the explicit grouping or owner corrections.

## Admission and constraints

`helena_receipt_original_link` has one primary per supplementary receipt, no self-link,
composite child/primary FKs binding receipt+project+team, and a creator/timestamp. The shared
service rejects nested groups and reassignment without detaching. Group mutations, grouped
delete/status guards, and match confirmation/proposal writes use the existing project
advisory748220 in short transactions. A matching decision already in flight rechecks the
link immediately before its write; it cannot resurrect a supplementary receipt's match.
No model/provider call runs while this lock is held.

Manual matching takes admission before touching existing match rows, preserving the same
project-lock-before-match-row order as receipt deletion. Group linking locks its two
receipt rows in numeric order. Auth remains the existing project-admin guard, with no MCP
exposure or additional source access. The two relation endpoints declare their409 conflicts.
Unlink binds both child and expected primary, so a stale browser cannot detach a reassignment.
The database FKs also reject direct cross-project/team links; flatness is the service contract.

Migration0195 is freshly generated after the actual0194 snapshot, with all previous journal
entries unchanged. It adds only the link table and the supporting receipt scope unique index.
The SQL creates that unique index before adding its referencing FKs (Drizzle initially emitted
it last). Snapshot semantics are unchanged. Cascades preserve normal whole-project deletion;
ordinary receipt deletion is guarded before any row or match removal.

## Validation and remaining acceptance

Local, existing dependencies only:

- Finance export:9 tests/37 assertions. Four targeted cases cover invoice+payment originals,
  no bank record, legitimate equal amounts/detach, and null VAT. The new preservation cases
  against the unchanged baseline export fail2/4 because supplementary originals are omitted;
  current code passes all4.
- Web:8 receipt/source SSR checks plus2 actual component interaction checks. Explicit selection
  is required; only the relation payload is sent; canonical navigation and exact-parent detach
  are exercised. All10 locales carry the same new message keys.
- Existing intake/matching children:11 tests/33 assertions; retry/immutableEML:10/30. Mock fixtures
  gained only the new schema export and inArray symbol, preserving their strict original assertions.
- API/Web/DB/Finance typechecks and scoped ESLint/Prettier/diff checks. No dependency changes.
- Independent source review found the manual-match/delete lock inversion above; corrected before
  freeze. The reviewer independently ran Export9, Web10 and Intake11 successfully.

Eight new real PG tests are authored in `original-groups.test.ts`, including both late-confirm
and late-proposal paths, real composite-FK rejection, a competing flat-group race, and a
NOWAIT proof of match-row freedom while manual matching waits for project admission. Existing
`mail-html-receipt.test.ts` now additionally checks explicit grouping plus native history retry
without changing receipt rows or mail provenance. These PG cases are NOT executed locally.
They require Root's isolated private test DB, migrations through0195, and existing fake-provider
fixtures. No live DB, server, provider, GPU, full gate or deployment was run by this agent.

Before deployment Root still needs independent final source acceptance, privatePG migration/
API/race checks, exact full gate, then real UI attach/open-both-originals/CSV/detach proof on
individually reviewed originals. No existing cluster is repaired by source preparation alone.
