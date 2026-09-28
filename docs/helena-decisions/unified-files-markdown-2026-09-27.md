# Native Markdown in the unified Files viewer

State: 2026-09-27, owner backlog reconciliation. Prepared on
`68c1f27d723944baf3a196d4eafc1ff6ec698a73` in isolated branch
`codex/unified-files-markdown`. **Private verification passed after Root reopened
the short Web test window; Root relayed independent source approval. Shared
integration, the full gate and live editor acceptance remain open.** No live writes,
dependency installs, PostgreSQL instances, GPU work or deployment were performed.

## Behavior

The unified Files viewer uses the existing document Markdown editor for vault
Markdown. The native editor displays and follows wiki links and preserves their
canonical vault targets. Its source is shared with the existing Documents editor;
TXT keeps the plain-text editor. Helena edits the canonical vault originals. The source/task/chat references remain in the same viewer and continue
to use the existing scoped references API.

The source note path comes from the actual file scope and relative path. The
viewer explicitly carries that source project's web-link context through its
portal. Wiki navigation uses the existing ACL-filtered resolution endpoint, then
the destination file's own canonical route. Missing or denied targets do not create
notes in the Files viewer. A response arriving after the source editor unmounts
does not navigate.

Reads and writes retain the FileText endpoint and its expected ETag. YAML metadata
bytes stay outside the rich-text body; image URLs are mapped through the existing
vault image helpers and restored on save. Loading and editor normalization do not
write or mark the file dirty. Conflicting writes keep the local draft and its
original ETag. Undoing all local edits restores the original bytes without a write; after a refetch, the edit session still retains its original ETag for any later edit.
The editor is keyed by canonical vault path, so identical relative paths and
original hashes in two projects cannot carry a draft across projects.

The existing viewer discard check covers wiki navigation and internal task/chat
links as well as closing the viewer. Server permissions remain
authoritative; this change adds no API, schema, grant or separate document store.

## Review correction prepared during the freeze

Independent review found a real data-loss defect in predecessor `e8fd7fdd`: a
true rich-text edit could serialize away relative Markdown links or HTML comments.
That predecessor is **not approved for integration**. The correction keeps the
existing URI policy unchanged and enables rich editing only after the actual
current editor's serializer round-trips its loaded source exactly. The comparison
uses the same reverse image mapping as save and separately restores only the exact
trailing LF bytes; it never trims whitespace or normalizes CRLF. Frontmatter stays
outside the rich editor unchanged.

A non-preserving document opens in Markdown source for editors; its formatted
preview remains read-only. Source mode is always reachable. Previewing a source
draft reparses that current draft and starts read-only until its own readiness
check passes. Old callbacks, failed serialization and editor initialization errors
cannot enable editing. Permission changes also reach TipTap's actual editable
state and the read-only source field.

The browser textarea normalizes line endings in its value. The source adapter
therefore applies a character diff back onto the prior original: unchanged spans
retain CRLF, lone CR, LF and all other source bytes. It uses the existing `diff`
dependency with a bounded timeout. If it cannot complete, the previous source is
retained and the editor explicitly reports that the edit was rejected. New text
uses the input's LF bytes. No dependency installation is needed.

Draft and ETag remain bound through mode changes, failed writes, refetch, partial
and full undo. A fully undone draft is clean but retains its original ETag, so a
later edit cannot silently adopt a newer server version. New translation keys are
present in all ten locales; English fallback fills the eight pre-existing missing
`files.unified` blocks while preserving existing locale values.

## Final private verification, 27 September

Root reopened the Web-only test window at 02:12 CEST. All work ran sequentially
through `heavy.sh --class test`, without PostgreSQL or GPU work. Final results:

- **64 tests passed, 0 failed, nine files**: 17 real React/TipTap viewer cases,
  one initialization-boundary case, four readiness/lifecycle cases, two source-byte
  cases and 40 existing editor/wiki/image/vault-link/route tests.
- Full Web TypeScript: **passed**.
- ESLint on all 36 changed Web paths, including all locale files: **passed**.
- Prettier check on those same paths: **passed**.
- `git diff --check`: **passed**. Formatted files were copied back from the private
  check tree; no runtime dependency changes were made.

The first correction run had 55/63 passing tests. Its eight old UI fixtures
expected rich editing of an image followed by a paragraph, but the existing image
serializer removes the separating blank lines. The new conservative check
correctly selected source mode. The rich fixture now places its image last; an
additional source-save regression explicitly checks that the original image then
paragraph spacing remains byte-exact. No serializer behavior or URI policy was
relaxed. Two lint findings were corrected: the delegated keyboard shortcut uses
the capture phase, and the lifecycle test probe publishes its session in a layout
effect. The final 64-test run and all final checks include these changes.

Root relayed the independent high-effort review's source approval before these
runtime checks. The test slot is released, with no child service or database left
running. Final logs are `~/agent-work/unified-files-markdown-logs/{tests,types,lint,format-check}.log`.

The following historical entries apply only to the predecessor before the freeze;
the final results above supersede their outstanding private checks.

## Verification recorded before the freeze

Private copy: `~/agent-work/unified-files-markdown`. Existing dependency symlinks
were reused. Checks used one `heavy.sh --class test` slot at a time and synthetic
fetch responses; they did not call a live Helena or provider endpoint.

- First completed targeted run: **46 passed, 0 failed**, six Web test files. This
  included six new React/TipTap tests plus existing editor, wiki, image, route and
  vault-link regressions.
- The subsequent types/lint run found a missing `sizeBytes` in a new test fixture,
  an accessibility role for the keyboard container, a new render-time ref write,
  and four older editor lint findings exposed by moving its source out of the old
  suppression path. The fixes add the fixture field and group role, update refs in
  layout effects, and use an inline `useMemo` factory. Final types/lint have **not**
  been rerun successfully.
- Last targeted run: **47 passed, 1 failed**, 48 tests across six files. The added
  same-path/same-hash project-switch regression passed. The dirty-link test failed
  during delayed TipTap teardown because the synthetic `window` had already been
  restored. Its cleanup now waits before restoring globals; that fixture correction
  is **not yet rerun**. The inline `useMemo` correction is also after this run.
- Formatting passed before the final fixture/memo adjustments; `git diff --check`
  passes. Recheck final formatting with the verification below.

Logs: `~/agent-work/unified-files-markdown-logs/`. Early exploratory UI attempts
also exposed missing JSDOM session/media/frame setup; those fixture failures are
not presented as successful runs. All jobs finished before the Root shared gate.

## Remaining Root integration and acceptance

Root alone integrates the verified commit chain in the documented priority order,
runs the shared full gate and deploys. The shared handoff remains Root's
responsibility. No editor live acceptance is claimed by this private test report.

The live acceptance should open a canonical Research note in the unified native
editor, follow a wiki link and return, verify source/task/chat destinations and
project context, edit one original and read the same bytes via the Files API and an
authorized agent, then demonstrate unauthorized-project denial. Synthetic UI tests
do not establish the backend ACL or live deployment proof.
